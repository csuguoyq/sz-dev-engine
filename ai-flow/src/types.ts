export const STAGES = [
  "workspace",
  "phase1",
  "phase2",
  "phase3",
  "phase4",
  "review",
] as const;

export type StageName = (typeof STAGES)[number];

export type StageStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "passed_with_blocked"
  | "awaiting_review";

export type RunStatus = "running" | "failed" | "awaiting_review" | "approved";

export const REWORK_STAGES = ["phase1", "phase2", "phase3", "phase4"] as const;

export type ReworkStage = (typeof REWORK_STAGES)[number];

export type GateNumber = 1 | 2 | 3 | 4;

export type GateStatus = "pending" | "passed" | "rejected";

/**
 * What the run is waiting on while status is awaiting_review.
 * gate4: the final human audit. clarification: an open E1 escalation
 * (blocking requirement questions the human must answer). escalation:
 * any other open E2-E7 escalation the human must resolve.
 */
export interface Awaiting {
  kind: "gate4" | "clarification" | "escalation";
  code?: string;
}

export interface ReviewRecord {
  at: string;
  decision: "approve" | "reject" | "message";
  stage?: ReworkStage;
  comment?: string;
}

export interface Rework {
  stage: ReworkStage;
  comment: string;
  at: string;
}

export interface StageState {
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  command?: string;
  error?: string;
}

export interface TestSummary {
  /**
   * "unverified" = the report carries no machine-readable totals at all
   * (hand-authored report with no PASS=/FAIL=/SKIP= line): evidence that
   * the phase ran exists, but no test counts can be confirmed. It is not
   * a failure, but it must not render as a green "passed" either.
   */
  verdict: "passed" | "passed_with_blocked" | "failed" | "unverified";
  skipped: string[];
  pass: number;
  fail: number;
  skip: number;
}

/**
 * Mirror of the sz-dev state machine (sz-progress progress.md).
 * sz-progress is the single source of truth; this mirror exists only
 * so the viewer and resume logic can render state without re-running
 * the tool. Refreshed after every sz-progress call.
 */
export interface SzdevMirror {
  mode: "standard" | "replay";
  /** The sz-dev workspace checkout (replay mode: the replay tree). */
  workspace: string;
  /** Module pack name picked in phase1 (for example "cql"). */
  pack?: string;
  replayDir?: string;
  baselineCommit?: string;
  fixCommit?: string;
  phase?: number;
  rounds?: number;
  track?: "auto" | "manual";
  gates?: Partial<Record<GateNumber, GateStatus>>;
  awaiting?: string | null;
  escalationNotes?: string[];
  /**
   * What surface gate2-reviewed.patch holds. "product" (current versions):
   * the module's product-code surface. Absent/"full": written by an ai-flow
   * version that snapshotted the FULL tree — the phase-4 compare falls back
   * to extracting the product sections from it (filterPatchToProductSurface).
   */
  gate2Surface?: "product" | "full";
}

export interface RunArtifacts {
  requirement?: string;
  testCases?: string;
  testReport?: string;
  patch?: string;
  package?: string;
  filelist?: string;
}

export interface RunState {
  id: string;
  /**
   * Monotonic revision, bumped by every writeState. Optimistic concurrency
   * for the two writers (pipeline process and viewer): a write is refused
   * when the on-disk rev is ahead of the in-memory snapshot's rev, so a
   * read-modify-write cannot silently lose a concurrent update (store.ts).
   */
  rev?: number;
  status: RunStatus;
  stage: StageName;
  startedAt: string;
  updatedAt: string;
  baseCommit: string;
  worktree: string;
  stages: Record<StageName, StageState>;
  artifacts: RunArtifacts;
  szdev: SzdevMirror;
  /** Agent model override for this run ("provider/model"). */
  model?: string;
  test?: TestSummary;
  awaiting?: Awaiting;
  error: string | null;
  reviews?: ReviewRecord[];
  rework?: Rework;
  /**
   * Run-start fingerprints (sha256) of the configured agent's MCP config
   * files. Re-checked after every phase: a change means the agent edited its
   * own tool surface (forbidden) or the operator used Manage MCP mid-run.
   */
  mcpHashes?: Record<string, string>;
}

export interface Change {
  status: "A" | "M" | "D";
  path: string;
}

export interface AiFlowConfig {
  /** Preset id from `ai-flow init` (cursor, claude, chatgpt, deepseek, zcode, opencode). */
  agent?: string;
  /** Model id for the preset. Empty means the CLI's own default. */
  model?: string;
  /**
   * Filled from the preset when `agent` is set. A legacy file may set
   * `command` directly. Tokens: `{promptStdin}`, `{promptArg}`, `{promptFile}`,
   * `{cwd}`, `{model}`.
   */
  runner: {
    command: string[];
    /** Flag used when `command` has no `{model}` token, e.g. "-m" or "--model". Defaults to "-m" for a legacy command. */
    modelFlag?: string;
    /** Optional command that lists models for the viewer dropdown. Omit to use the preset's own list. */
    modelsCommand?: string[];
    /**
     * Explicit model ids for the viewer dropdown and init, winning over every
     * preset-derived source (modelsCommand, listModels, modelsFromConfig).
     * A CLI's locally-readable config rarely knows which plan models are
     * actually entitled server-side; this lets the operator pin the truth.
     */
    models?: string[];
    /** Optional command (with a `{dir}` token) that prints live session status as JSON. */
    statusCommand?: string[];
    /**
     * Optional regex (string) matched against `<command> --version` output.
     * When set, runAgent fails fast with a clear error if the resolved agent
     * binary is missing or reports an unexpected version — surfacing a wrong
     * PATH / stale install before the (slow, costly) agent run begins.
     */
    versionCheck?: string;
  };
  ui?: {
    host?: string;
    port?: number;
    /** Optional bearer token protecting the viewer. When set, every request must present it (Authorization: Bearer, or ?token=). Leave empty to disable. */
    token?: string;
    /**
     * Per-client request ceiling for the viewer, in requests/minute
     * (sliding window, keyed by client address). A wedged or hostile tab
     * must not be able to hammer the API; 0 disables the limit. Defaults to
     * 600/min, comfortably above the UI's own polling (≈130 req/min per tab).
     */
    rateLimitPerMinute?: number;
  };
  /**
   * Global pipeline watchdog. When `maxMinutes` is set (>0), if a run runs
   * longer than this it is force-stopped (its agent is SIGTERM'd). 0 disables
   * it. When unset, ai-flow applies a 720-minute (12h) safety default so a
   * genuinely hung agent cannot run forever and hold the run lock. A normal
   * long run should set this comfortably above expected duration.
   */
  run?: { maxMinutes?: number };
  szdev?: {
    /** Absolute path to the sz-dev skill directory (contains tools/). */
    skillDir?: string;
    workspaceRoot?: string;
    /** Default module pack when phase1 does not record one (for example "cql"). */
    pack?: string;
    testTimeoutSeconds?: number;
    designatedHost?: string;
  };
}
