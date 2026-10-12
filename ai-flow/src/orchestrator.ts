import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { findPreset } from "./agents.js";
import { mcpDescriptors } from "./mcp.js";
import { clip, redact } from "./redact.js";
import { getAdapter, type ModuleAdapter } from "./adapters/index.js";
import { loadConfig } from "./config.js";
import { StageError, isStageError } from "./errors.js";
import { acquireRunLock } from "./lock.js";
import { stopAgent } from "./stop.js";
import { git, isGeneratedReport, listChanges, patchText, filterPatchToProductSurface, runPaths, writePatch } from "./git.js";
import { installRefTransactionLock, removeRefTransactionLock } from "./gitLock.js";
import { createTarPackage as createTarDefault, changedPathsStandard } from "./package.js";
import { parseCheckResult } from "./testStage.js";
import {
  findFixChild,
  findFixCommit as findFixCommitDefault,
  progressAwaiting,
  progressInit,
  progressNote,
  progressSetBase,
  progressSetGate,
  progressSetPhase,
  progressShow,
  readReplayMeta,
  replayAudit,
  replayDiff,
  replayInit as replayInitDefault,
  replayPackage,
  replayVerify,
  requireArtifacts,
  stateFile,
  writeReplayMeta,
  workspaceEnsure as workspaceEnsureDefault,
  type ProgressSnapshot,
  type ReplayInit,
  type ReplayMeta,
  type SzdevContext,
  type WorkspaceEnsure,
} from "./szdev.js";
import { phase1Prompt, phase2Prompt, phase3Prompt, phase4Prompt, skillDirFor, withReviewFeedback } from "./prompts.js";
import { runAgent as runAgentDefault, type AgentRequest, type AgentResult } from "./runner.js";
import { beginStage, ConcurrentStateError, createState, finishStage, formatStageLine, readStateOrNull, skipRest, statePath, writeState } from "./store.js";
import { REWORK_STAGES, STAGES, type AiFlowConfig, type GateNumber, type RunState, type StageName } from "./types.js";

export type Log = (line: string) => void;

/**
 * The sz-dev control plane as consumed by the pipeline. The default
 * implementation shells out to skills/sz-dev/tools; tests inject fakes.
 */
/**
 * All tool-backed ops are async: the sz-progress / sz-replay spawns no
 * longer block the event loop (the viewer used to share the loop with the
 * sync variants, and a slow tool froze every in-flight request).
 * findFixCommit stays sync — it is a local `git log` query, not a tool spawn.
 */
export interface SzdevOps {
  workspaceEnsure(options: { skillDir: string; id: string; workspaceRoot?: string; onLog?: (line: string) => void }): Promise<WorkspaceEnsure>;
  findFixCommit(worktree: string, id: string): string | null;
  replayInit(options: { skillDir: string; id: string; fixCommit: string; repo: string }): Promise<ReplayInit>;
  progressInit(ctx: SzdevContext): Promise<void>;
  progressShow(ctx: SzdevContext): Promise<ProgressSnapshot>;
  progressSetPhase(ctx: SzdevContext, phase: number | "aborted"): Promise<void>;
  progressSetGate(ctx: SzdevContext, gate: GateNumber, state: "pending" | "passed" | "rejected"): Promise<void>;
  /** Re-anchor the replay baseline meta line (`sz-progress set <SZ> meta base <sha>`). */
  progressSetBase(ctx: SzdevContext, base: string): Promise<void>;
  progressAwaiting(ctx: SzdevContext, escalation: string | "clear"): Promise<void>;
  progressNote(ctx: SzdevContext, text: string): Promise<void>;
  replayVerify(ctx: SzdevContext): Promise<string>;
  replayAudit(ctx: SzdevContext): Promise<string>;
  replayDiff(ctx: SzdevContext): Promise<string>;
  replayDiffNames(ctx: SzdevContext): Promise<string[]>;
  replayPackage(ctx: SzdevContext, paths: string[]): Promise<string>;
  /** Read the replay registry anchor (`replay-SZxxxx.meta`); null when absent. */
  replayMeta(ctx: SzdevContext): ReplayMeta | null;
  /** Rewrite fix=/baseline= in the replay registry, preserving the other lines. */
  replaySetMeta(ctx: SzdevContext, meta: { fix?: string; baseline?: string }): Promise<void>;
}

