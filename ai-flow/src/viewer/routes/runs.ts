import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { findPreset } from "../../agents.js";
import { loadConfig } from "../../config.js";
import { isStageError } from "../../errors.js";
import { isProcessAlive } from "../../lock.js";
import { normalizeId } from "../../orchestrator.js";
import { packageDir } from "../../package.js";
import { RedactingLineTransform, redact } from "../../redact.js";
import { resetRun } from "../../reset.js";
import { progressSetGateAsync } from "../../szdev.js";
import { finishStage, readStateOrNull, skipRest, statePath, StateConflictError, withStateUpdate } from "../../store.js";
import { stopPipeline } from "../../stop.js";
import { REWORK_STAGES, type AiFlowConfig, type ReviewRecord, type ReworkStage, type RunState } from "../../types.js";
import type { StreamEvent } from "../../streamFormat.js";
import { loadConfigSafe } from "../configSafe.js";
import { bodyError, dropDocsCache, readBody, send } from "../http.js";
import type { StartRun } from "../apiTypes.js";
import { dropStreamCache, readStreamLog } from "../streamCache.js";

/**
 * Run-lifecycle routes: create, review (approve/reject/answer), stop,
 * message, delete, package download, and the log endpoints.
 */

/**
 * A corrupted state.json must degrade to a JSON error response, never to an
 * unhandled rejection — `handle` runs unawaited, and one bad run record must
 * not be able to crash the whole viewer process.
 */
export function sendCorrupted(response: http.ServerResponse, id: string): void {
  send(response, 500, { error: `Run state for ${id} is corrupted; use 'ai-flow reset ${id}' to start over` });
}


