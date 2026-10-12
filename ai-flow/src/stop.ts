import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { agentBin } from "./agents.js";
import { agentProcessPatterns } from "./config.js";
import { removeRefTransactionLock } from "./gitLock.js";
import { clearRunLock, killAgentGroup } from "./lock.js";
import { readStateOrNull } from "./store.js";
import type { AiFlowConfig } from "./types.js";

/** Async sleep — the stop path must not block the viewer's event loop. */
export function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run pkill without a shell; a missing pkill is not an error (nothing to kill). */
export function pkillAsync(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("pkill", args, { stdio: "ignore" });
    } catch {
      resolve();
      return;
    }
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

/**
 * Shared "stop a running run" logic for the CLI `stop` command and the
 * viewer's Stop action.
 *
 * The agent is killed by the exact pid the runner recorded in the run's
 * `agent.pid` (with a /proc cmdline check so a stale, reused pid is never
 * killed), sent to the whole process group so the agent's own children die
 * with it. The ai-flow CLI process is killed by the ticket-anchored pkill
 * patterns. No unanchored agent patterns are used: prompt-only commands
 * (deepseek, claude presets) would match every same-shape agent on the
 * machine, which is how an earlier version could kill other tickets.
 *
 * After the pipeline is dead, the git ref-lock hook (installed by the
 * orchestrator around each agent phase) is removed from the run's
 * workspace: a killed pipeline never reaches the finally block that would
 * remove it, and a leaked hook would block the operator's own manual
 * commits in that workspace until the next run re-armed it.
 */

export function agentPidFile(runDir: string): string {
  return path.join(runDir, "agent.pid");
}

/**
 * True when `pid` is alive and (on Linux) its cmdline plausibly belongs to
 * `expectedBin`. The cmdline check is the guard against pid reuse: a stale
 * agent.pid pointing at an unrelated, reused pid must not get killed.
 */
export function agentPidLive(pid: number, expectedBin: string): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "linux" && expectedBin) {
    try {
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      const hit = argv.some((part) => path.basename(part) === expectedBin || part === expectedBin);
      if (!hit) return false;
    } catch {
      return true; // /proc unreadable: trust liveness
    }
  }
  return true;
}

export interface StopAgentOutcome {
  pid: number | null;
  killed: boolean;
  /** No agent.pid found — nothing to kill by pid. */
  missing: boolean;
  /** agent.pid existed but its process is gone or not the expected binary. */
  stale: boolean;
}

/**
 * SIGTERM the recorded agent's process group (the runner spawns the agent
 * `detached`, so it is a group leader and its own children — a test harness
 * or linter the agent started — are in the group), then SIGKILL the group
 * after one second if it survives. Legacy pid files written before the
 * detached spawn fall back to the single pid (killAgentGroup).
 */
export async function stopAgent(runDir: string, config: AiFlowConfig): Promise<StopAgentOutcome> {
  const file = agentPidFile(runDir);
  if (!fs.existsSync(file)) return { pid: null, killed: false, missing: true, stale: false };
  const pid = Number(fs.readFileSync(file, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return { pid: null, killed: false, missing: false, stale: true };
  if (!agentPidLive(pid, agentBin(config))) return { pid, killed: false, missing: false, stale: true };
  if (!killAgentGroup(pid, "SIGTERM")) {
    return { pid, killed: false, missing: false, stale: true };
  }
  await sleepAsync(1000);
  killAgentGroup(pid, "SIGKILL"); // best effort: the group may already be gone
  return { pid, killed: true, missing: false, stale: false };
}

export interface StopPipelineOutcome {
  agent: StopAgentOutcome;
}

/**
 * Stop everything belonging to one run: the recorded agent process, then the
 * ai-flow CLI process (graceful pkill, one second, SIGKILL survivors).
 *
 * Async on purpose: the caller is usually the viewer's HTTP server, and the
 * one-second SIGTERM grace windows must not stall every in-flight request.
 */
export async function stopPipeline(runDir: string, config: AiFlowConfig, id: string): Promise<StopPipelineOutcome> {
  const agent = await stopAgent(runDir, config);
  const patterns = agentProcessPatterns(config, id);
  for (const pattern of patterns) await pkillAsync(["-f", pattern]);
  await sleepAsync(1000);
  for (const pattern of patterns) await pkillAsync(["-9", "-f", pattern]);
  // Remove the git ref-lock hook from the run's workspace (see the module
  // doc): a pipeline killed here never reaches the finally block that would
  // remove it. Safe now that the pipeline is dead — removeRefTransactionLock
  // only touches a hook carrying our marker and restores any user hook it
  // backed up, so it is also a no-op when no hook was installed.
  const state = readStateOrNull(runDir);
  if (state?.szdev?.workspace) {
    removeRefTransactionLock(state.szdev.workspace);
  }
  // Clear the run lock: the pipeline may have been SIGKILL'd and unable to
  // release it from its own finally block, which would otherwise block the
  // next run of this ticket.
  clearRunLock(runDir);
  return { agent };
}
