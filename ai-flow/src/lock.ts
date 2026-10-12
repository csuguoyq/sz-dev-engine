import fs from "node:fs";
import path from "node:path";
import { StageError } from "./errors.js";

/**
 * Per-run mutual-exclusion lock for `ai-flow run`.
 *
 * Why a lock is needed: the CLI `run` and the viewer's `create` both spawn
 * `runPipeline`. Without a lock a user could start the same ticket twice
 * (CLI + viewer, or a double-click) and two pipelines would race on the same
 * sz-dev workspace. The lock also performs orphan recovery: if a previous run
 * crashed and left its agent process alive, `acquireRunLock` reaps that orphan
 * before the new run starts, so we never end up with two agents editing one
 * workspace.
 *
 * The lock records the *pipeline* process pid (the `ai-flow run` node process),
 * not the agent's pid. A crashed pipeline cannot release its own lock, so on
 * acquire we inspect the recorded pid directly: dead -> stale lock, reap any
 * orphan agent and proceed; alive and VERIFIED as an ai-flow pipeline -> a
 * concurrent run, refuse unless `force`; alive but VERIFIED foreign (pid
 * reused by an unrelated process) -> take over; alive but UNVERIFIABLE
 * (cmdline unreadable, e.g. kernel hidepid) -> refuse unless `force`, because
 * it may be another user's live pipeline and reaping it would double-book the
 * workspace.
 */

export interface RunLockHandle {
  pid: number;
  /** Removes the lock only if it still belongs to this handle. */
  release(): void;
}

export function lockFile(runDir: string): string {
  return path.join(runDir, "run.lock");
}

/** True when `pid` is alive and we can signal it (same user). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send `signal` to the agent's PROCESS GROUP when the pid is a group leader
 * (the runner spawns the agent `detached`, so it is its own group leader —
 * and so are its children: a test harness, a linter, a shell the agent
 * started). A bare `kill(pid)` would leave those grandchildren running in
 * the workspace. When the pid is NOT a group leader (a pid file written by
 * an older ai-flow that spawned without `detached`) fall back to the single
 * pid, so recovery keeps working for records predating the change.
 *
 * Returns false only when neither target exists (the process already gone).
 */
export function killAgentGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // ESRCH (no such group: legacy pid file) or EPERM — fall back to the pid.
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Does `pid` look like an `ai-flow run` pipeline, read from
 * /proc/<pid>/cmdline? Three states — the distinction matters for the lock:
 * a VERIFIED-foreign live process may be taken over, but a live process that
 * CANNOT be verified (unreadable cmdline, e.g. kernel hidepid) must be treated
 * as a conflict: silently reaping it could kill another user's live pipeline.
 * ("no" also covers a readable-but-empty cmdline: a zombie, which holds
 * nothing worth protecting, so taking over its number is safe.)
 */
export function probeAiFlowPipeline(pid: number): "yes" | "no" | "unknown" {
  if (process.platform !== "linux") return "unknown";
  try {
    const argv = fs
      .readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .split("\0")
      .filter(Boolean);
    if (argv.length === 0) return "no";
    const isAiFlow = argv.some((part) => /(^|\/)ai-flow$|cli\.(js|ts)$/.test(part));
    const isRun = argv.includes("run");
    return isAiFlow && isRun ? "yes" : "no";
  } catch {
    return "unknown";
  }
}

/** True only when the cmdline positively identifies an ai-flow pipeline. */
export function isAiFlowPipeline(pid: number): boolean {
  return probeAiFlowPipeline(pid) === "yes";
}

/**
 * Kill a lingering agent recorded in the run's agent.pid, if still alive.
 * Escalates SIGTERM -> SIGKILL after one second, mirroring stopAgent: an
 * agent that handles SIGTERM must not survive to double-book the workspace.
 */
