import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StageError } from "../errors.js";
import { diffOutsideCqlTest, outsideCql, packageChanges, patchText } from "../git.js";
import { clip, redact } from "../redact.js";
import type { Change } from "../types.js";
import { claimAdapter } from "./claim.js";

export { claimAdapter };

/**
 * Module adapter contract. The orchestrator picks the adapter matching
 * the module pack chosen in phase1 and routes all module-specific
 * guards and capability commands through it — nothing else in the
 * pipeline may hardcode module paths.
 */
export interface ModuleAdapter {
  /** Pack directory name under skills/sz-dev/references/. */
  module: string;
  /** Pack `check` capability, run by the orchestrator after phase2. */
  check(options: { worktree: string; changedFiles: string[]; logFile: string }): Promise<CheckOutcome>;
  /** Phase2 scope guard: only module code may change. */
  assertPhase2Scope(changes: Change[]): void;
  /** Phase3 scope guard: no code changes outside the pack's test area. */
  assertPhase3Scope(before: string, after: string): void;
  /** Diff snapshot that ignores test reports and pipeline runtime files. */
  phase2Snapshot(worktree: string, base: string): string;
  /**
   * Reviewed-code snapshot for the trusted gate-2 patch in the run dir and
   * the phase-4 byte-compare backstop. The full patch text by default; an
   * adapter may narrow it to the product surface, excluding the module's
   * test area — that area is allowed to evolve during phase 3 (see
   * assertPhase3Scope) and is audited by the human at gate 4.
   */
  phase4Snapshot(worktree: string, base: string): string;
  /**
   * The module's test-area exclusions as data, shared by phase4Snapshot and
   * the legacy-patch compatibility path (filterPatchToProductSurface): a
   * gate2-reviewed.patch written by an ai-flow version that snapshotted the
   * FULL tree is narrowed to its product sections before the phase-4 compare
   * so phase-3 test-area evolution does not false-fail an upgraded run.
   */
  productSurfaceExclusions?: Array<{ gitPathspec: string; pathPrefix: string }>;
}

export interface CheckOutcome {
  passed: boolean;
  output: string;
}

export const cqlAdapter: ModuleAdapter = {
  module: "cql",
  productSurfaceExclusions: [{ gitPathspec: ":(exclude)cql/test", pathPrefix: "cql/test/" }],
  async check({ worktree, changedFiles, logFile }) {
    const lint = path.join(worktree, "cql", "test", "tools", "cql_lint.py");
    if (!fs.existsSync(lint)) {
      // The linter is the only automatic guard for cql correctness. When it is
      // absent we cannot verify the change, so we surface a loud WARNING rather
      // than passing silently — the human must eyeball the diff at review.
      return { passed: true, output: "WARNING: cql_lint.py not present in checkout; pack check SKIPPED (no automatic verification performed)" };
    }
    const output = await runCapture("python3", [lint, "--base", "HEAD", ...changedFiles.filter((file) => file.startsWith("cql/"))], worktree, logFile);
    return { passed: output.code === 0, output: output.text };
  },
  assertPhase2Scope(changes: Change[]): void {
    const scoped = packageChanges(changes);
    if (scoped.length === 0) {
      throw new StageError("Phase 2 produced no changes under cql/", "finished", 1);
    }
    const outside = outsideCql(scoped);
    if (outside.length > 0) {
      throw new StageError(`Changes are outside cql/: ${outside.join(", ")}`, "finished", 1);
    }
  },
  assertPhase3Scope(before: string, after: string): void {
    if (before !== after) {
      throw new StageError(
        "Phase 3 changed files outside the allowed test area (the change surface no longer matches the gate-2 review). Restore the reviewed code, or Reject back to phase2 to re-review deliberately.",
        "finished",
        1,
      );
    }
  },
  phase2Snapshot(worktree: string, base: string): string {
    return diffOutsideCqlTest(worktree, base);
  },
  phase4Snapshot(worktree: string, base: string): string {
    // The module test area (cql/test) is allowed to change during phase 3
    // (assertPhase3Scope ignores it) and ships in the delivery tarball, so
    // the gate-2 backstop compares the product-code surface only.
    const exclusions = this.productSurfaceExclusions ?? [];
    return patchText(worktree, base, {
      diffExclude: exclusions.map((exclusion) => exclusion.gitPathspec),
      pathExclude: (file) => exclusions.some((exclusion) => file.startsWith(exclusion.pathPrefix)),
    });
  },
};

const adapters: Record<string, ModuleAdapter> = {
  cql: cqlAdapter,
  claim: claimAdapter,
};

/**
 * Fallback adapter for module packs that have no dedicated adapter file yet.
 * It applies no module-specific change-surface or pack-check policy (the
 * pipeline's other gates — ticket read-only, git HEAD immutability, MCP
 * fingerprint, human gate 4 — still apply), so a new pack can run end-to-end
 * before its adapter is written. A dedicated src/adapters/<module>.ts is still
 * required for any pack that needs its own scope guard or pack check.
 */
export const genericAdapter: ModuleAdapter = {
  module: "generic",
  async check() {
    return {
      passed: true,
      output: "WARNING: no module adapter for this pack; pack check SKIPPED (no automatic verification performed)",
    };
  },
  assertPhase2Scope() {},
  assertPhase3Scope() {},
  phase2Snapshot(worktree: string, base: string): string {
    return patchText(worktree, base, {});
  },
  phase4Snapshot(worktree: string, base: string): string {
    return patchText(worktree, base, {});
  },
};

export function getAdapter(module: string | undefined): ModuleAdapter {
  const key = (module ?? "cql").toLowerCase();
  return adapters[key] ?? genericAdapter;
}

/**
 * True when `module` falls back to the no-scope-guard generic adapter. The
 * viewer surfaces this as a loud warning: a generic-pack run has NO module
 * change-surface or pack-check protection — the human gate-4 audit is the only
 * backstop that its change is limited to what it should be.
 */
export function adapterIsGeneric(module: string | undefined): boolean {
  return getAdapter(module) === genericAdapter;
}

function runCapture(command: string, args: string[], cwd: string, logFile: string): Promise<{ code: number; text: string }> {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd }, (err, stdout, stderr) => {
      const text = `${stdout}${stderr}`;
      // The on-disk check log is redacted like the other durable logs
      // (hard rule: no cookies/tokens in logs); the returned text is
      // redacted at its other persistence points (state.json error via
      // runPipeline's catch, console via the stage writer).
      fs.appendFileSync(logFile, `\n$ ${command} ${args.join(" ")}\n${redact(text)}`, "utf8");
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new StageError(`Command not found: ${command}`, "startup", null, path.basename(command)));
        return;
      }
      resolve({ code: err ? 1 : 0, text });
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}
