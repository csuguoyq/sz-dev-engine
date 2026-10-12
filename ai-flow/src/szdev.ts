import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StageError } from "./errors.js";
import { clip } from "./redact.js";
import { registryDir } from "./reset.js";
import type { GateNumber, GateStatus } from "./types.js";

/**
 * Typed wrapper over the sz-dev control plane (skills/sz-dev/tools/*).
 * sz-progress (progress.md) is the single source of truth for phase /
 * gate / escalation state; this module only shells out and parses the
 * tools' documented output contracts. All parsing helpers are pure so
 * they can be unit tested against recorded output samples.
 */

export interface ToolOptions {
  skillDir: string;
  /** Tool file name under <skillDir>/tools (for example "sz-progress"). */
  tool: string;
  args: string[];
  cwd?: string;
  /** Extra environment (for example SZ_DEV_DIR for a replay tree). */
  env?: Record<string, string>;
  /** Working directory whose git history the tool inspects. */
  timeoutMs?: number;
  /**
   * Number of attempts for a transient failure before giving up (default 3).
   * Only failures whose output matches a transient signature are retried.
   */
  retries?: number;
  /** When true, retry exit statuses whose output looks like a transient/lock race. */
  retryOnTransient?: boolean;
}

/** How many times a control-plane tool may be retried on a transient failure. */
export const CONTROL_TOOL_RETRIES = 3;

/** Signatures of failures worth retrying (lock races, transient git/network blips). */
const TRANSIENT = /locked|\block\b|busy|temporarily unavailable|resource temporarily unavailable|could not acquire|exit status 255|timed out|connection reset|eagain|try again/i;

function isTransient(result: ToolResult): boolean {
  return TRANSIENT.test(`${result.stderr}\n${result.stdout}`);
}

/** Async backoff between retry attempts (total bounded, 200+400ms worst case). */
function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ToolResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * One spawn of the tool: resolves with the exit result, rejects with a
 * StageError for a spawn failure (ENOENT, ...) or a timeout. A timeout is
 * reported as a timeout — the sync variant set `ETIMEDOUT` in the same
 * `error` slot a spawn failure uses, and the message said "failed to start"
 * for a tool that ran and ran long.
 */
