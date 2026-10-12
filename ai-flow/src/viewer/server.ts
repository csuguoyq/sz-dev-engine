import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StageError } from "../errors.js";
import { RedactingLineTransform } from "../redact.js";
import { loadConfigSafe } from "./configSafe.js";
import { RateLimiter } from "./guards.js";
import { send } from "./http.js";
import { handleRoutes, type StartRun } from "./routes.js";

export type { StartRun };

/** Default viewer rate ceiling (requests/minute per client) when ui.rateLimitPerMinute is unset. */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;

/**
 * Locate the built CLI. Prefer the package's own dist/cli.js (this module
 * lives in <package>/src|dist/viewer, so two levels up is the package root)
 * — that works whether the git root is the ccsrc super-repo with ai-flow/ as
 * a subdirectory or ai-flow itself is the repo root. Fall back to the
 * legacy hardcoded layout for checkouts where the package dist is not
 * colocated with the module under test.
 */
function resolveCliPath(repoRoot: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(here, "..", "..");
  const candidates = [
    path.join(packageRoot, "dist", "cli.js"),
    path.join(repoRoot, "ai-flow", "dist", "cli.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

/**
 * Wire a spawned pipeline's stdout/stderr into the redacted start log.
 *
 * The on-disk start log is REDACTED line-by-line: the pipeline's stdout is
 * the agent's live stream (the runner tees raw console output to it), and
 * the hard rule "no cookies in logs" applies to the file, not only to what
 * the viewer serves. The transform also keeps the write backpressured.
 *
 * A DISK error on the capture log (the path colliding with a directory,
 * ENOSPC, a detached filesystem) must neither crash the viewer process nor
 * apply back-pressure to the pipeline: the file is dropped and the redactor
 * is left flowing (discarding) so the detached run can still finish.
 * Exported so the wiring is testable without spawning the real CLI.
 */
export function wireStartLog(child: ChildProcess, logPath: string): void {
  const file = fs.createWriteStream(logPath, { flags: "w" });
  const redactor = new RedactingLineTransform();
  redactor.pipe(file);
  file.on("error", () => {
    // Drop the broken file and keep the redactor draining: unpipe stops the
    // pipe from pausing the child's stdout on back-pressure, and resume()
    // consumes (discards) the redactor's readable side so the transform
    // never buffers again. Without this, a write failure would stall the
    // whole pipeline once its stdout pipe filled.
    try {
      redactor.unpipe(file);
    } catch {
      // already detached
    }
    file.destroy();
    redactor.resume();
  });
  child.stdout?.pipe(redactor);
  child.stderr?.pipe(redactor);
  child.on("error", () => {
    redactor.end();
  });
  child.on("close", () => {
    // Reap the detached child (no zombies: the pgid liveness check stays
    // accurate) and flush the redactor into the log.
    redactor.end();
  });
}

export function defaultStartRun(repoRoot: string, id: string, model?: string): void {
  const logDir = path.join(repoRoot, ".ai-flow", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `start-${id}.log`);
  const args = [resolveCliPath(repoRoot), "run", id];
  if (model) args.push("--model", model);
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  // The pgid file lets createRun detect an immediate startup failure (a dead
  // pid before state.json exists) instead of waiting out the polling window.
  // `ai-flow reset` already removes start-<id>.pgid.
  if (child.pid) {
    try {
      fs.writeFileSync(path.join(logDir, `start-${id}.pgid`), String(child.pid), "utf8");
    } catch {
      // best effort: the wait falls back to the timeout path
    }
  }
  wireStartLog(child, logPath);
  child.unref();
}

function viewerDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "viewer-ui");
}

export function startUi(
  repoRoot: string,
  host: string,
  port: number,
  options: { startRun?: StartRun } = {},
): Promise<http.Server> {
  if (!host) {
    return Promise.reject(new StageError("ui.host must not be empty.", "startup", null));
  }
  const startRun = options.startRun ?? defaultStartRun;
  const runsRoot = path.join(repoRoot, ".ai-flow", "runs");
  const staticRoot = viewerDir();
  // One limiter per viewer process; the ceiling comes from ui.rateLimitPerMinute
  // (0 disables). Re-read per request so an operator can change the config
  // without restarting — the limiter is rebuilt only when the value changes.
  let rateLimit = Number.NaN;
  let limiter: RateLimiter = new RateLimiter(Number.NaN);
  const server = http.createServer((request, response) => {
    const configured = loadConfigSafe(repoRoot).ui?.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE;
    if (configured !== rateLimit) {
      rateLimit = configured;
      limiter = new RateLimiter(configured);
    }
    // A handler bug must not take the whole viewer down with it: an
    // unhandled rejection would crash the process (Node >= 15).
    void handleRoutes(request, response, repoRoot, runsRoot, host, port, startRun, staticRoot, limiter).catch((err) => {
      try {
        if (!response.headersSent) {
          send(response, 500, { error: err instanceof Error ? err.message : String(err) });
        } else {
          response.end();
        }
      } catch {
        // connection already gone
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
