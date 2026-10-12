import { StageError } from "../errors.js";
import { packageChanges, patchText } from "../git.js";
import type { Change } from "../types.js";
import type { ModuleAdapter } from "./index.js";

/**
 * Claim (Billing/Claim) module adapter — the second real implementation of
 * the ModuleAdapter contract, exercising the dimensions cql does not:
 *
 *  - a scope that is TWO roots (frontend + backend) instead of one;
 *  - no module test area at all, so phase3 snapshots are strict
 *    (nothing is allowed to evolve between gate 2 and gate 4);
 *  - a `check` capability that is a manual track, surfaced as a loud
 *    WARNING pass instead of a skipped lint.
 *
 * Scope source: `skills/sz-dev/references/claim/domain/code-map.md`, the
 * section marked VERIFIED 2026-09-02 ("claim main-directory scope"):
 *
 *   - frontend: ehr/src/Charge/Claim/   (Fee.tsx / Claim.tsx / Billing / …)
 *   - backend:  webframe/               (Controller/Claim.php et al.)
 *
 * The rest of the claim map (HOBJS/, util/, scripts/, HOBJS_webess/) is
 * explicitly "historical orientation — verify against the current
 * repository before use". A change landing there fails the guard on
 * purpose: such a run touches shared surfaces and needs the operator's
 * deliberate decision (reject → rework), not a silent pass.
 */

const SCOPE_ROOTS = ["ehr/src/Charge/Claim/", "webframe/"] as const;

function inScope(file: string): boolean {
  return SCOPE_ROOTS.some((root) => file.startsWith(root));
}

export const claimAdapter: ModuleAdapter = {
  module: "claim",
  async check() {
    // The claim pack's `check` capability is a manual track (README.md
    // capability table): there is no linter to run, so nothing is verified
    // mechanically. Pass with a loud WARNING — the human audits the diff at
    // gate 4, and the scope guard above is the mechanical protection.
    return {
      passed: true,
      output:
        "WARNING: claim pack check is a MANUAL track; no automatic verification performed. Scope was checked against ehr/src/Charge/Claim/ + webframe/.",
    };
  },
  assertPhase2Scope(changes: Change[]): void {
    // Generated test reports are pipeline noise, not module changes.
    const scoped = packageChanges(changes).filter((change) => inScope(change.path));
    if (scoped.length === 0) {
      throw new StageError(
        `Phase 2 produced no changes under the claim scope (${SCOPE_ROOTS.join(" or ")}; other claim areas are historical orientation per code-map.md)`,
        "finished",
        1,
      );
    }
    const outside = packageChanges(changes)
      .map((change) => change.path)
      .filter((file) => !inScope(file));
    if (outside.length > 0) {
      throw new StageError(`Changes are outside the claim scope: ${[...new Set(outside)].join(", ")}`, "finished", 1);
    }
  },
  assertPhase3Scope(before: string, after: string): void {
    if (before !== after) {
      throw new StageError(
        "Phase 3 changed files outside the allowed surface (the change surface no longer matches the gate-2 review). Restore the reviewed code, or Reject back to phase2 to re-review deliberately.",
        "finished",
        1,
      );
    }
  },
  phase2Snapshot(worktree: string, base: string): string {
    // No claim test area exists to exclude: the snapshot is the full patch.
    return patchText(worktree, base, {});
  },
  phase4Snapshot(worktree: string, base: string): string {
    return patchText(worktree, base, {});
  },
};