async function reapOrphanAgent(runDir: string): Promise<void> {
  const file = path.join(runDir, "agent.pid");
  if (!fs.existsSync(file)) return;
  const pid = Number(fs.readFileSync(file, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) return;
  if (!killAgentGroup(pid, "SIGTERM")) return; // already gone
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (isProcessAlive(pid)) killAgentGroup(pid, "SIGKILL"); // best effort
}

export interface AcquireOptions {
  /** Override a live, recognizable (or unverifiable) ai-flow pipeline lock. */
  force?: boolean;
  /**
   * Test seam for the pid probe. Production uses /proc; tests inject a fake
   * so the unverifiable-live-pid branch (unreadable /proc) is covered without
   * actually making a pid's cmdline unreadable.
   */
  probe?: (pid: number) => "yes" | "no" | "unknown";
}

/**
 * Acquire the per-run lock. The lock file is created with O_EXCL so two
 * concurrent acquirers cannot both win; an existing lock is evaluated for
 * staleness and removed before retrying the atomic create.
 */
export async function acquireRunLock(runDir: string, options: AcquireOptions = {}): Promise<RunLockHandle> {
  fs.mkdirSync(runDir, { recursive: true });
  const file = lockFile(runDir);
  const handle: RunLockHandle = {
    pid: process.pid,
    release() {
      try {
        // Strict pid equality: a substring match could delete a lock owned by
        // a different (e.g. force-taken-over) pipeline.
        const current = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number };
        if (current.pid === process.pid) fs.rmSync(file, { force: true });
      } catch {
        // already gone
      }
    },
  };
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      // No lock existed, but a previous crashed run may have left an agent
      // running; the lock file is already safely in place.
      await reapOrphanAgent(runDir);
      return handle;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    // A lock exists: evaluate it. A live, recognizable pipeline is a
    // conflict — refuse WITHOUT touching its orphan agent.
    let prior: { pid?: number; startedAt?: string } = {};
    try {
      prior = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number; startedAt?: string };
    } catch {
      // corrupted lock file — treat as stale
    }
    const pid = prior.pid;
    const probe = options.probe ?? probeAiFlowPipeline;
    if (typeof pid === "number" && pid > 0 && isProcessAlive(pid)) {
      const verdict = probe(pid);
      if (verdict === "yes" && !options.force) {
        throw new StageError(
          `Another ai-flow run is already in progress for this ticket (pid ${pid}). ` +
            `Stop it first (ai-flow stop ${path.basename(runDir)}), or pass --force.`,
          "startup",
          null,
        );
      }
      // A VERIFIED-foreign live process (a pid reused by an unrelated process)
      // is safe to take over — its number is in the lock but its process is
      // not an ai-flow pipeline. An UNVERIFIABLE live process ("unknown": the
      // cmdline is unreadable) is refused unless forced: it may be another
      // user's live pipeline, and silently reaping it would double-book the
      // workspace — the exact race this lock exists to prevent.
      if (verdict === "unknown" && !options.force) {
        throw new StageError(
          `The run lock is held by a live process (pid ${pid}) that could not be verified ` +
            `(its cmdline is not readable). It may be another ai-flow run. ` +
            `Stop it first (ai-flow stop ${path.basename(runDir)}), or pass --force if you are sure it is safe.`,
          "startup",
          null,
        );
      }
      // verdict === "no" (verified foreign/zombie) or --force: take over.
    }
    // Stale lock (dead pid) or taken-over lock: clean up any orphan agent the
    // previous run may have left behind, then remove the lock and retry the
    // atomic create (another process may claim it in the meantime).
    await reapOrphanAgent(runDir);
    fs.rmSync(file, { force: true });
  }
  throw new StageError(
    `Could not acquire the run lock for ${path.basename(runDir)} (concurrent acquisition).`,
    "startup",
    null,
  );
}

/** Remove the lock unconditionally (used by `stop` after killing the pipeline). */
export function clearRunLock(runDir: string): void {
  fs.rmSync(lockFile(runDir), { force: true });
}
