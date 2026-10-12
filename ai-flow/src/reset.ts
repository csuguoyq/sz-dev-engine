import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliRunPattern, loadConfig } from "./config.js";
import { removeRefTransactionLock } from "./gitLock.js";
import { runPaths } from "./git.js";
import { readStateOrNull } from "./store.js";
import { pkillAsync, sleepAsync, stopPipeline } from "./stop.js";

/**
 * Reset a finished (or stuck) run so the pipeline can start over from
 * scratch. Deleting means a clean slate:
 * - the live agent and pipeline processes are stopped first — removing the
 *   record under a running pipeline leaves an orphan that keeps writing into
 *   the workspace and registry;
 * - the ai-flow run record (state.json, prompts, logs, artifacts);
 * - the sz-dev state directory (.sz-dev/SZxxxx) in the resolved workspace;
 * - the created workspace clone and, in replay mode, the replay tree
 *   including its `_aireplay` wrapper directory;
 * - every registry entry for the SZ (workspace, mode, replay path/meta), so
 *   the next run re-derives everything from scratch.
 */
export function registryDir(): string {
  return process.env.SZ_WORKSPACE_REGISTRY || path.join(os.homedir(), ".sz-dev-workspaces");
}

export async function resetRun(options: {
  repoRoot: string;
  id: string;
  /** Accepted for compatibility; removal is always a full clean now. */
  removeWorkspace?: boolean;
  log?: (line: string) => void;
}): Promise<void> {
  const log = options.log ?? ((line) => console.log(line));
  const id = options.id;
  const digits = id.replace(/^SZ/i, "");
  const registry = registryDir();
  const repoRoot = path.resolve(options.repoRoot);
  const home = os.homedir();
  const removed: string[] = [];

  const remove = (target: string): void => {
    if (!target || !fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(target);
  };

  // 0. Stop everything still executing for this run. The recorded agent dies
  // by its pid file, the pipeline by the ticket-anchored pkill patterns.
  const { runDir } = runPaths(options.repoRoot, id);
  try {
    await stopPipeline(runDir, loadConfig(options.repoRoot), id);
  } catch {
    // Config unavailable — still kill the pipeline by its anchored pattern so
    // no orphan survives the record deletion. cliRunPattern is the single
    // source for this pattern: it is valid POSIX ERE (the PCRE non-capturing
    // (?:js|ts) form made pkill's regcomp fail and kill nothing) and carries
    // the trailing boundary that keeps prefix-related tickets apart.
    const pattern = cliRunPattern(id);
    await pkillAsync(["-f", pattern]);
    await sleepAsync(1000);
    await pkillAsync(["-9", "-f", pattern]);
  }
  // The ref-lock hook (installed around each agent phase) leaks when the
  // pipeline dies without running its finally. stopPipeline above already
  // removed it in the normal path; this covers the fallback (config
  // missing) and a pipeline that crashed before this reset ran. Safe to
  // read the state while runDir still exists: removeRefTransactionLock is
  // a no-op when no marker hook is installed.
  const stoppedState = readStateOrNull(runDir);
  if (stoppedState?.szdev?.workspace) removeRefTransactionLock(stoppedState.szdev.workspace);

  // 1. ai-flow run record, plus the viewer-spawned start log and process
  // group file that live one level up (.ai-flow/logs/start-<id>.*, next to
  // runs/).
  remove(runDir);
  const startLogs = path.join(path.dirname(runDir), "..", "logs");
  remove(path.join(startLogs, `start-${id}.log`));
  remove(path.join(startLogs, `start-${id}.pgid`));

  // 2. registry entries + created trees. The registry is trusted about WHERE
  // things live, but a checkout that resolves to the repo root or the home
  // directory itself is never removed (only its sz-dev state).
  const workspaceEntry = path.join(registry, `SZ${digits}`);
  const replayEntry = path.join(registry, `replay-SZ${digits}.path`);
  const modeEntry = path.join(registry, `SZ${digits}.mode`);

  const mode = fs.existsSync(modeEntry) ? fs.readFileSync(modeEntry, "utf8").trim() : "";
  if (mode === "replay" && fs.existsSync(replayEntry)) {
    const replayDir = fs.readFileSync(replayEntry, "utf8").trim();
    // Same guards as the workspace path: a registry entry that resolves to
    // the repo root, the home directory or the filesystem root is never
    // removed (only its state entries are).
    const resolvedReplay = path.resolve(replayDir);
    if (resolvedReplay !== repoRoot && resolvedReplay !== home && resolvedReplay !== path.parse(resolvedReplay).root) {
      remove(replayDir);
    } else {
      log(`kept replay tree: ${replayDir} (guarded path — registry entries removed only)`);
    }
    // sz-replay init seeds <project>_aireplay/ccsrc — drop the wrapper dir
    // too when it only wrapped the replay tree.
    const wrapper = path.dirname(path.resolve(replayDir));
    if (/_aireplay$/.test(wrapper) && wrapper !== repoRoot && wrapper !== home) remove(wrapper);
    fs.rmSync(replayEntry, { force: true });
    fs.rmSync(path.join(registry, `replay-SZ${digits}.meta`), { force: true });
    log(`removed replay tree: ${replayDir}`);
  }

  if (fs.existsSync(workspaceEntry)) {
    const workspace = fs.readFileSync(workspaceEntry, "utf8").trim();
    const resolved = path.resolve(workspace);
    remove(path.join(workspace, ".sz-dev", `SZ${digits}`));
    if (resolved !== repoRoot && resolved !== home && resolved !== path.parse(resolved).root) {
      remove(workspace);
      fs.rmSync(workspaceEntry, { force: true });
      log(`removed workspace: ${workspace}`);
    } else {
      log(`kept workspace checkout: ${workspace} (state cleared only)`);
    }
  }

  // The mode verdict is re-derived by the next ensure — a full delete takes
  // its registry entry with it.
  fs.rmSync(modeEntry, { force: true });
  log(`reset ${id}: removed ${removed.length} director${removed.length === 1 ? "y" : "ies"}; next run starts from the workspace stage`);
}