function spawnToolOnce(options: ToolOptions, toolPath: string): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    Object.assign(env, options.env ?? {});
    const child = spawn("bash", [toolPath, ...options.args], {
      cwd: options.cwd,
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
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
      // Startup failures (ENOENT, spawn error) are never transient.
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new StageError(`${options.tool} failed to start: ${err.message}`, "startup", null, options.tool));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (timedOut) {
        reject(new StageError(`${options.tool} timed out after ${options.timeoutMs ?? 120_000}ms`, "startup", null, options.tool));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Async variant of the sync runTool this replaced: spawns the sz-dev tool
 * and awaits it without blocking the event loop. Retry semantics are
 * unchanged — transient signatures (lock races, EAGAIN, ...) are retried
 * with a short backoff; spawn failures and timeouts reject immediately.
 */
export async function runTool(options: ToolOptions): Promise<ToolResult> {
  const toolPath = path.join(options.skillDir, "tools", options.tool);
  if (!fs.existsSync(toolPath)) {
    throw new StageError(`sz-dev tool not found: ${toolPath}`, "startup", null, options.tool);
  }
  const maxAttempts = Math.max(1, options.retries ?? CONTROL_TOOL_RETRIES);
  const retryTransient = options.retryOnTransient ?? true;
  let last: ToolResult | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // The async spawn streams stdout/stderr, so the 256MB maxBuffer the
    // sync variant needed for large replay diffs is not a constraint here.
    const toolResult = await spawnToolOnce(options, toolPath);
    last = toolResult;
    if (toolResult.code === 0) return toolResult;
    if (attempt < maxAttempts - 1 && retryTransient && isTransient(toolResult)) {
      await sleepAsync(200 * (attempt + 1));
      continue;
    }
    return toolResult;
  }
  return last ?? { code: 1, stdout: "", stderr: "" };
}

export async function runToolOrThrow(options: ToolOptions, failureKind: "startup" | "finished" = "finished"): Promise<string> {
  const result = await runTool(options);
  if (result.code !== 0) {
    throw new StageError(
      clip(result.stderr.trim() || result.stdout.trim() || `${options.tool} exited with code ${result.code}`),
      failureKind,
      result.code,
      options.tool,
    );
  }
  return result.stdout;
}

export interface ToolStreamOptions {
  skillDir: string;
  /** Tool file name under <skillDir>/tools (for example "sz-workspace"). */
  tool: string;
  args: string[];
  cwd?: string;
  /** Extra environment (for example SZ_DEV_DIR for a replay tree). */
  env?: Record<string, string>;
  /** Working directory whose git history the tool inspects. */
  timeoutMs?: number;
  /** Receives each complete line of stdout/stderr as soon as it is flushed. */
  onLine?: (line: string) => void;
}

/**
 * Async, streaming variant of `runTool`. Spawns the tool and forwards every
 * complete output line to `onLine` as it is produced instead of buffering
 * until exit. Used for slow tools — `sz-workspace ensure` can clone the full
 * ccsrc history over many minutes, and `spawnSync` would otherwise leave the
 * run silent the whole time. The full stdout is still returned (and parsed)
 * once the process exits.
 */
export async function runToolStream(options: ToolStreamOptions): Promise<ToolResult> {
  const toolPath = path.join(options.skillDir, "tools", options.tool);
  if (!fs.existsSync(toolPath)) {
    throw new StageError(`sz-dev tool not found: ${toolPath}`, "startup", null, options.tool);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  Object.assign(env, options.env ?? {});
  const child = spawn("bash", [toolPath, ...options.args], {
    cwd: options.cwd,
    env,
    windowsHide: true,
  });

  const makeFeeder = (sink: string[]) => {
    let rest = "";
    return {
      push(chunk: Buffer) {
        const text = chunk.toString("utf8");
        sink.push(text);
        const lines = (rest + text).split(/\r?\n/);
        rest = lines.pop() ?? "";
        for (const line of lines) options.onLine?.(line);
      },
      flush() {
        if (rest) options.onLine?.(rest);
      },
      text() {
        return sink.join("");
      },
    };
  };
  const out = makeFeeder([]);
  const err = makeFeeder([]);
  child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));

  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs)
    : null;
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.on("error", (err: NodeJS.ErrnoException) =>
        reject(new StageError(`${options.tool} failed to start: ${err.message}`, "startup", null, options.tool)),
      );
      child.on("close", (c) => resolve(c ?? 1));
    });
    out.flush();
    err.flush();
    if (timer) clearTimeout(timer);
    // A timeout kill surfaces as code 1; say so, so the operator does not
    // chase a tool bug that is really "took longer than timeoutMs".
    let stderr = err.text();
    if (timedOut && options.timeoutMs) {
      const note = `${options.tool} timed out after ${options.timeoutMs}ms and was killed`;
      stderr = stderr.trim() ? `${stderr.trimEnd()}\n${note}` : note;
    }
    return { code, stdout: out.text(), stderr };
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw e;
  }
}

