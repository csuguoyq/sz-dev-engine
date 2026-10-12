import { spawn } from "node:child_process";

/**
 * Promise wrapper over child_process.spawn for the viewer's shell probes
 * (model listings, session-log probes, status commands). The viewer used to
 * run these with spawnSync: a slow or wedged probe blocked the entire HTTP
 * event loop for its full timeout, freezing every other in-flight request
 * (the run list poll, the live log, an in-flight approve). These probes are
 * short by design, so a bounded timeout with SIGKILL keeps the failure mode
 * to a 404/empty instead of a hang.
 */
export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the spawn itself failed (ENOENT, ...) — distinct from a non-zero exit. */
  error?: string;
  /** Set when the timeout fired and the child was killed. */
  timedOut?: boolean;
}

export function spawnAsync(
  command: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: null, stdout, stderr, error: err.message });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
