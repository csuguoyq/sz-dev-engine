import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StageError } from "./errors.js";
import { listChanges, packageChanges } from "./git.js";
import { clip } from "./redact.js";
import type { Change } from "./types.js";

/**
 * Delivery packaging, following the sz-dev phase-4 rules: a plain
 * tar.gz of the changed files written to ~/sz (override with
 * SZ_PACKAGE_DIR for tests), named SZxxxx_<Beijing timestamp>.tar.gz.
 * Standard mode packs the working-tree diff against the base commit;
 * replay mode callers pass the `sz-replay diff --names` list instead.
 */

/**
 * Current time in Asia/Shanghai formatted as YYYYMMDDHHMM.
 *
 * Manual fixed UTC+8 offset (Asia/Shanghai has no DST): exact, cheap, and
 * independent of the ICU timezone data bundled with the Node build —
 * `Intl.DateTimeFormat` with `hour12: false` has a known "24" hour quirk
 * at midnight in some ICU versions, which would produce invalid names.
 */
export function beijingTimestamp(now = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const p = (value: number): string => String(value).padStart(2, "0");
  return (
    String(shifted.getUTCFullYear()).padStart(4, "0") +
    p(shifted.getUTCMonth() + 1) +
    p(shifted.getUTCDate()) +
    p(shifted.getUTCHours()) +
    p(shifted.getUTCMinutes())
  );
}

export function packageDir(): string {
  return process.env.SZ_PACKAGE_DIR || path.join(os.homedir(), "sz");
}

export function packageName(id: string, now = new Date()): string {
  return `${id}_${beijingTimestamp(now)}.tar.gz`;
}

/** Changed paths for the delivery: working-tree diff vs base, minus reports and runtime state. */
export function changedPathsStandard(worktree: string, base: string): string[] {
  const changes: Change[] = packageChanges(listChanges(worktree, base));
  return [
    ...new Set(
      changes
        .filter((change) => change.status !== "D")
        .map((change) => change.path)
        .filter((file) => file !== ".sz-dev" && !file.startsWith(".sz-dev/")),
    ),
  ];
}

export function createTarPackage(options: {
  worktree: string;
  paths: string[];
  id: string;
  now?: Date;
  destinationDir?: string;
}): { tarPath: string; paths: string[] } {
  // The tarball holds only changed files that exist in the tree. Deletions
  // are intentionally absent (there is nothing to tar) and are represented
  // exclusively by the CHANGES patch — the phase-4 prompt tells the agent,
  // and the gate-4 reviewer applies the patch as the authoritative change
  // record, so a deletion is never "lost" by this filter.
  const paths = options.paths.filter((file) => fs.existsSync(path.join(options.worktree, file)));
  if (paths.length === 0) {
    throw new StageError("No changed files to package", "finished", 1, "package");
  }
  const destination = options.destinationDir ?? packageDir();
  fs.mkdirSync(destination, { recursive: true });
  const tarPath = path.join(destination, packageName(options.id, options.now));
  // "./" prefix: a changed file whose name begins with "-" (legal in git at
  // the repo top level) would otherwise be parsed by tar as an option.
  const result = spawnSync("tar", ["czf", tarPath, "-C", options.worktree, ...paths.map((file) => `./${file}`)], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) {
    throw new StageError(clip(result.stderr || "tar failed"), "finished", result.status ?? 1, "tar");
  }
  return { tarPath, paths };
}
