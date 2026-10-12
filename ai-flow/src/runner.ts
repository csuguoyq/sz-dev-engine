import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expandArgv, findExecutable } from "./agents.js";
import { StageError } from "./errors.js";
import { clip, createLineRedactor } from "./redact.js";

export interface AgentRequest {
  command: string[];
  cwd: string;
  promptFile: string;
  logFile: string;
  /** Model id. Placed on the command when the template has {model}, or appended for a legacy command. */
  model?: string;
  /** Flag used when the command has no {model} token. Overrides the opencode/-m default. */
  modelFlag?: string;
  /** Preset id recorded on the log's first line. Falls back to the executable name. */
  agentId?: string;
  /**
   * File that receives the spawned agent's pid at start (and is removed on
   * exit). `ai-flow stop` uses it to kill exactly this agent process.
   */
  pidFile?: string;
  /**
   * When false, `model` is only written to the log (DeepSeek and ZCode have no model flag).
   * Default true. A template that already contains {model} is filled either way.
   */
  applyModel?: boolean;
  /**
   * Optional regex (string) matched against `<command> --version` output. When
   * set, runAgent fails fast if the resolved agent binary is missing or reports
   * an unexpected version, surfacing a wrong PATH / stale install before the
   * slow, costly agent run begins. Opt-in via config.runner.versionCheck.
   */
  versionCheck?: string;
}

export interface AgentResult {
  exitCode: number;
  commandName: string;
}

export async function runAgent(request: AgentRequest): Promise<AgentResult> {
  const prompt = fs.readFileSync(request.promptFile, "utf8");
  // {promptStdin} feeds the prompt on stdin — sandboxed agents reject
  // reading a prompt file outside their working directory.
  // {promptArg} places the same text in one argv element (dsh, zcode).
  const { argv: finalArgv, stdin: promptContent } = expandArgv(request.command, {
    cwd: request.cwd,
    promptFile: request.promptFile,
    prompt,
    model: request.model,
    applyModel: request.applyModel,
    modelFlag: request.modelFlag,
  });
  const commandName = path.basename(finalArgv[0] ?? "agent");
  const resolved = findExecutable(finalArgv[0] ?? "");
  const agentName = request.agentId || commandName;
  fs.mkdirSync(path.dirname(request.logFile), { recursive: true });
  const log = fs.createWriteStream(request.logFile, { flags: "a" });
  // The Durable stage log is redacted line-by-line: the agent's own output can
  // echo credentials (MCP error text, curl traces, env dumps), and the hard
  // rule "no cookies in logs" applies to the on-disk file, not only to what
  // the viewer serves. The console stream stays raw for readability — the
  // same split as the orchestrator's stage writer. Line-buffered so a secret
  // split across chunks is still caught (createLineRedactor).
  const logRedactor = createLineRedactor((line) => log.write(line));
  const closeLog = (): Promise<void> => {
    logRedactor.flush();
    return endLog(log);
  };
  logRedactor.push(`# agent=${agentName} model=${request.model?.trim() || ""}\n`);
  logRedactor.flush();
  if (!resolved) {
    await closeLog();
    throw new StageError(
      `Command not found: ${commandName}. It is not on PATH or in ~/.local/bin.`,
      "startup",
      null,
      commandName,
    );
  }
  finalArgv[0] = resolved;
  if (request.versionCheck) {
    try {
      const pattern = new RegExp(request.versionCheck);
      const versionProbe = spawnSync(resolved, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      const versionText = `${versionProbe.stdout ?? ""}${versionProbe.stderr ?? ""}`;
      if (versionProbe.error || !pattern.test(versionText)) {
        await closeLog();
        throw new StageError(
          `Agent version check failed for ${commandName} (pattern '${request.versionCheck}' not matched${versionProbe.error ? `: ${versionProbe.error.message}` : ""}). Check the agent install and PATH.`,
          "startup",
          null,
          commandName,
        );
      }
    } catch (err) {
      if (err instanceof StageError) throw err;
      await closeLog();
      throw new StageError(clip(err instanceof Error ? err.message : String(err)), "startup", null, commandName);
    }
  }
  const env = { ...process.env };
  const binDir = path.dirname(resolved);
  const currentPath = env.PATH ?? "";
  if (!currentPath.split(path.delimiter).includes(binDir)) {
    env.PATH = currentPath ? `${binDir}${path.delimiter}${currentPath}` : binDir;
  }

  let child;
  try {
    child = spawn(finalArgv[0], finalArgv.slice(1), {
      cwd: request.cwd,
      env,
      shell: false,
      windowsHide: true,
      // The agent leads its own process group: stop/reap then signal the
      // whole group (killAgentGroup), so a test harness, linter or shell the
      // agent started dies with it instead of surviving as an orphan in the
      // workspace. The runner still awaits the child through its events;
      // `detached` only changes process-group accounting, not stdio.
      detached: true,
    });
  } catch (err) {
    await closeLog();
    throw new StageError(clip(err instanceof Error ? err.message : String(err)), "startup", null, commandName);
  }
  if (promptContent !== null) {
    child.stdin?.end(promptContent);
  }

  if (request.pidFile && child.pid) {
    fs.mkdirSync(path.dirname(request.pidFile), { recursive: true });
    fs.writeFileSync(request.pidFile, String(child.pid), "utf8");
  }
  // Only remove the pid file while it still holds THIS agent's pid — a newer
  // phase's agent may have overwritten it by the time the process is reaped.
  const clearPidFile = (): void => {
    if (!request.pidFile || !child.pid) return;
    try {
      if (fs.readFileSync(request.pidFile, "utf8").trim() === String(child.pid)) {
        fs.rmSync(request.pidFile, { force: true });
      }
    } catch {
      // already gone
    }
  };

  // stderr is retained only to compose the failure message (its clip keeps
  // the tail), so keep just the last half-megabyte: an agent that spews
  // stderr before it dies must not grow this buffer without bound.
  const STDERR_CAP_BYTES = 512 * 1024;
  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  const pushStderr = (chunk: Buffer): void => {
    stderr.push(chunk);
    stderrBytes += chunk.length;
    while (stderrBytes > STDERR_CAP_BYTES && stderr.length > 1) {
      stderrBytes -= stderr.shift()!.length;
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    logRedactor.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    pushStderr(chunk);
    process.stderr.write(chunk);
    logRedactor.push(chunk);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    let settled = false;
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearPidFile();
      void closeLog().then(() => {
        const missing = err.code === "ENOENT";
        reject(new StageError(missing ? `Command not found: ${commandName}` : clip(err.message), "startup", null, commandName));
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearPidFile();
      resolve(code ?? 1);
    });
  });

  logRedactor.flush();
  await endLog(log);
  if (exitCode !== 0) {
    throw new StageError(
      clip(Buffer.concat(stderr).toString("utf8") || `${commandName} exited with code ${exitCode}`),
      "finished",
      exitCode,
      commandName,
    );
  }

  return { exitCode, commandName };
}

function endLog(log: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => log.end(resolve));
}
