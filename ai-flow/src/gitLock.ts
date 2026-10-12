import fs from "node:fs";
import path from "node:path";
import { git } from "./git.js";

/**
 * Source-level enforcement of the sz-dev hard rule that the driven agent must
 * never move git HEAD (no commit / checkout / branch / reset / stash).
 *
 * The pipeline itself never writes refs during a run — gate 4 only marks the
 * run approved and builds a delivery tarball. So the *only* thing that can move
 * HEAD is the agent. `assertNoAgentOverreach` already detects a moved HEAD
 * after-the-fact (and then fails the run, requiring a manual baseline restore).
 * This module stops the problem before it happens.
 *
 * We install a git `reference-transaction` hook in the workspace's git dir that
 * aborts every reference transaction while the agent is running. The pipeline
 * installs it immediately before spawning the agent and removes it immediately
 * after, so it only ever constrains the agent and never the pipeline's own
 * (read-only) git calls or the developer's manual operations between phases.
 *
 * The hook is bypassable with `AI_FLOW_REF_OK=1` for any future pipeline-side
 * ref write; it is intentionally NOT set on `process.env` because the agent
 * runner inherits `process.env` (runner.ts) and would otherwise defeat it.
 */

const HOOK_NAME = "reference-transaction";
const MARKER = "ai-flow reference-transaction ref lock";

function hooksDir(worktree: string): string | null {
  const gitDir = git(worktree, ["rev-parse", "--git-dir"]);
  if (gitDir.code !== 0 || !gitDir.stdout.trim()) return null;
  // rev-parse --git-dir may return a path relative to the worktree (e.g. ".git"
  // at the repo root, or an absolute path for a linked worktree); resolve to an
  // absolute directory so the hook is written into the *workspace's* git dir,
  // not the Node process's cwd.
  const gitDirAbs = path.resolve(worktree, gitDir.stdout.trim());
  const configured = git(worktree, ["config", "--get", "core.hooksPath"]);
  const base = configured.code === 0 && configured.stdout.trim() ? path.resolve(worktree, configured.stdout.trim()) : path.join(gitDirAbs, "hooks");
  return base;
}

/**
 * Install the ref-locking hook. Returns true when the hook is in place (or was
 * already in place), false when it could not be installed (e.g. the workspace
 * is not a git repo). Best-effort: a failure only disables the source guard
 * and leaves the after-the-fact `assertNoAgentOverreach` check as the backstop.
 */
export function installRefTransactionLock(worktree: string): boolean {
  const dir = hooksDir(worktree);
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, HOOK_NAME);
    // Back up any pre-existing hook so removal restores it byte-for-byte.
    if (fs.existsSync(target) && !fs.readFileSync(target, "utf8").includes(MARKER)) {
      fs.renameSync(target, `${target}.ai-flow-bak`);
    }
    const script = `#!/bin/sh
# ${MARKER}
# Aborts every git reference transaction (commit/checkout/branch/reset/stash)
# performed by the driven agent. The sz-dev hard rules forbid the agent from
# moving git HEAD; the pipeline commits the reviewed changes itself at gate 4.
# The pipeline may opt out with AI_FLOW_REF_OK=1 (never set on process.env,
# which the agent runner inherits).
if [ "$AI_FLOW_REF_OK" = "1" ]; then
  exit 0
fi
if [ "$1" = "prepared" ]; then
  echo "ai-flow: blocked a git reference update by the driven agent (commit/checkout/branch/reset/stash are forbidden by the sz-dev hard rules)." >&2
  exit 1
fi
exit 0
`;
    fs.writeFileSync(target, script);
    try {
      fs.chmodSync(target, 0o755);
    } catch {
      // best-effort; some filesystems ignore mode
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the ref-locking hook, restoring any hook we backed up on install.
 * Safe to call when no hook was installed.
 */
export function removeRefTransactionLock(worktree: string): void {
  const dir = hooksDir(worktree);
  if (!dir) return;
  const target = path.join(dir, HOOK_NAME);
  try {
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8").includes(MARKER)) {
      fs.rmSync(target, { force: true });
    }
    const backup = `${target}.ai-flow-bak`;
    if (fs.existsSync(backup)) {
      fs.renameSync(backup, target);
    }
  } catch {
    // best-effort cleanup
  }
}