export async function createRun(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  repoRoot: string,
  runsRoot: string,
  startRun: StartRun,
): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch (err) {
    const fail = bodyError(err);
    send(response, fail.status, { error: fail.status === 413 ? fail.error : 'Request body must be JSON, for example {"id":"SZ34623"}' });
    return;
  }
  const raw = body && typeof body === "object" && "id" in body ? String((body as { id: unknown }).id ?? "") : "";
  const model = body && typeof body === "object" && "model" in body ? String((body as { model: unknown }).model ?? "").trim() : "";
  let id: string;
  try {
    id = normalizeId(raw);
  } catch (err) {
    send(response, 400, { error: isStageError(err) ? err.message : "Invalid ticket id" });
    return;
  }

  const runDir = path.join(runsRoot, id);
  if (fs.existsSync(statePath(runDir))) {
    const state = readStateOrNull(runDir);
    if (!state) {
      send(response, 409, { error: `${id} has a corrupted state file and cannot be started; use 'ai-flow reset ${id}' first` });
      return;
    }
    if (state.status === "running") {
      send(response, 409, { error: `${id} is already running` });
      return;
    }
    if (state.status === "awaiting_review") {
      send(response, 409, { error: `${id} is awaiting review and cannot be started again` });
      return;
    }
    if (state.status === "approved") {
      send(response, 409, { error: `${id} is already approved and cannot be started again` });
      return;
    }
  }

  try {
    startRun(repoRoot, id, model || undefined);
  } catch (err) {
    send(response, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  // The spawned pipeline writes state.json only after preflight (config,
  // clean tree) passes. If it dies first, report the real error instead of a
  // misleading "started" response. When the spawn recorded its pid
  // (start-<id>.pgid), a DEAD pid short-circuits the wait: an immediate
  // startup failure (missing config, unknown agent) is surfaced in
  // milliseconds instead of after the whole polling window. A LIVE recorded
  // pid extends the window: a slow preflight (a first-time workspace clone)
  // can legitimately exceed the short window while everything is fine, so
  // when we can prove the process is still working we wait the longer
  // window before answering "may still be starting".
  const logsDir = path.join(path.dirname(runDir), "..", "logs");
  const recordedPid = startPid(logsDir, id);
  const startWaitMs =
    recordedPid !== null
      ? Number(process.env.AI_FLOW_START_WAIT_MS_WITH_PID || START_WAIT_MS_WITH_PID)
      : Number(process.env.AI_FLOW_START_WAIT_MS || START_WAIT_MS);
  const started = await waitForState(runDir, startWaitMs);
  if (!started) {
    const deadEarly = startPidDead(logsDir, id);
    // A dead pid PROVES the pipeline already exited: report its real error.
    // A live (or unrecorded) pid does not prove a failure: a cold start can
    // exceed the window while the pipeline is still coming up — say so.
    const error =
      readStartError(repoRoot, id) ??
      (deadEarly
        ? `The pipeline exited during startup (pid dead) but wrote no state. Check .ai-flow/logs/start-${id}.log and the agent command and its configuration.`
        : `The run has not written its state file yet — it may still be starting. If it does not appear in the run list, check .ai-flow/logs/start-${id}.log and the agent command and its configuration.`);
    send(response, 200, { id, started: false, error });
    return;
  }

  const prior = fs.existsSync(statePath(runDir)) ? readStateOrNull(runDir) : null;
  if (prior?.status === "failed") {
    send(response, 202, { id, resumedFrom: prior.stage });
    return;
  }
  send(response, 202, { id });
}

/** How long createRun waits for the pipeline's state.json before answering when no pid was recorded (injected startRun fakes, or a spawn that died before writing its pgid). */
export const START_WAIT_MS = 5000;
/** The same window when the viewer recorded a LIVE pipeline pid (start-<id>.pgid): the process is verifiably working, so a slow preflight is not yet a reason to say "may still be starting". A dead pid short-circuits this window regardless. */
export const START_WAIT_MS_WITH_PID = 30000;

/**
 * The pid the viewer recorded when it spawned the pipeline
 * (start-<id>.pgid, written by defaultStartRun). Injected startRun fakes
 * (tests) do not write one, so this is undefined and the caller falls back
 * to the timeout path.
 */
function startPid(logsDir: string, id: string): number | null {
  try {
    const pid = Number(fs.readFileSync(path.join(logsDir, `start-${id}.pgid`), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** True when a recorded pipeline pid is gone (the run already died). */
function startPidDead(logsDir: string, id: string): boolean {
  const pid = startPid(logsDir, id);
  return pid !== null && !isProcessAlive(pid);
}

function waitForState(runDir: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const logsDir = path.join(path.dirname(runDir), "..", "logs");
  const id = path.basename(runDir);
  return new Promise((resolve) => {
    const tick = () => {
      if (fs.existsSync(statePath(runDir))) return resolve(true);
      // A dead recorded pid means the pipeline already exited: no point
      // polling to the deadline — the caller surfaces the start log at once.
      if (startPidDead(logsDir, id)) return resolve(false);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

function readStartError(repoRoot: string, id: string): string | null {
  const logPath = path.join(repoRoot, ".ai-flow", "logs", `start-${id}.log`);
  if (!fs.existsSync(logPath)) return null;
  const text = redact(fs.readFileSync(logPath, "utf8")).trim();
  return text || null;
}


export async function reviewRun(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  repoRoot: string,
  runsRoot: string,
  id: string,
  startRun: StartRun,
): Promise<void> {
  const runDir = path.join(runsRoot, id);
  if (!fs.existsSync(statePath(runDir))) {
    send(response, 404, { error: "Run not found" });
    return;
  }
  const state = readStateOrNull(runDir);
  if (!state) {
    sendCorrupted(response, id);
    return;
  }
  if (state.status === "running" || state.rework) {
    send(response, 409, { error: `${id} is already running` });
    return;
  }
  if (state.status !== "awaiting_review") {
    send(response, 409, { error: `${id} is not awaiting review` });
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch (err) {
    const fail = bodyError(err);
    send(response, fail.status, { error: fail.error });
    return;
  }
  const decision = body && typeof body === "object" && "decision" in body ? (body as { decision: unknown }).decision : "";
  const comment =
    body && typeof body === "object" && "comment" in body ? String((body as { comment: unknown }).comment ?? "").trim() : "";
  const at = new Date().toISOString();
  const awaitingKind = state.awaiting?.kind ?? "gate4";
  // Re-check inside every mutator: the pre-check above and the actual write
  // are separated by request-body parsing, and a concurrent action (stop,
  // message, second approve click) may have moved the state in between.
  const requireAwaiting = (s: RunState): void => {
    if (s.status !== "awaiting_review" || s.rework) throw new StateConflictError(`${id} is no longer awaiting review`);
  };

  if (decision === "approve" && awaitingKind !== "gate4") {
    // An escalation answer: re-run the current phase with the answer injected.
    const stage = state.stage;
    if (!isReworkStage(stage)) {
      send(response, 409, { error: `${id} is not in a phase that can consume an answer` });
      return;
    }
    const record: ReviewRecord = { at, decision: "approve", stage, comment };
    try {
      await withStateUpdate(runDir, (s) => {
        requireAwaiting(s);
        s.reviews = [...(s.reviews ?? []), record];
        s.rework = { stage, comment: comment || "(resolved by the human)", at };
      });
    } catch (err) {
      if (err instanceof StateConflictError) {
        send(response, 409, { error: err.message });
        return;
      }
      send(response, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    try {
      startRun(repoRoot, id);
    } catch (err) {
      // The spawn failed: roll the recorded answer back so the run stays
      // awaiting review without a phantom rework comment.
      await withStateUpdate(runDir, (s) => {
        s.rework = undefined;
        s.reviews = (s.reviews ?? []).slice(0, -1);
      }).catch(() => undefined);
      send(response, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    send(response, 202, { id, resumedFrom: stage });
    return;
  }

  if (decision === "approve") {
    let updated: RunState;
    try {
      updated = await withStateUpdate(runDir, (s) => {
        requireAwaiting(s);
        s.status = "approved";
        s.stages.review = { ...(s.stages.review ?? { status: "pending" }), status: "passed" };
        s.reviews = [...(s.reviews ?? []), { at, decision: "approve" }];
        s.error = null;
      });
    } catch (err) {
      if (err instanceof StateConflictError) {
        send(response, 409, { error: err.message });
        return;
      }
      send(response, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    send(response, 200, { id, status: "approved" });
    // Record gate 4 in the sz-dev state machine AFTER the response is sent:
    // sz-progress is an external tool that can run for a while (120s tool
    // timeout), and the sync progressSetGate would run it on the event loop
    // — stalling every other in-flight viewer request while it works.
    // progressSetGateAsync spawns it asynchronously and is fire-and-forget;
    // best effort, the run record is already approved.
    void recordGate4Passed(repoRoot, updated).catch(() => undefined);
    return;
  }
  if (decision === "reject") {
    const stage = body && typeof body === "object" && "stage" in body ? String((body as { stage: unknown }).stage ?? "") : "";
    if (!isReworkStage(stage)) {
      send(response, 400, { error: "Rewind stage must be phase1, phase2, phase3, or phase4" });
      return;
    }
    if (!comment) {
      send(response, 400, { error: "A comment is required" });
      return;
    }
    const record: ReviewRecord = { at, decision: "reject", stage, comment };
    try {
      await withStateUpdate(runDir, (s) => {
        requireAwaiting(s);
        s.reviews = [...(s.reviews ?? []), record];
        s.rework = { stage, comment, at };
      });
    } catch (err) {
      if (err instanceof StateConflictError) {
        send(response, 409, { error: err.message });
        return;
      }
      send(response, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    try {
      startRun(repoRoot, id);
    } catch (err) {
      // The spawn failed: roll the rewind back so the run stays awaiting
      // review without a phantom rework comment.
      await withStateUpdate(runDir, (s) => {
        s.rework = undefined;
        s.reviews = (s.reviews ?? []).slice(0, -1);
      }).catch(() => undefined);
      send(response, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    send(response, 202, { id, resumedFrom: stage });
    return;
  }
  send(response, 400, { error: "decision must be approve or reject" });
}

function isReworkStage(stage: string): stage is ReworkStage {
  return (REWORK_STAGES as readonly string[]).includes(stage);
}


/**
 * Async, fire-and-forget gate-4 record for the sz-dev state machine. Runs
 * after the approve response is sent; spawn is async (no event-loop block),
 * and any failure is swallowed — the run record is already approved and the
 * sz-progress state is re-read on the next pipeline start.
 */
async function recordGate4Passed(repoRoot: string, state: { id: string; szdev: { workspace?: string; replayDir?: string } }): Promise<void> {
  try {
    const config = loadConfig(repoRoot);
    const skillDir = config.szdev?.skillDir ?? path.join(repoRoot, "skills", "sz-dev");
    const workspace = state.szdev.workspace;
    if (workspace && fs.existsSync(path.join(workspace, ".sz-dev"))) {
      await progressSetGateAsync(
        { skillDir, id: state.id, workspace, szDevDir: state.szdev.replayDir ? path.join(state.szdev.replayDir, ".sz-dev") : undefined },
        4,
        "passed",
      );
    }
  } catch {
    // Best effort only.
  }
}

export function sendPackage(response: http.ServerResponse, runsRoot: string, id: string): void {
  const runDir = path.join(runsRoot, id);
  if (!fs.existsSync(statePath(runDir))) {
    send(response, 404, { error: "Run not found" });
    return;
  }
  const state = readStateOrNull(runDir);
  if (!state) {
    sendCorrupted(response, id);
    return;
  }
  const zipPath = state.artifacts?.package;
  if (!zipPath || !fs.existsSync(zipPath) || !fs.statSync(zipPath).isFile()) {
    send(response, 404, { error: "No package is available to download yet" });
    return;
  }
  // state.json is a mirror: a corrupted or hand-edited package path must not
  // turn this download into an arbitrary local file read. Only the pipeline's
  // own tarballs for THIS run (SZ<id>_<Beijing timestamp>.tar.gz in the
  // package dir) are served — the id is bound so a run's record can never
  // be pointed at another ticket's delivery (different runs may coexist in
  // the same package dir).
  const dir = path.resolve(packageDir());
  const resolved = path.resolve(zipPath);
  const name = path.basename(resolved);
  if (!resolved.startsWith(dir + path.sep) || !new RegExp(`^${id}_\\d{12}\\.tar\\.gz$`).test(name)) {
    send(response, 404, { error: "No package is available to download yet" });
    return;
  }
  const isTar = name.endsWith(".tar.gz");
  response.writeHead(200, {
    "content-type": isTar ? "application/gzip" : "application/zip",
    "content-disposition": `attachment; filename="${name}"`,
    "content-length": fs.statSync(zipPath).size,
  });
  fs.createReadStream(zipPath).pipe(response);
}

export async function deleteRun(response: http.ServerResponse, repoRoot: string, runsRoot: string, id: string): Promise<void> {
  if (!fs.existsSync(statePath(path.join(runsRoot, id)))) {
    send(response, 404, { error: "Run not found" });
    return;
  }
  const state = readStateOrNull(path.join(runsRoot, id));
  // A corrupted record is deletable — resetRun only needs the id — so fall
  // through to the reset instead of erroring.
  if (!state) {
    try {
      await resetRun({ repoRoot, id, log: () => undefined, removeWorkspace: true });
    } catch (err) {
      send(response, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    send(response, 200, { id, deleted: true, corrupted: true });
    return;
  }
  // Deleting is a full clean (resetRun stops the live agent and pipeline
  // first, then removes the record, workspaces, replay tree and registry
  // entries), so every state — running, awaiting review, failed — is
  // deletable and the ticket can be re-created from scratch.
  try {
    await resetRun({ repoRoot, id, log: () => undefined, removeWorkspace: true });
  } catch (err) {
    send(response, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  // A re-created run of the same ticket reuses the same log file paths;
  // the parsed-history cache of the deleted run must not feed it.
  dropStreamCache(path.join(runsRoot, id, "logs", ""));
  // Same for the docs cache: the deleted run's workspace is gone, and a
  // re-created run of the same id must not be served the old run's docs.
  dropDocsCache(id);
  send(response, 200, { id, deleted: true });
}


/**
 * Send a human message to the agent of a FAILED run: it is stored as
 * rework guidance on the failed stage and the run respawns, injecting
 * the message into that stage's prompt.
 */
export async function messageRun(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  repoRoot: string,
  runsRoot: string,
  id: string,
  startRun: StartRun,
): Promise<void> {
  const runDir = path.join(runsRoot, id);
  if (!fs.existsSync(statePath(runDir))) {
    send(response, 404, { error: "Run not found" });
    return;
  }
  const state = readStateOrNull(runDir);
  if (!state) {
    sendCorrupted(response, id);
    return;
  }
  if (state.status !== "failed") {
    send(response, 409, { error: `${id} is not failed; use the review actions for awaiting runs` });
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch (err) {
    const fail = bodyError(err);
    send(response, fail.status, { error: fail.error });
    return;
  }
  const comment =
    body && typeof body === "object" && "comment" in body ? String((body as { comment: unknown }).comment ?? "").trim() : "";
  if (!comment) {
    send(response, 400, { error: "A message is required" });
    return;
  }
  const stage = state.stage as ReworkStage;
  if (!(REWORK_STAGES as readonly string[]).includes(stage)) {
    send(response, 409, { error: `${id} failed in ${stage}, which cannot carry a message` });
    return;
  }
  const at = new Date().toISOString();
  try {
    await withStateUpdate(runDir, (s) => {
      if (s.status !== "failed" || s.rework) throw new StateConflictError(`${id} is no longer failed`);
      // "message", not "approve": a failure message is its own review kind —
      // recording it as an approval would pollute the review history.
      s.reviews = [...(s.reviews ?? []), { at, decision: "message", stage, comment }];
      s.rework = { stage, comment, at };
    });
  } catch (err) {
    if (err instanceof StateConflictError) {
      send(response, 409, { error: err.message });
      return;
    }
    send(response, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  try {
    startRun(repoRoot, id);
  } catch (err) {
    await withStateUpdate(runDir, (s) => {
      s.rework = undefined;
      s.reviews = (s.reviews ?? []).slice(0, -1);
    }).catch(() => undefined);
    send(response, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  send(response, 202, { id, resumedFrom: stage, withMessage: comment });
}

export function sendStageLog(response: http.ServerResponse, repoRoot: string, runsRoot: string, id: string, stage: string, raw = false): void {
  // Stage names come from the URL; allow only safe single-path segments
  // under the run's logs directory.
  if (!/^[a-z0-9_-]+$/.test(stage)) {
    send(response, 400, { error: "Invalid stage name" });
    return;
  }
  const file = path.join(runsRoot, id, "logs", `${stage}.log`);
  // Raw download: serve the whole file (redacted, like the preview) so the
  // user can inspect the complete output, bypassing the preview cap.
  if (raw) {
    if (!fs.existsSync(file)) {
      send(response, 404, { error: "Log not found" });
      return;
    }
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${stage}.log"`,
    });
    response.end(redact(fs.readFileSync(file, "utf8")));
    return;
  }
  // Byte cap for the plain-text agents' preview tail. stream-json logs are
  // handled separately below (incrementally parsed, streamCache) because
  // their raw bytes are dominated by streaming deltas that carry a handful
  // of readable lines per megabyte.
  const max = 256 * 1024;
  let preset: ReturnType<typeof findPreset>;
  try {
    const config = loadConfig(repoRoot);
    preset = config.agent ? findPreset(config.agent) : undefined;
  } catch {
    preset = undefined;
  }
  let content = "";
  let events: StreamEvent[] | undefined;
  let exists = false;
  let truncated = false;
  if (fs.existsSync(file)) {
    exists = true;
    if (preset?.stdoutStreamJson) {
      // stream-json: read only the bytes appended since the previous poll
      // and feed the new lines into the persistent formatter/collector
      // (streamCache) — a full re-read every 2s churned the whole
      // multi-hour log through memory. The formatted text stays small
      // (the raw stream is dominated by deltas the formatter collapses);
      // "Download complete log" still serves the raw JSON dump, and the
      // same events are returned structured for the UI's rich rows.
      const view = readStreamLog(file);
      content = view.content;
      events = view.events;
    } else {
      // Plain text: read only the tail the preview can show — a multi-hour
      // agent log can be tens of MB, and a full read would churn that through
      // memory on every poll tick for no visible gain.
      // Decide truncation from the raw byte length, not the decoded string
      // length — a cap boundary can land mid multi-byte character, which
      // would drop bytes on decode and make content.length < max even when
      // the file was actually truncated.
      const size = fs.statSync(file).size;
      truncated = size > max;
      const start = truncated ? size - max : 0;
      const buffer = Buffer.alloc(size - start);
      const fd = fs.openSync(file, "r");
      try {
        fs.readSync(fd, buffer, 0, buffer.length, start);
      } finally {
        fs.closeSync(fd);
      }
      content = buffer.toString("utf8");
    }
  }
  // Agent output can echo credentials into stage logs; redact the served
  // text the same way as full-log downloads and start-error echoes.
  send(response, 200, { id, stage, exists, truncated, content: content ? redact(content) : content, events });
}


/**
 * Concatenate every per-stage log file for a run into one downloadable
 * text file, with `===== <name> =====` section markers so the reader can
 * tell where each stage begins. Covers the known stage logs (including
 * phase2-check) plus the start-<id>.log, and any other .log files found
 * in the run's logs directory. Output is redacted like the previews.
 *
 * Each section is STREAMED (redacting line transform → response) instead of
 * the whole log set being read into memory: a multi-hour run's logs are tens
 * of MB of streaming deltas, and a full read would spike viewer memory per
 * download.
 */
const FULL_LOG_ORDER = ["workspace", "phase1", "phase2", "phase2-check", "phase3", "phase4", "review"];

export async function sendFullLog(response: http.ServerResponse, runsRoot: string, id: string): Promise<void> {
  const logDir = path.join(runsRoot, id, "logs");
  // start-<id>.log is written by the viewer's spawn into the repo-level
  // .ai-flow/logs/ (next to runs/), NOT into the run's own logs dir.
  const repoLogDir = path.join(path.dirname(runsRoot), "logs");
  const files: Array<{ label: string; file: string }> = [];
  const included = new Set<string>();
  const addFile = (label: string, file: string): void => {
    if (!fs.existsSync(file) || included.has(file)) return;
    included.add(file);
    files.push({ label, file });
  };
  addFile(`start-${id}`, path.join(repoLogDir, `start-${id}.log`));
  for (const name of FULL_LOG_ORDER) {
    addFile(name, path.join(logDir, `${name}.log`));
  }
  addFile(`start-${id}`, path.join(logDir, `start-${id}.log`));
  for (const name of fs.existsSync(logDir) ? fs.readdirSync(logDir).filter((name) => name.endsWith(".log")).sort() : []) {
    addFile(name, path.join(logDir, name));
  }
  if (files.length === 0) {
    send(response, 404, { error: "No logs for this run" });
    return;
  }
  response.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": `attachment; filename="${id}-full.log"`,
  });
  try {
    for (const { label, file } of files) {
      response.write(`\n===== ${label} =====\n`);
      await streamSection(fs.createReadStream(file), new RedactingLineTransform(), response);
    }
  } catch {
    // Client went away mid-download (or the file vanished): stop cleanly
    // instead of crashing the viewer on the unhandled rejection.
    response.destroy();
    return;
  }
  response.end();
}

/**
 * Stream one section's file through the redactor into the response,
 * resolving when the file is fully written.
 *
 * The final `.pipe(response, { end: false })` is load-bearing: a ServerResponse
 * AUTO-ENDS itself when a piped stream finishes (the single-file download
 * idiom), so without `{ end: false }` the download would close after the
 * first section. With it, the caller controls the single response.end().
 * (stream.pipeline is equally unusable here: it destroys the destination on
 * the source's end.)
 */
function streamSection(readable: fs.ReadStream, transform: RedactingLineTransform, response: http.ServerResponse): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      readable.destroy();
      reject(err);
    };
    readable.on("error", fail);
    transform.on("error", fail);
    transform.on("end", () => {
      if (settled) return;
      settled = true;
      readable.destroy();
      resolve();
    });
    readable.pipe(transform).pipe(response, { end: false });
  });
}


/**
 * Stop a RUNNING run: kill its pipeline and agent processes and mark
 * the run failed with a "stopped by user" note. The sz-dev state and
 * everything the agent wrote stay on disk, so the usual Retry resumes
 * from the interrupted stage; Delete then fully removes it.
 */
export async function stopRun(response: http.ServerResponse, repoRoot: string, runsRoot: string, id: string): Promise<void> {
  const runDir = path.join(runsRoot, id);
  if (!fs.existsSync(statePath(runDir))) {
    send(response, 404, { error: "Run not found" });
    return;
  }
  const state = readStateOrNull(runDir);
  if (!state) {
    sendCorrupted(response, id);
    return;
  }
  if (state.status !== "running") {
    send(response, 409, { error: `${id} is not running` });
    return;
  }
  // Kills the recorded agent by pid (cmdline-verified) plus the ticket-
  // anchored CLI pattern — never an unanchored agent pattern. Async, so the
  // one-second grace windows don't stall the rest of the HTTP server.
  await stopPipeline(runDir, loadConfigSafe(repoRoot), id);
  // The mark-failed write is a read-modify-write on state.json, which the
  // pipeline also writes; withStateUpdate re-reads after the kill and
  // re-validates, so a write that lost the race is retried, not clobbered.
  try {
    const updated = await withStateUpdate(runDir, (state) => {
      if (state.status !== "running") throw new StateConflictError(`${id} is no longer running (${state.status})`);
      const stage = state.stage;
      finishStage(state, stage, "failed", { exitCode: null, error: "Stopped by user; state preserved — Retry to resume from here." });
      state.status = "failed";
      state.error = `Stopped by user at ${stage}; sz-dev state preserved — Retry to resume, Delete to remove.`;
      skipRest(state, stage);
    });
    send(response, 200, { id, stopped: true, stage: updated.stage });
  } catch (err) {
    if (err instanceof StateConflictError) {
      send(response, 409, { error: err.message });
      return;
    }
    send(response, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
