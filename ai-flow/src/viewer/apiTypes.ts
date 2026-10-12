/**
 * The JSON shapes the viewer API serves, owned by the server. The React UI
 * re-exports them from viewer-ui/src/shared.ts (a relative import into src/,
 * the same pattern LiveLogPanel uses for StreamEvent) so the two trees no
 * longer hand-mirror each other: changing a field here is a type error in
 * both the server and the UI, not a silent drift.
 */
import type { RunState, StageState } from "../types.js";

/** One stage's progress as shown in the run detail. */
export type StageInfo = StageState;

/** Row of the runs list (GET /api/runs). */
export interface RunSummary {
  id: string;
  stage: string;
  status: string;
  startedAt: string;
  mode?: string | null;
  pack?: string | null;
  phase?: number | null;
  gates?: Record<string, string> | null;
  awaiting?: { kind: string; code?: string } | null;
  testVerdict: string | null;
  error: string | null;
  /**
   * True when the run's pack has no dedicated module adapter (the generic
   * fallback): no scope guard, no automatic pack check — the gate-4 human
   * audit is the only backstop. The UI shows a loud warning.
   */
  genericPack?: boolean;
}

/** One document tab's content in the run detail. */
export interface RunDoc {
  ready?: boolean;
  markdown?: string;
  files?: Array<{ name: string; content: string }>;
}

/** Run detail (GET /api/runs/:id): the full state mirror plus documents. */
export interface RunDetail {
  state: RunState;
  docs: Record<string, RunDoc>;
  /** Same generic-pack warning as RunSummary, for the detail banner. */
  genericPack?: boolean;
}

/**
 * The viewer's "start the pipeline" hook. The server injects the real
 * detached-spawn implementation; tests substitute a no-op or a recorder.
 * Lives in the shared types (not routes.ts) so the route modules can
 * reference it without importing the dispatcher.
 */
export type StartRun = (repoRoot: string, id: string, model?: string) => void;

/**
 * The agent status bar's session object. The field set depends on the agent
 * (runner.statusCommand JSON or OpenCode's session database), so unknown
 * fields are allowed.
 */
export interface AgentSessionInfo {
  model?: unknown;
  agent?: string;
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  startedAt?: number;
  updatedAt?: number;
  slug?: string;
  provider?: string;
  variant?: string;
  mode?: string;
  status?: string;
  sessionId?: string;
  title?: string;
  [key: string]: unknown;
}

/** Agent status bar payload (GET /api/agent-status). */
export interface AgentStatus {
  dir: string;
  agent: string | null;
  label: string | null;
  model: string | null;
  session: AgentSessionInfo | null;
}