export async function runToolStreamOrThrow(options: ToolStreamOptions, failureKind: "startup" | "finished" = "finished"): Promise<string> {
  const result = await runToolStream(options);
  if (result.code !== 0) {
    throw new StageError(
      clip(result.stderr.trim() || result.stdout.trim() || `${options.tool} exited with code ${result.code}`),
      failureKind,
      result.code,
      options.tool,
    );
  }
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

/** Parse `KEY=VALUE` lines (sz-workspace ensure, sz-replay init). */
export function parseAssignments(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
}

export interface WorkspaceEnsure {
  mode: "standard" | "replay";
  workspace: string;
  branch?: string;
}

export function parseWorkspaceEnsure(stdout: string): WorkspaceEnsure {
  const values = parseAssignments(stdout);
  const workspace = values.WORKSPACE;
  if (!workspace) {
    throw new StageError(
      `sz-workspace ensure printed no WORKSPACE line:\n${clip(stdout)}`,
      "finished",
      1,
      "sz-workspace",
    );
  }
  const mode = values.MODE === "replay" ? "replay" : "standard";
  return { mode, workspace, branch: values.BRANCH || undefined };
}

export interface ReplayInit {
  replayDir: string;
  szDevDir: string;
  baselineCommit: string;
  fixCommit: string;
  copied?: string;
}

export function parseReplayInit(stdout: string): ReplayInit {
  const values = parseAssignments(stdout);
  const missing = ["REPLAY_DIR", "SZ_DEV_DIR", "BASELINE_COMMIT", "FIX_COMMIT"].filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new StageError(
      `sz-replay init printed no ${missing.join(", ")} line:\n${clip(stdout)}`,
      "finished",
      1,
      "sz-replay",
    );
  }
  return {
    replayDir: values.REPLAY_DIR,
    szDevDir: values.SZ_DEV_DIR,
    baselineCommit: values.BASELINE_COMMIT,
    fixCommit: values.FIX_COMMIT,
    copied: values.COPIED,
  };
}

/** Parse the `key: value` lines of progress.md (or `sz-progress show` output). */
export function parseProgress(text: string): ProgressSnapshot {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z0-9]+): ?(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  const phaseRaw = values.phase ?? "0";
  const gates: Partial<Record<GateNumber, GateStatus>> = {};
  for (const n of [1, 2, 3, 4] as GateNumber[]) {
    const raw = values[`gate${n}`];
    gates[n] = raw === "passed" || raw === "rejected" ? raw : "pending";
  }
  return {
    phase: phaseRaw === "aborted" ? "aborted" : Number(phaseRaw) || 0,
    rounds: Number(values.rounds ?? "0") || 0,
    mode: values.mode === "orchestrated" ? "orchestrated" : "file",
    track: values.track === "manual" ? "manual" : "auto",
    slice: values.slice && values.slice !== "-" ? values.slice : undefined,
    base: values.base && values.base !== "-" ? values.base : undefined,
    gates,
    awaiting: values.awaiting && values.awaiting !== "-" ? values.awaiting : null,
    notes: (text.split(/\r?\n/).filter((line) => /^- /.test(line)) ?? []).map((line) => line.slice(2)),
  };
}

