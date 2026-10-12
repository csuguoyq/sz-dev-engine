#!/usr/bin/env node
import { loadConfig, uiBind } from "./config.js";
import { isStageError } from "./errors.js";
import { repoRoot } from "./git.js";
import { runInit } from "./init.js";
import { normalizeId, runPipeline } from "./orchestrator.js";
import { resetRun } from "./reset.js";
import { clip } from "./redact.js";
import { formatStageLine, listRuns, readStateOrNull, writeState } from "./store.js";
import { stopPipeline } from "./stop.js";
import { startUi } from "./viewer/server.js";
import fs from "node:fs";
import path from "node:path";
import type { AiFlowConfig } from "./types.js";

const [command, argument] = process.argv.slice(2);

async function main(): Promise<number> {
  // ai-flow is Linux-only by design: the run-lock stale detection reads
  // /proc/<pid>/cmdline, stop/reset rely on pkill, and the ref-lock hook
  // semantics assume POSIX. Fail fast with a clear message instead of a
  // half-functional tool (e.g. a stop that silently kills nothing).
  if (process.platform !== "linux") {
    console.error(`ai-flow requires Linux (this build ran on "${process.platform}"): /proc and pkill are load-bearing. It is not supported on other platforms.`);
    return 1;
  }
  const root = repoRoot(process.cwd());
  if (command === "run") {
    if (!argument) return usage();
    const modelFlagIndex = process.argv.indexOf("--model");
    const model = modelFlagIndex >= 0 ? process.argv[modelFlagIndex + 1] : undefined;
    const force = process.argv.includes("--force");
    try {
      const result = await runPipeline({ repoRoot: root, id: normalizeId(argument), model, force });
      return result.exitCode;
    } catch (err) {
      console.error(clip(err instanceof Error ? err.message : String(err)));
      return isStageError(err) && err.kind === "finished" ? 2 : 1;
    }
  }
  if (command === "status") {
    const runsRoot = path.join(root, ".ai-flow", "runs");
    const runs = listRuns(runsRoot);
    if (argument) {
      const id = normalizeId(argument);
      const found = runs.find((run) => run.id === id);
      if (!found) {
        console.error(`No run record for ${id}`);
        return 1;
      }
      printRun(found.id, found.stage, found.status);
      return 0;
    }
    if (runs.length === 0) {
      console.log("No run records");
      return 0;
    }
    for (const run of runs) printRun(run.id, run.stage, run.status);
    return 0;
  }
  if (command === "ui") {
    let host = "127.0.0.1";
    let port = 4173;
    try {
      const bind = uiBind(loadConfig(root));
      host = bind.host;
      port = bind.port;
    } catch {
      // The status page can open existing run records before an agent command is configured.
    }
    const server = await startUi(root, host, port);
    const address = server.address();
    const shown = address && typeof address === "object" ? address.port : port;
    console.log(`ai-flow ui  http://${host}:${shown}`);
    await new Promise(() => undefined);
    return 0;
  }
  if (command === "reset") {
    if (!argument) return usage();
    try {
      await resetRun({ repoRoot: root, id: normalizeId(argument), removeWorkspace: process.argv.includes("--remove-workspace") });
      return 0;
    } catch (err) {
      console.error(clip(err instanceof Error ? err.message : String(err)));
      return 1;
    }
  }
  if (command === "init") {
    const flags = parseInitFlags(process.argv.slice(3));
    try {
      await runInit({ repoRoot: root, agent: flags.agent, model: flags.model, yes: flags.yes });
      return 0;
    } catch (err) {
      console.error(clip(err instanceof Error ? err.message : String(err)));
      return 1;
    }
  }
  if (command === "stop") {
    if (!argument) return usage();
    try {
      const id = normalizeId(argument);
      const runDir = path.join(root, ".ai-flow", "runs", id);
      if (!fs.existsSync(path.join(runDir, "state.json"))) {
        console.error(`No run record for ${id}`);
        return 1;
      }
      const state = readStateOrNull(runDir);
      if (!state) {
        console.error(`Run record for ${id} is corrupted; run 'ai-flow reset ${id}' to start over.`);
        return 1;
      }
      if (state.status !== "running") {
        console.error(`${id} is not running (${state.status})`);
        return 1;
      }
      let config: AiFlowConfig = { runner: { command: [] } };
      try {
        config = loadConfig(root);
      } catch {
        // Without a config we can still stop by pid file and CLI pattern.
      }
      await stopPipeline(runDir, config, id);
      const stored = readStateOrNull(runDir);
      if (!stored) {
        console.error(`Run record for ${id} is corrupted; run 'ai-flow reset ${id}' to start over.`);
        return 1;
      }
      stored.status = "failed";
      stored.error = `Stopped by user at ${stored.stage}; sz-dev state preserved — Retry to resume, Delete to remove.`;
      writeState(runDir, stored);
      console.log(`${id}  stopped at ${stored.stage}; run again to resume`);
      return 0;
    } catch (err) {
      console.error(clip(err instanceof Error ? err.message : String(err)));
      return 1;
    }
  }
  return usage();
}

function printRun(id: string, stage: string, status: string): void {
  console.log(formatStageLine(id, stage, status));
}

function parseInitFlags(argv: string[]): { agent?: string; model?: string; yes: boolean } {
  let agent: string | undefined;
  let model: string | undefined;
  let yes = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--yes") {
      yes = true;
      continue;
    }
    if (flag === "--agent") {
      agent = argv[i + 1];
      i += 1;
      if (!agent) throw new Error("--agent requires a value (cursor, claude, chatgpt, deepseek, zcode, opencode).");
      continue;
    }
    if (flag === "--model") {
      model = argv[i + 1];
      i += 1;
      if (model === undefined) throw new Error("--model requires a value. Pass an empty string to keep the CLI default.");
      continue;
    }
    throw new Error(`Unknown init option: ${flag ?? ""}`);
  }
  return { agent, model, yes };
}

function usage(): number {
  console.log(`Usage:
  ai-flow init [--agent cursor] [--model id] [--yes]
                         Choose an agent and model and write ai-flow.config.json
  ai-flow run SZ34623 [--model provider/model] [--force]
                         Resume from the failed stage when the previous run failed
                         --force overrides a live run lock (use only after stopping the other run)
  ai-flow stop SZ34623   Stop a running run (state preserved; run again to resume)
  ai-flow reset SZ34623  Delete the run record, sz-dev state, and replay tree so the next run starts over
  ai-flow status [SZ34623]
  ai-flow ui`);
  // Unknown command AND no command both exit 1: a bare `ai-flow` is a usage
  // mistake, not a successful run.
  return 1;
}

// Set process.exitCode instead of process.exit so the event loop drains
// naturally: open log streams and child-process pipes get flushed before the
// process leaves. `ui` stays alive on its own (its server keeps the loop
// populated); every other command exits once no handles remain.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(clip(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  },
);
