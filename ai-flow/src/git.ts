import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StageError } from "./errors.js";
import { clip } from "./redact.js";
import type { Change } from "./types.js";

export function git(cwd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  // Replay workspaces carry large injected trees (skills/, cql/test/), so
  // status/diff outputs can reach many MB — the 1MB default maxBuffer would
  // abort the child with ENOBUFS and read as a startup failure.
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) {
    throw new StageError(`git failed to start: ${result.error.message}`, "startup", null, "git");
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function repoRoot(cwd: string): string {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new StageError(clip(result.stderr || "The current directory is not a git repository"), "startup", result.code, "git");
  }
  return result.stdout.trim();
}

export function runPaths(root: string, id: string): { runDir: string; worktree: string } {
  return {
    runDir: path.join(root, ".ai-flow", "runs", id),
    worktree: root,
  };
}

// skills/ is seeded into every workspace by sz-workspace/sz-replay and is
// never a ticket change (ignoredByCheck filters it from results); excluding
// it at the git level also keeps the raw output small — thousands of seeded
// files once overflowed spawnSync's buffer (ENOBUFS) before the result
// filters ever ran. cql/test is NOT excluded: its changes are delivery
// content for pipeline-runtime SZs (the full patch must carry it).
const HARNESS_PATHSPEC_EXCLUDES = [":(exclude)skills"];

export function listChanges(worktree: string, base: string): Change[] {
  const diff = git(worktree, ["-c", "core.quotepath=false", "diff", "--name-status", base, ...HARNESS_PATHSPEC_EXCLUDES]);
  if (diff.code !== 0) {
    throw new StageError(clip(diff.stderr || "git diff failed"), "finished", diff.code, "git");
  }
  const changes: Change[] = [];
  for (const line of diff.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = normalizeRel(parts[1] ?? "");
      const newPath = normalizeRel(parts[2] ?? "");
      if (oldPath && !ignoredByCheck(oldPath)) changes.push({ status: "D", path: oldPath });
      if (newPath && !ignoredByCheck(newPath)) changes.push({ status: "A", path: newPath });
      continue;
    }
    const rel = normalizeRel(parts[1] ?? "");
    if (!rel || ignoredByCheck(rel)) continue;
    if (code.startsWith("D")) changes.push({ status: "D", path: rel });
    else if (code.startsWith("A")) changes.push({ status: "A", path: rel });
    else changes.push({ status: "M", path: rel });
  }

  const untracked = git(worktree, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--exclude=skills/",
  ]);
  if (untracked.code !== 0) {
    throw new StageError(clip(untracked.stderr || "git ls-files failed"), "finished", untracked.code, "git");
  }
  for (const line of untracked.stdout.split(/\r?\n/)) {
    const rel = normalizeRel(line);
    if (rel && !ignoredByCheck(rel)) changes.push({ status: "A", path: rel });
  }
  return changes;
}

export function diffOutsideCqlTest(worktree: string, base: string): string {
  const diff = git(worktree, [
    "-c",
    "core.quotepath=false",
    "diff",
    base,
    "--",
    ".",
    ":(exclude)cql/test",
    ":(exclude)test-reports",
    ":(exclude).ai-flow",
    ":(exclude).gitignore",
  ]);
  if (diff.code !== 0) {
    throw new StageError(clip(diff.stderr || "git diff failed"), "finished", diff.code, "git");
  }
  const extras = listChanges(worktree, base)
    .filter((change) => change.status === "A" && !change.path.startsWith("cql/test/") && !isGeneratedReport(change.path))
    .map((change) => `${change.status}\t${change.path}`)
    .sort()
    .join("\n");
  return `${diff.stdout}\n${extras}`;
}

export function outsideCql(changes: Change[]): string[] {
  return unique(changes.map((change) => change.path).filter((file) => !file.startsWith("cql/")));
}

function ignoredByCheck(file: string): boolean {
  const norm = normalizeRel(file);
  return (
    norm === ".gitignore" ||
    norm === ".sz-dev" ||
    norm.startsWith(".sz-dev/") ||
    // sz-replay seeds skills/ into a replay tree (untracked there); the
    // pipeline treats it as runtime, never as a ticket change.
    norm === "skills" ||
    norm.startsWith("skills/") ||
    // patchText's untracked-file scratch file (left behind only by a hard kill).
    norm === ".ai-flow-empty" ||
    isPipelineRuntime(file)
  );
}

export function isPipelineRuntime(file: string): boolean {
  const norm = normalizeRel(file);
  return norm === ".ai-flow" || norm.startsWith(".ai-flow/");
}

export function isGeneratedReport(file: string): boolean {
  const norm = file.replace(/\\/g, "/");
  return norm === "test-reports" || norm.startsWith("test-reports/") || norm.includes("/test-reports/");
}

export function packageChanges(changes: Change[]): Change[] {
  return changes.filter((change) => !isGeneratedReport(change.path));
}