const defaultSzdev: SzdevOps = {
  workspaceEnsure: workspaceEnsureDefault,
  findFixCommit: findFixCommitDefault,
  replayInit: replayInitDefault,
  progressInit,
  progressShow,
  progressSetPhase,
  progressSetGate,
  progressSetBase,
  progressAwaiting,
  progressNote,
  replayVerify,
  replayAudit: (ctx) => replayAudit(ctx, []),
  replayDiff: (ctx) => replayDiff(ctx, false),
  replayDiffNames: async (ctx) => (await replayDiff(ctx, true)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  replayPackage,
  replayMeta: (ctx) => readReplayMeta(ctx),
  replaySetMeta: async (ctx, meta) => writeReplayMeta(ctx, meta),
};

export interface PipelineDeps {
  runAgent: (request: AgentRequest) => Promise<AgentResult>;
  szdev: SzdevOps;
  adapter: ModuleAdapter;
  createTarPackage: typeof createTarDefault;
}

const defaultDeps: PipelineDeps = {
  runAgent: runAgentDefault,
  szdev: defaultSzdev,
  adapter: getAdapter(undefined),
  createTarPackage: createTarDefault,
};

export function normalizeId(input: string): string {
  const match = /^(?:SZ)?(\d+)$/i.exec(input.trim());
  if (!match?.[1]) {
    throw new StageError("Ticket id must be SZ followed by digits, for example SZ34623.", "startup", null);
  }
  return `SZ${match[1]}`;
}

const DEFAULT_RUN_MAX_MINUTES = 720;

export async function runPipeline(options: {
  repoRoot: string;
  id: string;
  /** Agent model override ("provider/model"); persists for resume. */
  model?: string;
  /** Override a live, recognizable ai-flow pipeline lock for this ticket. */
  force?: boolean;
  log?: Log;
  deps?: Partial<PipelineDeps>;
  config?: AiFlowConfig;
}): Promise<{ state: RunState; exitCode: number }> {
  const log = options.log ?? ((line) => console.log(line));
  const deps = { ...defaultDeps, ...options.deps };
  const config = options.config ?? loadConfig(options.repoRoot);
  const configuredSkillDir = config.szdev?.skillDir ?? path.join("skills", "sz-dev");
  const skillDir = path.isAbsolute(configuredSkillDir) ? configuredSkillDir : path.join(options.repoRoot, configuredSkillDir);
  if (!fs.existsSync(path.join(skillDir, "tools"))) {
    throw new StageError(`sz-dev skill directory not found at ${skillDir} (set config.szdev.skillDir).`, "startup", null);
  }
  const { runDir } = runPaths(options.repoRoot, options.id);
  // One run per ticket at a time. The lock also reaps any orphan agent left by
  // a crashed previous run, so we never end up with two agents on one workspace.
  const lock = await acquireRunLock(runDir, { force: options.force });
  const disarmWatchdog = armRunWatchdog(runDir, config, log);
  let state: RunState;
  try {
    const priorFile = statePath(runDir);
    const priorRaw = fs.existsSync(priorFile) ? readStateOrNull(runDir) : null;
    if (fs.existsSync(priorFile) && priorRaw === null) {
      throw new StageError(
        `Run state file is corrupted: ${priorFile}. Run 'ai-flow reset ${options.id}' to start over.`,
        "startup",
        null,
        "state.json",
      );
    }
    const prior = priorRaw;
    let start: StageName = "workspace";
    const applyRunModel = (target: RunState): void => {
      if (options.model) target.model = options.model;
      else if (!target.model && config.model) target.model = config.model;
    };
    if (prior) {
      // A run record from an older pipeline version (old stage names, no
      // szdev mirror) cannot be resumed; treat it as stale and start over.
      const stale = !prior.szdev || !STAGES.includes(prior.stage);
      if (!stale) {
        if (prior.status === "approved") {
          throw new StageError(`Run already approved: ${runDir}`, "startup", null);
        }
        if (prior.status === "awaiting_review" && !prior.rework) {
          throw new StageError(`Run is waiting for review: ${runDir}`, "startup", null);
        }
        start = prior.rework && prior.status === "awaiting_review" ? prior.rework.stage : prior.stage;
        if (!STAGES.includes(start)) {
          throw new StageError(`Cannot resume from an unknown stage: ${start}`, "startup", null);
        }
        if (prior.rework && !(REWORK_STAGES as readonly string[]).includes(prior.rework.stage)) {
          throw new StageError(`Cannot rewind to that stage: ${prior.rework.stage}`, "startup", null);
        }
      } else {
        log(`${options.id}  stale run record from an older pipeline; starting fresh`);
      }
      state = stale ? createState(options.id, options.repoRoot, "") : prior;
      state.error = null;
      state.status = "running";
      delete state.awaiting;
      for (const name of STAGES.slice(STAGES.indexOf(start))) {
        state.stages[name] = { status: "pending" };
      }
      applyRunModel(state);
      writeState(runDir, state);
      log(`${state.id}  resuming from ${start}`);
    } else {
      state = createState(options.id, options.repoRoot, "");
      applyRunModel(state);
      writeState(runDir, state);
    }

    // Resume integrity: when we are not starting at the workspace stage, the
    // artifacts the prior (passed) stages produced must still be on disk. A
    // reset / delete / manual tampering could have removed them; verify the
    // baseline before launching a later stage that would otherwise fail deep
    // into the run with a confusing error.
    verifyResumeBaseline(state, runDir, start);

    const ctx = (): SzdevContext => ({
      skillDir,
      id: state.id,
      workspace: state.szdev.workspace,
      szDevDir: state.szdev.replayDir ? state.szdev.replayDir + "/.sz-dev" : undefined,
    });

    const syncMirror = async (): Promise<ProgressSnapshot> => {
      const snapshot = await deps.szdev.progressShow(ctx());
      state.szdev.phase = snapshot.phase === "aborted" ? undefined : snapshot.phase;
      state.szdev.rounds = snapshot.rounds;
      state.szdev.track = snapshot.track;
      state.szdev.gates = snapshot.gates;
      state.szdev.awaiting = snapshot.awaiting;
      state.szdev.escalationNotes = snapshot.notes.filter((note) => /escalation|E[2-7]/i.test(note)).slice(-5);
      return snapshot;
    };

    const pack = (): string => state.szdev.pack ?? config.szdev?.pack ?? deps.adapter.module;

    // Stages run inside their own try/catch so a stage failure marks the run
    // failed and returns an exit code. Validation failures above (corrupted /
    // approved / awaiting review) are NOT caught here — they propagate out so
    // they never mutate an existing run record.
    let awaiting = false;
    try {
      const startAt = STAGES.indexOf(start);
      if (startAt <= STAGES.indexOf("workspace")) await stageWorkspace(state, runDir, options.repoRoot, skillDir, config, deps, log);
      await syncMirror();
      const phases: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
      for (const phase of phases) {
        if (startAt > STAGES.indexOf(`phase${phase}` as StageName)) continue;
        const outcome = await stagePhase(state, runDir, options.repoRoot, skillDir, config, deps, log, phase, pack, syncMirror, ctx);
        if (outcome === "awaiting") {
          awaiting = true;
          break;
        }
      }
      if (!awaiting) {
        if (startAt <= STAGES.indexOf("review")) stageReview(state, runDir, log);
      }
    } catch (err) {
      // An external actor (the viewer's Stop, or a concurrent retry/rewind)
      // may win a state-write race against this pipeline. When the actor
      // stopped the run, their record is the truth: re-read the disk and
      // defer to it instead of overwriting the operator's stop with a
      // confusing stage failure ("agent exited 1" on a run the user stopped
      // intentionally). Only runs that are no longer "running" on disk are
      // deferred to — a failed/awaiting/approved record is an external
      // decision; a running record is not.
      if (err instanceof ConcurrentStateError) {
        const disk = readStateOrNull(runDir);
        if (disk && disk.status !== "running") {
          log(`${state.id}  ${state.stage}  stopped by an external actor; keeping their state instead of a stage failure`);
          return { state: disk, exitCode: 2 };
        }
      }
      const failure = isStageError(err) ? err : new StageError(err instanceof Error ? err.message : String(err), "finished", 1);
      const stage = state.stage;
      // Defense in depth: production StageErrors already arrive clipped and
      // redacted (runner, git, szdev all pass through clip), but anything
      // constructed elsewhere must not leak secrets into the run record.
      const errorText = redact(failure.message);
      finishStage(state, stage, "failed", {
        exitCode: failure.exitCode,
        command: failure.command,
        error: errorText,
      });
      state.status = "failed";
      state.error = errorText;
      skipRest(state, stage);
      try {
        writeState(runDir, state);
      } catch (writeErr) {
        // The same race surfacing at the failure write itself: the viewer
        // wrote between our last read and this write. Defer when the disk
        // record is no longer "running" (an external stop won); otherwise
        // the disk advanced for a reason we cannot explain — rethrow so the
        // operator sees a hard error instead of a silently diverged record.
        if (writeErr instanceof ConcurrentStateError) {
          const disk = readStateOrNull(runDir);
          if (disk && disk.status !== "running") {
            log(`${state.id}  ${state.stage}  stopped by an external actor; keeping their state instead of a stage failure`);
            return { state: disk, exitCode: 2 };
          }
        }
        throw writeErr;
      }
      log(formatStageLine(state.id, stage, "failed"));
      for (const name of STAGES) {
        if (state.stages[name].status === "skipped") log(formatStageLine(state.id, name, "skipped"));
      }
      return { state, exitCode: failure.kind === "startup" ? 1 : 2 };
    }
    return { state, exitCode: 0 };
  } finally {
    disarmWatchdog();
    lock.release();
  }
}

/**
 * Arm the global run watchdog: after `run.maxMinutes` (default 12h; 0
 * disables), stop the recorded agent so a hung agent cannot hold the run
 * lock forever and block every retry. Returns a disarm function (a no-op
 * when the watchdog is disabled). Exported so the arming/killing wiring is
 * testable without a real 12-hour wait.
 */
export function armRunWatchdog(runDir: string, config: AiFlowConfig, log: (line: string) => void): () => void {
  const maxMinutes = config.run?.maxMinutes ?? DEFAULT_RUN_MAX_MINUTES;
  if (!maxMinutes || maxMinutes <= 0) return () => undefined;
  const timer = setTimeout(() => {
    log(`watchdog  run exceeded ${maxMinutes} minutes; stopping the agent`);
    void stopAgent(runDir, config).catch(() => {
      // best-effort
    });
  }, maxMinutes * 60_000);
  return () => clearTimeout(timer);
}

/**
 * Guard a resuming run against a broken baseline. When we are not starting at
 * the workspace stage, the prior (passed) stages' artifacts must still be on
 * disk: the sz-dev workspace / replay tree must exist, and — for standard mode
 * runs resuming at or after phase 2 — the trusted reviewed-patch copy must still
 * be present (it lives in the run dir, not the agent's workspace, so a partial
 * reset or manual edit could have removed it).
 */
function verifyResumeBaseline(state: RunState, runDir: string, start: StageName): void {
  if (start === "workspace") return;
  const workspace = state.szdev?.workspace;
  if (!workspace || !fs.existsSync(workspace)) {
    throw new StageError(
      `Cannot resume ${state.id} from ${start}: the ${state.szdev?.mode ?? "sz-dev"} workspace is missing (${workspace ?? "unknown"}). ` +
        `Run 'ai-flow reset ${state.id}' to start over.`,
      "startup",
      null,
    );
  }
  // A resume at phase 3 or later needs the trusted gate-2 snapshot to exist
  // (phase 3/4 compare against it; a missing one means a half-done reset or
  // an old record, and later phases would pass with no drift backstop).
  // Resuming at phase 2 is different: phase 2 is the stage that WRITES
  // gate2-reviewed.patch, so a first-attempt phase-2 failure (no snapshot
  // yet) must stay retryable instead of demanding a full reset.
  const startsAtOrAfterPhase3 = STAGES.indexOf(start) > STAGES.indexOf("phase2");
  if (startsAtOrAfterPhase3 && state.szdev?.mode === "standard" && !fs.existsSync(path.join(runDir, "gate2-reviewed.patch"))) {
    throw new StageError(
      `Cannot resume ${state.id} from ${start}: the reviewed gate-2 patch is missing (run dir gate2-reviewed.patch). ` +
        `Run 'ai-flow reset ${state.id}' to start over.`,
      "startup",
      null,
    );
  }
}

/** True when the stage paused on an open escalation (E1-E7). */

/**
 * A line writer that fans each line out to the run's console log (prefixed
 * with the stage name) and appends it to logs/<stage>.log — so the same live
 * output is visible both on the terminal and in the viewer's log view. The
 * run-level `log` only ever sees complete lines (no partial or duplicated
 * progress), which keeps the orchestrator's summary lines readable.
 */
function makeStageWriter(runDir: string, stage: string, log: Log): (line: string) => void {
  const file = path.join(runDir, "logs", `${stage}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (line: string) => {
    if (line) log(`${stage}  ${line}`);
    // Redact secrets (cookies/tokens/keys) before they land in the persistent
    // stage log — the hard rule "do not put cookies in logs" applies to the
    // on-disk file, not just the viewer's already-redacted served responses.
    // The live console stream above stays unredacted for readability; only the
    // durable record is sanitized.
    fs.appendFileSync(file, redact(line.endsWith("\n") ? line : `${line}\n`));
  };
}

async function stageWorkspace(
  state: RunState,
  runDir: string,
  repoRoot: string,
  skillDir: string,
  config: AiFlowConfig,
  deps: PipelineDeps,
  log: Log,
): Promise<void> {
  beginStage(state, "workspace");
  writeState(runDir, state);
  log(formatStageLine(state.id, "workspace", "running"));
  const writer = makeStageWriter(runDir, "workspace", log);

  log(`workspace  ensuring sz-dev workspace (sz-workspace ensure)`);
  const ensured = await deps.szdev.workspaceEnsure({
    skillDir,
    id: state.id,
    workspaceRoot: config.szdev?.workspaceRoot,
    onLog: (line) => writer(line),
  });
  if (ensured.mode === "replay") {
    log(`workspace  replay mode: looking for the fix commit in git history`);
    const fixCommit = deps.szdev.findFixCommit(repoRoot, state.id);
    if (!fixCommit) {
      throw new StageError(
        `sz-workspace reported replay mode for ${state.id} but no fix commit was found in git history (a fix commit must mention ${state.id} in its subject and touch at least one file outside ai-flow/ and skills/).`,
        "finished",
        1,
        "sz-workspace",
      );
    }
    log(`workspace  fix commit ${fixCommit}`);
    const replay = await deps.szdev.replayInit({ skillDir, id: state.id, fixCommit, repo: repoRoot });
    state.szdev = {
      mode: "replay",
      workspace: replay.replayDir,
      replayDir: replay.replayDir,
      baselineCommit: replay.baselineCommit,
      fixCommit: replay.fixCommit,
      gates: {},
    };
    state.worktree = replay.replayDir;
    state.baseCommit = replay.baselineCommit;
    let replayBaseline = replay.baselineCommit;
    // Replay runs MUST start from a clean, detached checkout of the pre-fix
    // baseline (the "clean baseline project"): leftover tracked changes from a
    // crashed prior run would fake every red/green verdict, and a wrong anchor
    // would put the fix itself in the tree (the SZ34445 incident).
    await restoreTrackedLeftovers(replay.replayDir, log);
    // Anchor cross-check: the tool-side anchor (sz-workspace ensure's own
    // rule / sz-replay init's registry reuse) can disagree with ai-flow's own
    // detection — e.g. a registry entry anchored on a harness commit that
    // merely mentions the SZ in its body. Re-anchor through the tool itself
    // (sz-replay init re-checkouts and re-injects the harness); on any failure
    // keep the tool anchor and let Phase 1's replay switch recover.
    if (replay.fixCommit !== fixCommit) {
      const probe = git(replay.replayDir, ["rev-parse", "--verify", "--quiet", `${fixCommit}^{commit}`]);
      if (probe.code === 0) {
        log(`workspace  replay anchor mismatch: tool anchored on ${replay.fixCommit} (baseline ${replay.baselineCommit}); ai-flow detected ${fixCommit} — re-running sz-replay init to re-anchor`);
        try {
          const reanchored = await deps.szdev.replayInit({ skillDir, id: state.id, fixCommit, repo: repoRoot });
          replayBaseline = reanchored.baselineCommit;
          state.szdev.baselineCommit = reanchored.baselineCommit;
          state.szdev.fixCommit = reanchored.fixCommit;
          state.baseCommit = reanchored.baselineCommit;
        } catch (err) {
          log(`warn  replay re-anchoring failed (${err instanceof Error ? err.message : String(err)}); keeping the tool anchor ${replay.fixCommit} — Phase 1 may re-baseline through the replay switch`);
        }
      } else {
        log(`warn  ai-flow detected fix commit ${fixCommit} but the replay tree does not carry it; keeping the tool anchor ${replay.fixCommit} — Phase 1 may re-baseline through the replay switch`);
      }
    }
    await verifyCleanReplayBaseline(replay.replayDir, replayBaseline, log);
  } else {
    log(`workspace  standard mode: sz-dev workspace at ${ensured.workspace}`);
    state.szdev = { mode: "standard", workspace: ensured.workspace, gates: {} };
    state.worktree = ensured.workspace;
    state.baseCommit = headCommit(ensured.workspace);
    await deps.szdev.progressInit({ skillDir, id: state.id, workspace: ensured.workspace });
  }
  if (state.szdev.mode === "replay") {
    // sz-replay init seeds the state tree; init is idempotent either way.
    await deps.szdev.progressInit({ skillDir, id: state.id, workspace: state.szdev.workspace, szDevDir: path.join(state.szdev.replayDir ?? "", ".sz-dev") });
  }
  // The ticket is fetched by the agent in phase 1 through its configured
  // softzilla MCP and cached into the state dir there; the orchestrator
  // no longer runs a separate MCP client. The phase-1 evidence check
  // (requireArtifacts) enforces that the cache exists before gate 1.
  finishStage(state, "workspace", "passed", { exitCode: 0, command: "sz-workspace ensure" });
  writeState(runDir, state);
  log(formatStageLine(state.id, "workspace", `passed (${state.szdev.mode})`));
  log(`workspace  ${state.szdev.workspace}`);
}

type PhaseOutcome = "done" | "awaiting";

async function stagePhase(
  state: RunState,
  runDir: string,
  repoRoot: string,
  skillDir: string,
  config: AiFlowConfig,
  deps: PipelineDeps,
  log: Log,
  phase: 1 | 2 | 3 | 4,
  pack: () => string,
  syncMirror: () => Promise<ProgressSnapshot>,
  ctx: () => SzdevContext,
): Promise<PhaseOutcome> {
  const stage = `phase${phase}` as StageName;
  beginStage(state, stage);
  writeState(runDir, state);
  log(formatStageLine(state.id, stage, "running"));
  const context = ctx();
  const mirror = await syncMirror();
  if (mirror.awaiting) {
    // A rework answer arrived from the human; reopen the phase.
    await deps.szdev.progressAwaiting(context, "clear");
  }
  const current = mirror.phase === "aborted" ? 0 : mirror.phase;
  if (current !== phase) await deps.szdev.progressSetPhase(context, phase);

  // Fingerprint the agent's MCP config files at the start of this run. The
  // agent must never extend its own tool surface; assertNoAgentOverreach
  // re-checks the fingerprints after every phase. Recomputed on every process
  // invocation (i.e. also on resume) rather than carried over from a previous
  // run's state.json: that is what lets an operator legitimately edit the MCP
  // config via Manage MCP between runs without the next Retry tripping the
  // guard — the guard is meant to catch the agent editing its own config
  // mid-run, not an operator action between runs.
  state.mcpHashes = Object.fromEntries(agentMcpFiles(config, repoRoot).map((file) => [file, fileFingerprint(file)]));

  // Standard mode: snapshot the reviewed change surface before phase 3 runs,
  // so code introduced during testing fails the phase (assertPhase3Scope).
  // Replay mode gets the same guarantee from sz-replay verify at phase 4.
  const packName = pack();
  const phaseAdapter = packName === deps.adapter.module ? deps.adapter : getAdapter(packName);
  const phase3Before =
    phase === 3 && state.szdev.mode === "standard" && state.baseCommit
      ? phaseAdapter.phase2Snapshot(context.workspace, state.baseCommit)
      : null;

  const requirement = stateFile(context, "phase1-requirement.md");
  const agentSkillDir = skillDirFor(context.workspace, skillDir);
  const prompt =
    phase === 1
      ? phase1Prompt({
          skillDir: agentSkillDir,
          ticketPath: stateFile(context, "attachment", "ticket-body.md"),
          workspace: context.workspace,
          mode: state.szdev.mode,
          id: state.id,
          fixCommit: state.szdev.fixCommit,
          baselineCommit: state.szdev.baselineCommit,
        })
      : phase === 2
        ? phase2Prompt({ skillDir: agentSkillDir, workspace: context.workspace, pack: pack(), mode: state.szdev.mode, requirementPath: requirement })
        : phase === 3
          ? phase3Prompt({
              skillDir: agentSkillDir,
              workspace: context.workspace,
              pack: pack(),
              testPlanPath: stateFile(context, "phase3-test-plan.md"),
              testReportPath: stateFile(context, "phase3-test-report.md"),
            })
          : phase4Prompt({ skillDir: agentSkillDir, workspace: context.workspace, pack: pack(), deliverablesDir: stateFile(context, "deliverables") });

  // Stop the agent from moving git HEAD at the source. The pipeline never moves
  // refs during a run (gate 4 only marks approved + builds a tarball), so the
  // only thing that can move HEAD is the agent — and the sz-dev hard rules
  // forbid it. We install a git reference-transaction hook that aborts every
  // ref update (commit/checkout/branch/reset/stash) for the agent's run, then
  // remove it. The after-the-fact overreach check stays as a backstop. The
  // hook — not an env flag — enforces this because the agent runner inherits
  // process.env (runner.ts), so a process.env bypass would be inherited and
  // defeated.
  //
  // REPLAY PHASE 1 EXCEPTION: the sanctioned replay switch (workflows/
  // replay-mode.md "The switch") MUST move HEAD — it re-baselines the tree
  // detached at the true pre-fix baseline (git checkout, via sz-replay init
  // or directly). A blanket ref lock would make the documented workflow
  // impossible (both the agent's checkout and sz-replay init's internal
  // checkout are ref transactions). During the switch window the end-of-phase
  // clean-baseline guard is the enforcement instead: it accepts exactly one
  // kind of HEAD move — detached + clean + the parent of the SZ's genuine fix
  // commit — and rejects everything else.
  const refLockNeeded = !(state.szdev.mode === "replay" && phase === 1);
  if (refLockNeeded) {
    const refLockInstalled = installRefTransactionLock(context.workspace);
    if (!refLockInstalled) {
      log(`warn  could not install the git ref lock; relying on the overreach check to catch HEAD movement`);
    }
  } else {
    log(`phase1  replay switch window: git ref lock not installed — the sanctioned re-baseline needs to move HEAD; the end-of-phase clean-baseline guard is the enforcement`);
  }
  let result: AgentResult;
  try {
    result = await runPrompt(state, runDir, context.workspace, stage, config, deps, withReviewFeedback(prompt, state.rework?.comment));
  } finally {
    removeRefTransactionLock(context.workspace);
  }
  delete state.rework;

  const snapshot = await syncMirror();
  if (snapshot.awaiting) {
    const code = snapshot.awaiting;
    finishStage(state, stage, "awaiting_review", { exitCode: result.exitCode, command: result.commandName });
    state.status = "awaiting_review";
    state.awaiting = { kind: code === "E1" ? "clarification" : "escalation", code };
    writeState(runDir, state);
    log(formatStageLine(state.id, stage, `awaiting ${code}`));
    return "awaiting";
  }

  await verifyPhaseEvidence(state, runDir, context, deps, skillDir, phase, pack(), log);

  // Phase 3 may only touch its test area: fail the phase when the reviewed
  // change surface moved. A phase-3 escalation resume re-snapshots on entry,
  // so drift that predates the resume is still caught at phase 4 (standard
  // mode) / by sz-replay verify (replay mode).
  if (phase3Before !== null) {
    phaseAdapter.assertPhase3Scope(phase3Before, phaseAdapter.phase2Snapshot(context.workspace, state.baseCommit));
  }

  // The agent must not have moved git HEAD (commit/checkout are forbidden by
  // the sz-dev hard rules) nor edited its own MCP config files. Replay mode
  // differs in one sanctioned way: Phase 1 may re-baseline the tree through
  // the replay switch, and the guard adopts (not fails) a valid re-baseline.
  if (state.szdev.mode === "replay") {
    await assertReplayNoOverreach(state, context, deps, phase, log);
  } else {
    assertNoAgentOverreach(state, context);
  }

  // Gates 1-3 pass automatically once the evidence exists; gate 4 is the
  // final human audit and is passed by the viewer's approve action.
  if (phase <= 3) await deps.szdev.progressSetGate(context, phase, "passed");
  await syncMirror();
  finishStage(state, stage, "passed", { exitCode: result.exitCode, command: result.commandName });
  writeState(runDir, state);
  log(formatStageLine(state.id, stage, "passed"));
  return "done";
}

async function verifyPhaseEvidence(
  state: RunState,
  runDir: string,
  context: SzdevContext,
  deps: PipelineDeps,
  skillDir: string,
  phase: 1 | 2 | 3 | 4,
  packName: string,
  log: Log,
): Promise<void> {
  // The adapter for THIS pack (not the default deps.adapter). Phase 2 scope
  // checks and phase 4 trust-snapshots must use the pack's own surface
  // exclusions — deps.adapter is only the default and is wrong once a second
  // module pack exists alongside cql.
  const phaseAdapter = packName === deps.adapter.module ? deps.adapter : getAdapter(packName);
  if (phase === 1) {
    log("phase1  verifying required artifacts (requirement, ticket cache)");
    requireArtifacts(
      context,
      ["phase1-requirement.md", "attachment/ticket-body.md", "attachment/ticket-comments.md"],
      "phase1",
    );
    const requirement = fs.readFileSync(stateFile(context, "phase1-requirement.md"), "utf8");
    const notes = (await deps.szdev.progressShow(context)).notes.join("\n");
    const packMatch =
      /module pack: *([a-z0-9-]+)/i.exec(notes) ??
      /module pack: *([a-z0-9-]+)/i.exec(requirement) ??
      /pack: *([a-z0-9-]+)/i.exec(requirement);
    if (packMatch?.[1]) state.szdev.pack = packMatch[1].toLowerCase();
    return;
  }
  if (phase === 2) {
    log("phase2  asserting the change scope stays within the module pack");
    const adapter = phaseAdapter;
    const changes = listChangesSafe(context.workspace, state.baseCommit);
    adapter.assertPhase2Scope(changes);
    log("phase2  running pack self-check (this may take a while)");
    const check = await adapter.check({
      worktree: context.workspace,
      changedFiles: changes.map((change) => change.path),
      logFile: path.join(runDir, "logs", "phase2-check.log"),
    });
    if (check.output.trim()) {
      log(`phase2  ${check.output.trim().split("\n").slice(0, 5).join("\nphase2  ")}`);
    }
    if (!check.passed) {
      throw new StageError(`Pack check failed after phase 2:\n${check.output}`, "finished", 1, `${adapter.module} check`);
    }
    log("phase2  self-check passed");
    const plan = firstMatching(stateFile(context), /^phase2-plan.*\.md$/);
    const gate2Patch = firstMatching(stateFile(context, "checkpoints"), new RegExp(`^SZ\\d+_gate2.*\\.patch$`));
    requireArtifacts(context, ["phase2-review.md", "phase4-handoff.md"], "phase2");
    if (!plan) throw new StageError("Missing sz-dev gate evidence: phase2-plan*.md", "finished", 1, "phase2");
    if (!gate2Patch) throw new StageError("Missing sz-dev gate evidence: checkpoints/SZxxxx_gate2.patch", "finished", 1, "phase2");
    // The reviewed gate-2 patch must describe exactly the reviewed tree.
    // Agents have left stale patches behind after a fix round, so the
    // orchestrator snapshots the reviewed state itself; any code change
    // made later (phase 3 fix loop) fails the phase-3 drift check or the
    // phase-4 byte-compare (standard) / sz-replay verify (replay), which
    // forces the rework path. Replay mode uses sz-replay diff so the patch
    // bytes match what verify compares against.
    const snapshotText = state.szdev.mode === "replay" ? await deps.szdev.replayDiff(context) : null;
    if (snapshotText !== null) {
      fs.mkdirSync(path.dirname(gate2Patch), { recursive: true });
      fs.writeFileSync(gate2Patch, snapshotText, "utf8");
    } else {
      // Agent-side gate-2 patch: the full tree diff, because it becomes the
      // deliverable CHANGES patch and must include test-area changes.
      writePatch(context.workspace, state.baseCommit, gate2Patch);
      // Trusted copy in the run dir — outside the agent's workspace, so a
      // later patch-file edit cannot defeat the phase-4 drift backstop.
      // Carries the adapter's reviewed surface (product code; the module
      // test area may evolve in phase 3 and is audited at gate 4).
      fs.writeFileSync(
        path.join(runDir, "gate2-reviewed.patch"),
        phaseAdapter.phase4Snapshot(context.workspace, state.baseCommit),
        "utf8",
      );
      // Mark the surface so the phase-4 compare can tell this product-surface
      // snapshot apart from a legacy FULL-tree patch written by an older
      // ai-flow version (whose runs must keep working after an upgrade).
      state.szdev.gate2Surface = "product";
    }
    return;
  }
  if (phase === 3) {
    log("phase3  verifying the test plan and report");
    requireArtifacts(context, ["phase3-test-plan.md", "phase3-test-report.md"], "phase3");
    const report = fs.readFileSync(stateFile(context, "phase3-test-report.md"), "utf8");
    const summary = parseCheckResult(null, report);
    state.test = { ...summary, skipped: summary.skipped };
    state.artifacts.testReport = "phase3-test-report.md";
    return;
  }
  // phase 4
  log("phase4  verifying deliverable documents");
  const deliverables = stateFile(context, "deliverables");
  const docs = fs.existsSync(deliverables) ? fs.readdirSync(deliverables).filter((name) => name.endsWith(".md")) : [];
  if (docs.length === 0) {
    throw new StageError("Missing sz-dev gate evidence: deliverables/*.md", "finished", 1, "phase4");
  }
  requireArtifacts(context, ["deliverables/CHANGES-SZ" + state.id.replace(/^SZ/i, "") + ".patch"], "phase4");
  // Standard-mode backstop: the final tree's reviewed surface (product code;
  // module test area excluded — it may legitimately evolve in phase 3 and is
  // audited at gate 4) must still match the reviewed gate-2 snapshot, even
  // when the drift happened before a phase-3 resume (whose before-snapshot
  // is already post-drift). Replay mode gets the byte-exact equivalent from
  // sz-replay verify inside packageDelivery.
  if (state.szdev.mode === "standard" && state.baseCommit) {
    const trusted = path.join(runDir, "gate2-reviewed.patch");
    if (fs.existsSync(trusted)) {
      const reviewed = fs.readFileSync(trusted, "utf8");
      const current = phaseAdapter.phase4Snapshot(context.workspace, state.baseCommit);
      let matches = current === reviewed;
      if (!matches && state.szdev.gate2Surface !== "product") {
        // Legacy gate2-reviewed.patch from an ai-flow version that snapshotted
        // the FULL tree. Narrow it to its product sections and compare again:
        // the module test area legitimately evolved during phase 3, so a
        // full-tree byte-compare would false-fail a run that outlived an
        // upgrade (the upgrade case documented in AGENTS.md).
        const legacyProduct = filterPatchToProductSurface(
          reviewed,
          (phaseAdapter.productSurfaceExclusions ?? []).map((exclusion) => exclusion.pathPrefix),
        );
        matches = current === legacyProduct;
      }
      if (!matches) {
        throw new StageError(
          "Product code changed after the gate-2 review (the final tree's reviewed surface no longer matches the gate-2 snapshot; module test-area changes are expected from phase 3 and audited at gate 4). Restore the reviewed code, or Reject back to phase2 to re-review deliberately.",
          "finished",
          1,
          "phase4",
        );
      }
    }
  }
  await packageDelivery(state, runDir, context, deps, skillDir, log);
}

async function packageDelivery(
  state: RunState,
  runDir: string,
  context: SzdevContext,
  deps: PipelineDeps,
  skillDir: string,
  log: Log,
): Promise<void> {
  let tarPath: string;
  let paths: string[];
  log("package  building the delivery archive");
  if (state.szdev.mode === "replay") {
    // changed-paths.txt is the authoritative change set, but agents
    // sometimes append generated reports; those are never part of the
    // delivery. The generated report files themselves must leave the
    // tree too, because sz-replay verify compares the tree's change
    // surface against the reviewed gate-2 patch. Archive them in the
    // run directory instead of deleting.
    log("package  archiving generated reports out of the replay tree");
    archiveGeneratedReports(state, runDir, context);
    sanitizeChangedPaths(context);
    log("package  verifying the replay tree against the reviewed gate-2 patch");
    await deps.szdev.replayVerify(context);
    paths = await deps.szdev.replayDiffNames(context);
    tarPath = await deps.szdev.replayPackage(context, paths);
  } else {
    paths = changedPathsStandard(context.workspace, state.baseCommit);
    const packed = deps.createTarPackage({ worktree: context.workspace, paths, id: state.id });
    tarPath = packed.tarPath;
    paths = packed.paths;
  }
  state.artifacts.package = tarPath;
  const changesPatch = stateFile(context, "deliverables", `CHANGES-${state.id}.patch`);
  if (fs.existsSync(changesPatch)) {
    fs.copyFileSync(changesPatch, path.join(runDir, "changes.patch"));
    state.artifacts.patch = "changes.patch";
  }
  log(`package  ${tarPath}`);
}

function archiveGeneratedReports(state: RunState, runDir: string, context: SzdevContext): void {
  const sources = ["test-reports", path.join("cql", "test", "test-reports")];
  const archiveRoot = path.join(runDir, "logs", "replay-test-reports");
  for (const source of sources) {
    const from = path.join(context.workspace, source);
    if (!fs.existsSync(from)) continue;
    const to = path.join(archiveRoot, source.replaceAll(path.sep, "-"));
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.renameSync(from, to);
    } catch (err) {
      // The workspace and the repo root (run dir) may sit on different
      // mounts: rename then fails with EXDEV and the archive degrades to
      // copy+remove instead of aborting the whole phase.
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
  }
}

function sanitizeChangedPaths(context: SzdevContext): void {
  const file = stateFile(context, "changed-paths.txt");
  if (!fs.existsSync(file)) return;
  const kept: string[] = [];
  let changed = false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isGeneratedReport(trimmed) || trimmed === ".sz-dev" || trimmed.startsWith(".sz-dev/") || trimmed === "skills" || trimmed.startsWith("skills/")) {
      changed = true;
      continue;
    }
    kept.push(trimmed);
  }
  if (changed) fs.writeFileSync(file, `${kept.join("\n")}\n`, "utf8");
}

function stageReview(state: RunState, runDir: string, log: Log): void {
  beginStage(state, "review");
  log(formatStageLine(state.id, "review", "running"));
  finishStage(state, "review", "awaiting_review", { exitCode: 0 });
  state.status = "awaiting_review";
  state.awaiting = { kind: "gate4" };
  state.error = null;
  delete state.rework;
  writeState(runDir, state);
  log(formatStageLine(state.id, "review", "awaiting_review (gate 4)"));
}

async function runPrompt(
  state: RunState,
  runDir: string,
  worktree: string,
  stage: StageName,
  config: AiFlowConfig,
  deps: PipelineDeps,
  prompt: string,
): Promise<AgentResult> {
  const promptFile = path.join(runDir, "prompts", `${stage}.md`);
  fs.mkdirSync(path.dirname(promptFile), { recursive: true });
  fs.writeFileSync(promptFile, prompt, "utf8");
  const preset = config.agent ? findPreset(config.agent) : undefined;
  return deps.runAgent({
    command: config.runner.command,
    cwd: worktree,
    promptFile,
    logFile: path.join(runDir, "logs", `${stage}.log`),
    // Records the live agent's pid so `ai-flow stop` can kill exactly this
    // process instead of pattern-matching other agents on the machine.
    pidFile: path.join(runDir, "agent.pid"),
    model: state.model,
    modelFlag: config.runner.modelFlag,
    agentId: config.agent,
    applyModel: preset ? preset.modelInCommand : true,
    versionCheck: config.runner.versionCheck,
  });
}

function headCommit(worktree: string): string {
  const result = git(worktree, ["rev-parse", "HEAD"]);
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new StageError(`Unable to read HEAD in ${worktree}`, "startup", result.code, "git");
  }
  return result.stdout.trim();
}

function listChangesSafe(worktree: string, base: string) {
  if (!base) return [];
  return listChanges(worktree, base);
}

function firstMatching(dir: string, pattern: RegExp): string | null {
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((name) => pattern.test(name));
  return hit ? path.join(dir, hit) : null;
}

/** Content fingerprint for the MCP overreach guard; "absent" marks a file that did not exist at run start. */
export function fileFingerprint(file: string): string {
  if (!fs.existsSync(file)) return "absent";
  try {
    return `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
  } catch {
    return "unreadable";
  }
}

/** The MCP config files the configured agent loads (empty when no agent preset is set). */
function agentMcpFiles(config: AiFlowConfig, repoRoot: string): string[] {
  const agentId = (config.agent ?? "").trim().toLowerCase();
  if (!agentId) return [];
  try {
    return mcpDescriptors(agentId, repoRoot).map((descriptor) => descriptor.path);
  } catch {
    return [];
  }
}

/**
 * The agent's MCP config files must still match their run-start fingerprints:
 * the agent must never extend its own tool surface. An operator who edited
 * the config through Manage MCP mid-run hits the same failure; the message
 * says so and points at Retry.
 */
export function assertMcpUnchanged(state: RunState): void {
  if (state.mcpHashes) {
    const changed = Object.entries(state.mcpHashes)
      .filter(([file, fingerprint]) => fileFingerprint(file) !== fingerprint)
      .map(([file]) => file);
    if (changed.length > 0) {
      throw new StageError(
        `Overreach: the agent's MCP config changed during this run: ${changed.join(", ")}. The agent must never edit its own tool surface. If you edited it through Manage MCP, Retry the failed stage; otherwise reset the run.`,
        "finished",
        1,
      );
    }
  }
}

/**
 * Overreach guards for the driven agent, run after every phase's evidence
 * passes (the prompt tells the agent these rules, but prompt compliance is
 * not verifiable — these are the mechanical signatures):
 *
 *  - HEAD must not have moved (standard: baseCommit, replay: baselineCommit).
 *    The agent is forbidden to `git commit` or `git checkout`; a moved HEAD
 *    is the mechanical signature of either (or of a workspace that was
 *    disturbed externally). Replay mode is the one sanctioned exception —
 *    see assertReplayNoOverreach.
 *  - The agent's MCP config files must still match their run-start
 *    fingerprints.
 */
export function assertNoAgentOverreach(state: RunState, context: SzdevContext): void {
  const expectedHead = state.szdev.mode === "replay" ? state.szdev.baselineCommit : state.baseCommit;
  if (expectedHead) {
    const head = git(context.workspace, ["rev-parse", "HEAD"]);
    if (head.code !== 0) {
      throw new StageError(`Overreach check: cannot read HEAD in ${context.workspace}: ${head.stderr.trim()}`, "finished", head.code, "git");
    }
    const actual = head.stdout.trim();
    if (actual !== expectedHead) {
      throw new StageError(
        `Overreach: the workspace HEAD moved from ${expectedHead} to ${actual} during this run — the agent committed or checked out (forbidden by the sz-dev hard rules). Restore the baseline (or reset the run), then Retry from the failed stage.`,
        "finished",
        1,
        "git",
      );
    }
  }
  assertMcpUnchanged(state);
}

/**
 * Replay-mode overreach guard. Enforces the "clean baseline project": a replay
 * run works on a DETACHED, tracked-clean checkout of the pre-fix baseline.
 *
 *  - Phases 2-4: HEAD must not move at all (the tree may carry the run's
 *    implementation — that is expected, only HEAD is guarded).
 *  - Phase 1: a HEAD move is legal ONLY as the sanctioned replay switch
 *    (workflows/replay-mode.md "The switch") — the tree re-baselined detached
 *    at the true pre-fix baseline. The mechanical signature of a valid switch:
 *      (a) HEAD is DETACHED,
 *      (b) the tracked tree is CLEAN (a switch re-baselines, it does not
 *          implement — implementation starts at phase 2),
 *      (c) the new baseline is exactly the parent of a genuine fix commit for
 *          this SZ (findFixChild) — landing on the right pre-fix baseline
 *          requires knowing the fix, so an accidental or malicious checkout
 *          cannot satisfy this.
 *    A move with all three signatures is ADOPTED: state.json and the replay
 *    registry are re-anchored to it (so sz-replay diff/verify/package in the
 *    later phases run against the tree's real baseline) and progress.md is
 *    re-anchored so sz-verify-tree and every later session agree. Anything
 *    else is overreach and fails the phase.
 *  - Phase 1 with NO move: the tree must still be a clean detached baseline —
 *    phase 1 is requirement-only, so tracked-file changes before the gate-2
 *    review are drift.
 */
async function assertReplayNoOverreach(
  state: RunState,
  context: SzdevContext,
  deps: PipelineDeps,
  phase: 1 | 2 | 3 | 4,
  log: Log,
): Promise<void> {
  const head = git(context.workspace, ["rev-parse", "HEAD"]);
  if (head.code !== 0) {
    throw new StageError(`Overreach check: cannot read HEAD in ${context.workspace}: ${head.stderr.trim()}`, "finished", head.code, "git");
  }
  const actual = head.stdout.trim();
  const previous = state.szdev.baselineCommit;
  const detached = (): boolean => git(context.workspace, ["symbolic-ref", "-q", "HEAD"]).code !== 0;
  const trackedClean = (): boolean => {
    const status = git(context.workspace, ["status", "--porcelain", "--untracked-files=no"]);
    return status.code === 0 && status.stdout.trim() === "";
  };

  if (previous && actual !== previous) {
    if (phase !== 1) {
      throw new StageError(
        `Overreach (replay): the replay tree's HEAD moved from ${previous} to ${actual} during phase ${phase}. Only Phase 1 may re-baseline, and only through the replay switch (workflows/replay-mode.md). Restore the baseline (or reset the run), then Retry from the failed stage.`,
        "finished",
        1,
        "git",
      );
    }
    // Phase 1: accept the move only when it carries the full mechanical
    // signature of the sanctioned switch.
    const isDetached = detached();
    const clean = trackedClean();
    const newFix = findFixChild(context.workspace, state.id, actual);
    if (isDetached && clean && newFix) {
      // ADOPT the re-anchored baseline and keep every anchor consistent.
      state.szdev.baselineCommit = actual;
      state.baseCommit = actual;
      state.szdev.fixCommit = newFix;
      await deps.szdev.replaySetMeta(context, { fix: newFix, baseline: actual });
      await deps.szdev.progressSetBase(context, actual);
      log(`phase1  replay baseline re-anchored ${previous} -> ${actual} (fix ${newFix}): the sanctioned Phase-1 switch is adopted; state and replay registry re-anchored`);
    } else {
      throw new StageError(
        `Overreach (replay): the replay tree's HEAD moved from ${previous} to ${actual} during phase 1 without a valid replay switch. A re-baseline is accepted only when the tree is DETACHED (detached=${isDetached}) and tracked-clean (clean=${clean}) at the new baseline, and the new baseline is the parent of a genuine ${state.id} fix commit (found=${newFix ?? "none"}). Restore the baseline (or reset the run), then Retry from the failed stage.`,
        "finished",
        1,
        "git",
      );
    }
  } else if (phase === 1 && previous) {
    // No move: phase 1 must still end on a clean, detached baseline.
    if (!detached()) {
      throw new StageError(
        `Replay tree is not a clean baseline after phase 1: HEAD is on a branch, but a replay baseline must be a detached checkout of the pre-fix commit. Restore the baseline (git checkout --detach ${previous}) or reset the run.`,
        "finished",
        1,
        "git",
      );
    }
    if (!trackedClean()) {
      throw new StageError(
        `Replay tree is not a clean baseline after phase 1: tracked file(s) changed, but phase 1 is requirement-only — implementation starts at phase 2. Restore the tree to the baseline (git restore --source=HEAD --staged --worktree -- .) or reset the run.`,
        "finished",
        1,
        "git",
      );
    }
  }
  assertMcpUnchanged(state);
}

/**
 * Replay workspace hygiene (run in the workspace stage, before Phase 1): a
 * crashed prior run of the same SZ can leave tracked-file modifications in
 * the replay tree. Left as-is, they would be misread as this run's changes
 * (and, worst case, the fix itself sitting in the tree fakes every red/green
 * verdict). Restore tracked files to the current HEAD — the exact behavior
 * sz-replay init's documented tree-reuse path performs — leaving untracked
 * state (.sz-dev, injected skills/, cql/test/) untouched.
 */
async function restoreTrackedLeftovers(tree: string, log: Log): Promise<void> {
  const status = git(tree, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.code !== 0) {
    throw new StageError(`git status failed in the replay tree ${tree}: ${clip(status.stderr, 300)}`, "finished", status.code, "git");
  }
  if (status.stdout.trim()) {
    const restore = git(tree, ["restore", "--source=HEAD", "--staged", "--worktree", "--", "."]);
    if (restore.code !== 0) {
      throw new StageError(
        `Replay tree ${tree} has leftover tracked changes that could not be restored to its baseline: ${clip(restore.stderr, 300)}. Clean the tree manually or run 'ai-flow reset'.`,
        "finished",
        1,
        "git",
      );
    }
    const recheck = git(tree, ["status", "--porcelain", "--untracked-files=no"]);
    if (recheck.stdout.trim()) {
      throw new StageError(
        `Replay tree ${tree} still has tracked changes after a restore to its baseline (${recheck.stdout.trim().split("\n").slice(0, 5).join(" ")}). The replay run must start from the pre-fix bytes. Run 'ai-flow reset' to start over.`,
        "finished",
        1,
        "git",
      );
    }
    log(`workspace  replay tree had leftover tracked changes — restored to the pre-fix baseline`);
  }
}

/**
 * Verify the replay tree is a clean, DETACHED checkout of `baseline` (the
 * "clean baseline project" invariant). Checks out the baseline when HEAD is
 * elsewhere (the tree is clean by then — restoreTrackedLeftovers ran first),
 * and fails with an actionable message when the invariant cannot be met.
 */
async function verifyCleanReplayBaseline(tree: string, baseline: string, log: Log): Promise<void> {
  if (!baseline) {
    throw new StageError(`Replay tree ${tree} has no baseline recorded — re-run the workspace stage.`, "finished", 1, "git");
  }
  const head = git(tree, ["rev-parse", "HEAD"]);
  if (head.code === 0 && head.stdout.trim() !== baseline) {
    const co = git(tree, ["checkout", "--quiet", "--detach", baseline]);
    if (co.code !== 0) {
      throw new StageError(
        `Replay tree ${tree} could not be checked out at the pre-fix baseline ${baseline}: ${clip(co.stderr, 300)}. Run 'ai-flow reset' to start over.`,
        "finished",
        co.code,
        "git",
      );
    }
    log(`workspace  replay tree checked out at pre-fix baseline ${baseline}`);
  }
  if (git(tree, ["symbolic-ref", "-q", "HEAD"]).code === 0) {
    throw new StageError(
      `Replay tree ${tree} is on a branch; a replay baseline must be a detached checkout of the pre-fix commit. Run 'ai-flow reset' to start over.`,
      "finished",
      1,
      "git",
    );
  }
  const status = git(tree, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.code !== 0) {
    throw new StageError(`git status failed in the replay tree ${tree}: ${clip(status.stderr, 300)}`, "finished", status.code, "git");
  }
  if (status.stdout.trim()) {
    throw new StageError(
      `Replay tree ${tree} is not a clean baseline at ${baseline}: ${status.stdout.trim().split("\n").slice(0, 5).join(" ")}. The replay run must start from the pre-fix bytes. Run 'ai-flow reset' to start over.`,
      "finished",
      1,
      "git",
    );
  }
  log(`workspace  replay baseline verified: detached and tracked-clean at ${baseline}`);
}
