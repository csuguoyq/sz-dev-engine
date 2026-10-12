import fs from "node:fs";
import path from "node:path";
import { StageError } from "./errors.js";
import { STAGES, type RunState, type StageName, type StageState, type StageStatus } from "./types.js";

/**
 * A writeState found a NEWER revision on disk than the in-memory snapshot.
 * The write was refused (no partial update was applied) so the caller can
 * re-read and re-apply its mutation instead of clobbering the concurrent
 * writer. Thrown only by writeState; withStateUpdate retries on it.
 */
export class ConcurrentStateError extends Error {
  constructor(readonly expectedRev: number, readonly onDiskRev: number) {
    super(
      `state.json was modified by another process (snapshot had rev ${expectedRev}, disk has rev ${onDiskRev}); ` +
        `the write was refused to avoid losing the concurrent update`,
    );
    this.name = "ConcurrentStateError";
  }
}

/**
 * A mutator re-checking the state's semantics (e.g. "still running") found a
 * mismatch after a concurrent re-read. Unlike ConcurrentStateError this is a
 * semantic conflict, not a lost-update retry: the caller answers 409.
 */
export class StateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateConflictError";
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function emptyStages(): Record<StageName, StageState> {
  const stages = {} as Record<StageName, StageState>;
  for (const name of STAGES) stages[name] = { status: "pending" };
  return stages;
}

export function createState(id: string, worktree: string, baseCommit: string): RunState {
  const started = nowIso();
  return {
    id,
    rev: 0,
    status: "running",
    stage: "workspace",
    startedAt: started,
    updatedAt: started,
    baseCommit,
    worktree,
    stages: emptyStages(),
    artifacts: {},
    szdev: { mode: "standard", workspace: worktree, gates: {} },
    error: null,
  };
}

export function statePath(runDir: string): string {
  return path.join(runDir, "state.json");
}

export function readState(runDir: string): RunState {
  return JSON.parse(fs.readFileSync(statePath(runDir), "utf8")) as RunState;
}

/**
 * readState that tolerates a corrupted file (returns null instead of
 * throwing). One bad run record must not be able to crash the viewer
 * process or take down a whole pipeline start.
 */
export function readStateOrNull(runDir: string): RunState | null {
  try {
    return readState(runDir);
  } catch {
    return null;
  }
}

export function writeState(runDir: string, state: RunState): void {
  fs.mkdirSync(runDir, { recursive: true });
  state.updatedAt = nowIso();
  // Optimistic concurrency: the two writers (the pipeline process and the
  // viewer) both do read-modify-write. The atomic rename below prevents torn
  // writes but not lost updates, so before writing we re-read the on-disk
  // revision and refuse when it is ahead of our snapshot's revision. A
  // refused write applies nothing; callers that can retry (viewer handlers)
  // use withStateUpdate.
  const diskRev = readStateOrNull(runDir)?.rev ?? 0;
  const memRev = state.rev ?? 0;
  if (diskRev > memRev) throw new ConcurrentStateError(memRev, diskRev);
  state.rev = Math.max(diskRev, memRev) + 1;
  // Write to a temp file and rename so a crash mid-write cannot leave a
  // truncated state.json behind (readStateOrNull would see it as corrupted).
  // The temp name is UNIQUE per process+moment (like mcp.ts's writeFileAtomic):
  // the two writers (pipeline and viewer) can interleave in the tiny window
  // between the rev check and the rename, and a SHARED temp name would let one
  // writer truncate/rename the other's in-flight file (ENOENT crash or a
  // half-written rename target). Unique names make each rename atomic on its
  // own file.
  const destination = statePath(runDir);
  const tmp = `${destination}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, destination);
}

/**
 * Read-modify-write with optimistic-concurrency retries. The mutator runs
 * against a FRESH copy of the on-disk state on every attempt (re-validation
 * checks like "still running" must see the concurrent writer's update), and
 * the write is refused when the disk moved underneath us. StateConflictError
 * (a semantic re-check failed) is re-thrown immediately — it is not a retry;
 * only ConcurrentStateError (someone wrote meanwhile) triggers a backoff
 * retry.
 *
 * This is best-effort optimistic concurrency, not a strict CAS: between the
 * re-read and the rename two writers could still interleave. For this local
 * operator tool (a handful of sequential human actions) the retry window is
 * vanishingly small; a strict lockfile-free CAS is not available on POSIX.
 */
export async function withStateUpdate(
  runDir: string,
  mutator: (state: RunState) => void,
  retries = 5,
): Promise<RunState> {
  let attempt = 0;
  for (;;) {
    const state = readStateOrNull(runDir);
    if (!state) {
      throw new StageError(
        `Run state for ${path.basename(runDir)} is corrupted; use 'ai-flow reset' to start over.`,
        "finished",
        1,
        "state.json",
      );
    }
    try {
      mutator(state);
      writeState(runDir, state);
      return state;
    } catch (err) {
      if (!(err instanceof ConcurrentStateError) || attempt >= retries - 1) throw err;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export function listRuns(runsRoot: string): RunState[] {
  if (!fs.existsSync(runsRoot)) return [];
  const states: RunState[] = [];
  for (const name of fs.readdirSync(runsRoot)) {
    const file = path.join(runsRoot, name, "state.json");
    if (!fs.existsSync(file)) continue;
    try {
      states.push(JSON.parse(fs.readFileSync(file, "utf8")) as RunState);
    } catch {
      continue;
    }
  }
  return states.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export function beginStage(state: RunState, stage: StageName): void {
  state.stage = stage;
  state.status = "running";
  state.stages[stage] = { status: "running", startedAt: nowIso() };
}

export function finishStage(
  state: RunState,
  stage: StageName,
  status: StageStatus,
  extra: Partial<StageState> = {},
): void {
  const current = state.stages[stage];
  state.stages[stage] = {
    ...current,
    ...extra,
    status,
    startedAt: current.startedAt ?? nowIso(),
    finishedAt: nowIso(),
  };
}

export function skipRest(state: RunState, from: StageName): void {
  const start = STAGES.indexOf(from);
  for (const name of STAGES.slice(start + 1)) {
    if (state.stages[name].status === "pending" || state.stages[name].status === "running") {
      state.stages[name] = { status: "skipped", finishedAt: nowIso() };
    }
  }
}

export function formatStageLine(id: string, stage: string, status: string): string {
  return `${id}  ${stage.padEnd(10, " ")} ${status}`;
}