function normalizeRel(file: string): string {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Assemble the delivery patch text for the current tree: the binary diff
 * against `base` (reports/runtime excluded) plus untracked new files via
 * `git diff --no-index`. Deterministic for a given tree, so phase 4 can
 * byte-compare it against the gate-2 reviewed snapshot.
 *
 * `diffExclude` adds git pathspec exclusions to the tree diff and
 * `pathExclude` drops matching untracked additions — the module adapters use
 * them to snapshot the reviewed (product code) surface without its test area.
 */
export function patchText(
  worktree: string,
  base: string,
  options: { diffExclude?: string[]; pathExclude?: (relPath: string) => boolean } = {},
): string {
  const diff = git(worktree, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--binary",
    base,
    "--",
    ".",
    ":(exclude)cql/test/test-reports",
    ":(exclude)test-reports",
    ":(exclude).ai-flow",
    ":(exclude).gitignore",
    ...(options.diffExclude ?? []),
  ]);
  if (diff.code !== 0) {
    throw new StageError(clip(diff.stderr || "Unable to write the patch"), "finished", diff.code, "git");
  }
  const untracked = packageChanges(listChanges(worktree, base)).filter(
    (change) => change.status === "A" && !options.pathExclude?.(change.path),
  );
  const extra: string[] = [];
  // One scratch file for the whole pass (created once, removed in `finally`)
  // so a crash mid-loop cannot orphan `.ai-flow-empty` in the tree, and a
  // leftover from a hard kill is filtered out of change lists (ignoredByCheck).
  const empty = path.join(worktree, ".ai-flow-empty");
  fs.writeFileSync(empty, "");
  try {
    for (const change of untracked) {
      const abs = path.join(worktree, change.path);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const added = git(worktree, ["-c", "core.quotepath=false", "diff", "--no-index", "--binary", "--", ".ai-flow-empty", change.path]);
      if (added.stdout) extra.push(added.stdout);
    }
  } finally {
    fs.rmSync(empty, { force: true });
  }
  return [diff.stdout, ...extra].filter(Boolean).join("\n");
}

export function writePatch(worktree: string, base: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, patchText(worktree, base), "utf8");
}

/**
 * Narrow a FULL-tree patch (as older ai-flow versions wrote to
 * gate2-reviewed.patch) down to its product-code sections, so a legacy
 * trusted patch can be byte-compared against the current product-surface
 * snapshot: the module's test area legitimately evolves during phase 3, and
 * its sections must be ignored instead of false-failing an upgraded run.
 *
 * Section layout (see patchText): the tree diff's `diff --git` sections are
 * adjacent, and the untracked `--no-index` additions are appended with a
 * single "\n" join — a join lives BEFORE each addition, carried by the
 * preceding section's raw slice. Reconstructing therefore works on each
 * section's OWN text (join stripped) and re-applies the layout: kept tree
 * sections concatenated, kept additions joined by "\n", tree part and
 * additions part joined by "\n" when both are non-empty. The result is
 * byte-identical to patchText run with the matching exclusions (covered by
 * test/pipeline, including the case where the last sections are excluded).
 *
 * A section's target path is the b/ path; for untracked blocks the a/ path
 * is the .ai-flow-empty scratch file, so b/ is the real path. Unrecognizable
 * headers are kept (fail closed at the compare).
 */
export function filterPatchToProductSurface(patch: string, excludePrefixes: string[]): string {
  if (excludePrefixes.length === 0) return patch;
  const marks: number[] = [];
  for (let index = patch.indexOf("diff --git "); index !== -1; index = patch.indexOf("diff --git ", index + 1)) {
    marks.push(index);
  }
  if (marks.length === 0) return patch;
  // Untracked --no-index sections are exactly the ones whose a/ path is the
  // .ai-flow-empty scratch file — patchText's joined "extra" elements.
  const isExtra = (i: number): boolean =>
    patch.slice(marks[i], Math.min(marks[i] + 40, patch.length)).startsWith("diff --git a/.ai-flow-empty ");
  /** The section's own text: its slice minus the join "\n" that precedes the next (extra) section. */
  const ownText = (i: number): string => {
    let end = i + 1 < marks.length ? marks[i + 1] : patch.length;
    if (i + 1 < marks.length && isExtra(i + 1)) end -= 1;
    return patch.slice(marks[i], end);
  };
  const keptTree: string[] = [];
  const keptExtras: string[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (excludedSection(ownText(i), excludePrefixes)) continue;
    (isExtra(i) ? keptExtras : keptTree).push(ownText(i));
  }
  const treePart = keptTree.join("");
  const extrasPart = keptExtras.join("\n");
  if (treePart && extrasPart) return treePart + "\n" + extrasPart;
  return treePart || extrasPart;
}

function excludedSection(section: string, prefixes: string[]): boolean {
  const header = section.split("\n", 1)[0] ?? "";
  // The target path is the text after the LAST " b/" marker. A lazy
  // first-" b/" match mis-splits a header whose a/ side contains the literal
  // substring (a path like `a/foo b/bar` would report target `bar`), which
  // would wrongly drop a product file from the reviewed surface.
  const marker = " b/";
  const index = header.lastIndexOf(marker);
  if (!header.startsWith("diff --git a/") || index < marker.length) return false;
  let target = header.slice(index + marker.length).trim();
  if (target.startsWith('"') && target.endsWith('"') && target.length >= 2) target = target.slice(1, -1);
  return prefixes.some((prefix) => target.startsWith(prefix));
}