export interface ProgressSnapshot {
  phase: number | "aborted";
  rounds: number;
  mode: "file" | "orchestrated";
  track: "auto" | "manual";
  slice?: string;
  /**
   * The `base:` meta line — in replay mode this is the current replay
   * baseline. The agent re-anchors it as part of the sanctioned mid-Phase-1
   * replay switch (workflows/replay-mode.md "The switch"), and the
   * orchestrator adopts the run's baseline from it when the tree's HEAD
   * legitimately moved (see adoptReplayRebaseline in orchestrator.ts).
   */
  base?: string;
  gates: Partial<Record<GateNumber, GateStatus>>;
  awaiting: string | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Module pack capability table (references/<module>/README.md)
// ---------------------------------------------------------------------------

export const PACK_CAPABILITIES = [
  "check",
  "repro",
  "routing",
  "accept",
  "build",
  "deliverables",
  "review-checklist",
] as const;

export type PackCapability = (typeof PACK_CAPABILITIES)[number];

export interface PackCapabilities {
  module: string;
  /** capability -> file(s) from the README table; missing row = manual track. */
  files: Partial<Record<PackCapability, string>>;
  /** True when every row resolves to a real file (AI-executable accept). */
  autoTrack: boolean;
}

/**
 * Parse the capability table from a pack README: markdown table rows of
 * the shape `| check | Phase 2 | tools/cql_lint.py |`. Any row whose
 * File(s) cell says "manual track" (or is empty/missing) degrades that
 * capability to manual track — never a pipeline failure.
 */
export function parseCapabilityTable(readmeText: string, module: string): PackCapabilities {
  const files: Partial<Record<PackCapability, string>> = {};
  for (const line of readmeText.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const name = cells[1]?.toLowerCase();
    if (!name || !PACK_CAPABILITIES.includes(name as PackCapability)) continue;
    if (cells[2]?.startsWith(":")) continue; // header separator row
    const target = cells[3] ?? "";
    if (!target || /manual track/i.test(target)) continue;
    files[name as PackCapability] = target;
  }
  const complete = PACK_CAPABILITIES.every((capability) => Boolean(files[capability]));
  return { module, files, autoTrack: complete && Boolean(files.accept) };
}

// ---------------------------------------------------------------------------
// High-level operations used by the orchestrator
// ---------------------------------------------------------------------------

export interface SzdevContext {
  skillDir: string;
  id: string;
  /** sz-dev workspace checkout (the .sz-dev state root's parent). */
  workspace: string;
  /** Replay mode: point SZ_DEV_DIR into the replay tree. */
  szDevDir?: string;
}

function progressEnv(ctx: SzdevContext): Record<string, string> {
  return ctx.szDevDir ? { SZ_DEV_DIR: ctx.szDevDir } : {};
}

export async function progressInit(ctx: SzdevContext): Promise<void> {
  await runToolOrThrow({ skillDir: ctx.skillDir, tool: "sz-progress", args: ["init", ctx.id], cwd: ctx.workspace, env: progressEnv(ctx) });
}

export async function progressShow(ctx: SzdevContext): Promise<ProgressSnapshot> {
  const stdout = await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-progress",
    args: ["show", ctx.id],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
  return parseProgress(stdout);
}

export async function progressSetPhase(ctx: SzdevContext, phase: number | "aborted"): Promise<void> {
  await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-progress",
    args: ["set", ctx.id, "phase", String(phase)],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

export async function progressSetGate(ctx: SzdevContext, gate: GateNumber, state: GateStatus): Promise<void> {
  await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-progress",
    args: ["set", ctx.id, "gate", String(gate), state],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

/**
 * Non-throwing variant of progressSetGate for the viewer: the approve
 * response is already sent, and the progress write must not fail the
 * request. The spawn is async (no event-loop block); a failure is a no-op
 * (the sz-progress state is re-read on the next pipeline start).
 */
export async function progressSetGateAsync(ctx: SzdevContext, gate: GateNumber, state: GateStatus): Promise<void> {
  await runToolStream({
    skillDir: ctx.skillDir,
    tool: "sz-progress",
    args: ["set", ctx.id, "gate", String(gate), state],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

export async function progressAwaiting(ctx: SzdevContext, escalation: string | "clear"): Promise<void> {
  await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-progress",
    args: ["awaiting", ctx.id, escalation],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

export async function progressNote(ctx: SzdevContext, text: string): Promise<void> {
  await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-progress",
    args: ["note", ctx.id, text],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

/**
 * Re-anchor the replay baseline meta line. Part of the sanctioned replay
 * switch (workflows/replay-mode.md "The switch"); the orchestrator also uses
 * it to self-heal the anchor after it adopts a re-baselined tree, so
 * sz-verify-tree and every later session agree with the tree's real HEAD.
 */
export async function progressSetBase(ctx: SzdevContext, base: string): Promise<void> {
  await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-progress",
    args: ["set", ctx.id, "meta", "base", base],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

export interface WorkspaceEnsureOptions {
  skillDir: string;
  id: string;
  /** Run against this checkout instead of resolving a new workspace. */
  inPlace?: string;
  workspaceRoot?: string;
  /** Receives each line of `sz-workspace ensure` output as it streams. */
  onLog?: (line: string) => void;
}

/**
 * `sz-workspace ensure` performs a one-time full clone of the ccsrc history
 * (the shared local master mirror) on a first-time SZ. Over a slow or
 * networked checkout that can take many minutes — far longer than the
 * default 120s `spawnSync` timeout — so give it a generous ceiling instead
 * of killing the clone and surfacing a misleading `ETIMEDOUT`.
 */
export const WORKSPACE_ENSURE_TIMEOUT_MS = 30 * 60 * 1000;

export async function workspaceEnsure(options: WorkspaceEnsureOptions): Promise<WorkspaceEnsure> {
  const args = ["ensure", options.id];
  if (options.inPlace) args.push("--inplace");
  const env: Record<string, string> = {};
  if (options.workspaceRoot) env.SZ_WORKSPACE_ROOT = options.workspaceRoot;
  const stdout = await runToolStreamOrThrow(
    {
      skillDir: options.skillDir,
      tool: "sz-workspace",
      args,
      cwd: options.inPlace ?? options.workspaceRoot,
      env,
      timeoutMs: WORKSPACE_ENSURE_TIMEOUT_MS,
      onLine: options.onLog,
    },
    "startup",
  );
  return parseWorkspaceEnsure(stdout);
}

/**
 * In-place replay trees are checked out at the pre-fix baseline, which
 * predates `skills/`. `sz-replay init` copies the current pack only when
 * `SZ_REPLAY_HARNESS_SRC` names a checkout that has it (replay-mode.md).
 * The launching repo is that checkout. An operator-set value is left
 * alone, and a repo without the skill file is left unset so init can
 * fall back to its own registry scan.
 */
export function replayHarnessEnv(repo: string): Record<string, string> | undefined {
  if (process.env.SZ_REPLAY_HARNESS_SRC) return undefined;
  if (!fs.existsSync(path.join(repo, "skills", "sz-dev", "SKILL.md"))) return undefined;
  return { SZ_REPLAY_HARNESS_SRC: repo };
}

export async function replayInit(options: { skillDir: string; id: string; fixCommit: string; repo: string }): Promise<ReplayInit> {
  const stdout = await runToolOrThrow({
    skillDir: options.skillDir,
    tool: "sz-replay",
    args: ["init", options.id, options.fixCommit],
    cwd: options.repo,
    env: replayHarnessEnv(options.repo),
  });
  return parseReplayInit(stdout);
}

export async function replayDiff(ctx: SzdevContext, nameOnly: boolean): Promise<string> {
  const args = ["diff", ctx.id];
  if (nameOnly) args.push("--names");
  return await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-replay",
    args,
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

export async function replayVerify(ctx: SzdevContext): Promise<string> {
  return await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-replay",
    args: ["verify", ctx.id],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

export async function replayAudit(ctx: SzdevContext, forbid: string[]): Promise<string> {
  const args = ["audit", ctx.id];
  for (const token of forbid) args.push("--forbid", token);
  return await runToolOrThrow({
    skillDir: ctx.skillDir,
    tool: "sz-replay",
    args,
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
}

export async function replayPackage(ctx: SzdevContext, paths: string[]): Promise<string> {
  const result = await runTool({
    skillDir: ctx.skillDir,
    tool: "sz-replay",
    args: ["package", ctx.id, ...paths],
    cwd: ctx.workspace,
    env: progressEnv(ctx),
  });
  if (result.code !== 0) {
    throw new StageError(
      clip(result.stderr.trim() || result.stdout.trim() || `sz-replay package exited with code ${result.code}`),
      "finished",
      result.code,
      "sz-replay",
    );
  }
  // `package: <path>` is emitted via the tool's log() (stderr), followed
  // by the archive listing on stdout.
  const match = /package: (\S+)/.exec(`${result.stderr}\n${result.stdout}`);
  if (!match?.[1]) {
    throw new StageError(`sz-replay package printed no package path:\n${clip(result.stdout)}`, "finished", 1, "sz-replay");
  }
  return match[1];
}

/**
 * Trees whose commits legitimately mention SZ ids without carrying the
 * SZ's product fix — harness/doc commits from previous replay sessions.
 */
const HARNESS_PATH_PREFIXES = ["ai-flow/", "skills/"];

/**
 * Locate the SZ's landed fix commit — the replay anchor whose parent is
 * the pre-fix baseline. A message mention alone does not qualify: harness
 * commits reference SZ ids in their bodies ("updates from the SZ22052
 * replay sessions") and, being newer, shadow the real fix, anchoring the
 * baseline on a post-fix tree (the SZ22052 E5 blocker of 2026-10-06).
 * Rule (mirrors sz-workspace ensure's anchor rule): among commits whose
 * SUBJECT mentions SZ<id> (check-in convention), oldest first, take the
 * first that touches at least one file outside the harness trees — the
 * first landing of the SZ's change. Null means no commit qualifies; the
 * orchestrator fails the workspace stage on that signal.
 */
export function findFixCommit(worktree: string, id: string): string | null {
  const digits = id.replace(/^SZ/i, "");
  const subjectRe = new RegExp(`SZ${digits}([^0-9]|$)`);
  // ONE spawn: --name-only attaches each commit's file list directly under
  // its %H%x00%s line, so the old implementation's N+1 `git show`
  // round-trips (one per grep match — O(n) process spawns) collapse into a
  // single `git log`. Parsing is line-based and tolerant of the separator
  // blank lines between commit blocks:
  //   <hash>\0<subject>
  //   <file1>
  //   <file2>
  //   (blank)
  //   <hash>\0<subject>
  const result = spawnSync(
    "git",
    [
      "-C",
      worktree,
      "log",
      "--all",
      "--reverse",
      "--extended-regexp",
      `--grep=SZ${digits}([^0-9]|$)`,
      "--name-only",
      "--pretty=format:%H%x00%s",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) return null;
  let current: { hash: string; subject: string; files: string[] } | null = null;
  const evaluate = (commit: { hash: string; subject: string; files: string[] }): string | null => {
    if (!subjectRe.test(commit.subject)) return null;
    const touchesContent = commit.files.some((p) => p.trim() && !HARNESS_PATH_PREFIXES.some((prefix) => p.startsWith(prefix)));
    return touchesContent ? commit.hash : null;
  };
  for (const line of (result.stdout ?? "").split("\n")) {
    const nul = line.indexOf("\0");
    if (nul >= 0) {
      if (current) {
        const hit = evaluate(current);
        if (hit) return hit;
      }
      current = { hash: line.slice(0, nul), subject: line.slice(nul + 1), files: [] };
      continue;
    }
    if (current && line.trim()) current.files.push(line.trim());
  }
  if (current) {
    const hit = evaluate(current);
    if (hit) return hit;
  }
  return null;
}

/**
 * The inverse of findFixCommit for an already-known baseline: find the fix
 * commit that sits DIRECTLY on top of `parent` (a child that matches the SZ's
 * check-in convention and touches product content). Used when a replay run
 * legitimately re-anchored its baseline mid-Phase-1 (the sanctioned switch in
 * workflows/replay-mode.md) and the orchestrator needs to re-derive the
 * matching fix commit for the registry anchor. Reading a candidate's subject
 * and file list is allowed (status signals); this never reads the fix's diff.
 */
export function findFixChild(worktree: string, id: string, parent: string): string | null {
  const digits = id.replace(/^SZ/i, "");
  const subjectRe = new RegExp(`SZ${digits}([^0-9]|$)`);
  // maxBuffer: real ccsrc clones put `rev-list --all --children` output well
  // past spawnSync's 1MB default (ENOBUFS would read as "no fix found").
  const children = spawnSync("git", ["-C", worktree, "rev-list", "--all", "--children"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (children.error || children.status !== 0) return null;
  const candidates: string[] = [];
  for (const line of children.stdout?.split(/\r?\n/) ?? []) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === parent && parts.length > 1) candidates.push(...parts.slice(1));
  }
  for (const child of candidates) {
    const subject = spawnSync("git", ["-C", worktree, "log", "-1", "--pretty=%s", child], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!subjectRe.test(subject.stdout?.trim() ?? "")) continue;
    const names = spawnSync("git", ["-C", worktree, "show", "--name-only", "--pretty=format:", child], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const touchesContent = (names.stdout ?? "")
      .split(/\r?\n/)
      .map((p) => p.trim())
      .some((p) => p !== "" && !HARNESS_PATH_PREFIXES.some((prefix) => p.startsWith(prefix)));
    if (touchesContent) return child;
  }
  return null;
}

/** `.sz-dev/SZxxxx` state directory for the run. */
export function stateDir(ctx: SzdevContext): string {
  return path.join(ctx.szDevDir ?? path.join(ctx.workspace, ".sz-dev"), `SZ${ctx.id.replace(/^SZ/i, "")}`);
}

export function stateFile(ctx: SzdevContext, ...parts: string[]): string {
  return path.join(stateDir(ctx), ...parts);
}

export function requireArtifacts(ctx: SzdevContext, files: string[], command: string): void {
  const missing = files.filter((file) => !fs.existsSync(stateFile(ctx, file)) || fs.statSync(stateFile(ctx, file)).size === 0);
  if (missing.length > 0) {
    throw new StageError(`Missing sz-dev gate evidence: ${missing.join(", ")}`, "finished", 1, command);
  }
}

/** One entry in the replay registry (`~/.sz-dev-workspaces/replay-SZxxxx.meta`). */
export interface ReplayMeta {
  fix?: string;
  baseline?: string;
  repo?: string;
  root?: string;
}

/**
 * Read the replay registry anchor (`replay-SZxxxx.meta`) — the fix commit and
 * baseline that sz-replay init recorded for this SZ. The registry is the
 * tool-side anchor: sz-replay diff/verify/package all diff against its
 * `baseline=`, so it must stay consistent with the run's baseline (the
 * orchestrator rewrites it when it adopts a re-anchored baseline).
 * Null when no entry exists (e.g. ensure ran but init has not).
 */
export function readReplayMeta(ctx: SzdevContext): ReplayMeta | null {
  const digits = ctx.id.replace(/^SZ/i, "");
  const file = path.join(registryDir(), `replay-SZ${digits}.meta`);
  if (!fs.existsSync(file)) return null;
  const meta: ReplayMeta = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^(fix|baseline|repo|root)=(.*)$/.exec(line.trim());
    if (match) meta[match[1] as keyof ReplayMeta] = match[2].trim();
  }
  return meta.fix || meta.baseline ? meta : null;
}

/**
 * Update `fix=` / `baseline=` in the replay registry in place, preserving the
 * other lines (repo=/root= are tool-managed). Written by the orchestrator
 * after it adopts a sanctioned replay re-baseline so the tool-side anchor and
 * the run's state.json agree; sz-replay's own init remains the primary writer.
 */
export function writeReplayMeta(ctx: SzdevContext, meta: { fix?: string; baseline?: string }): void {
  const digits = ctx.id.replace(/^SZ/i, "");
  const dir = registryDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `replay-SZ${digits}.meta`);
  const lines = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "")
    : [];
  const upsert = (key: "fix" | "baseline", value: string) => {
    const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  };
  if (meta.baseline) upsert("baseline", meta.baseline);
  if (meta.fix) upsert("fix", meta.fix);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${lines.join("\n")}\n`, "utf8");
  fs.renameSync(tmp, file);
}
