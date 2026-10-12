import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stopPipeline } from "../src/stop.js";
import { finishStage, readState, readStateOrNull, skipRest, StateConflictError, withStateUpdate, writeState } from "../src/store.js";
import { StageError } from "../src/errors.js";
import { runAgent } from "../src/runner.js";
import type { AgentRequest } from "../src/runner.js";
import { runPipeline, type PipelineDeps, type SzdevOps } from "../src/orchestrator.js";
import { filterPatchToProductSurface, patchText } from "../src/git.js";
import { progressAwaiting, progressInit, progressNote, progressSetGate, progressSetPhase, progressShow, runToolOrThrow } from "../src/szdev.js";
import { registryDir, resetRun } from "../src/reset.js";
import type { GateNumber } from "../src/types.js";
import type { ProgressSnapshot, ReplayInit, SzdevContext, WorkspaceEnsure } from "../src/szdev.js";
import type { AiFlowConfig } from "../src/types.js";
import { startUi } from "../src/viewer/server.js";

const SKILL_DIR = path.resolve(import.meta.dirname, "../../skills/sz-dev");

const config: AiFlowConfig = {
  runner: { command: ["fake-agent", "{promptFile}"] },
  szdev: { skillDir: SKILL_DIR },
};

// packageDir() falls back to ~/sz, which is read-only on some test hosts:
// pin the file to a writable temp dir unless the variable is already set.
// (Individual tests may still point it at their own root; tests that change
// it must restore the previous value so this pin survives the suite.)
if (!process.env.SZ_PACKAGE_DIR) {
  process.env.SZ_PACKAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-pkg-"));
}

// ---------------------------------------------------------------------------
// Fake sz-dev control plane (in-memory sz-progress)
// ---------------------------------------------------------------------------

interface FakeProgress {
  phase: number | "aborted";
  gates: Partial<Record<GateNumber, "pending" | "passed" | "rejected">>;
  awaiting: string | null;
  notes: string[];
  base?: string;
}

function fakeSzdev(options: {
  ensure?: WorkspaceEnsure;
  replay?: ReplayInit | ((fixCommit: string) => ReplayInit);
  fixCommit?: string | null;
  /** Mutable stand-in for the replay registry (replay-SZxxxx.meta). */
  metaStore?: { fix?: string; baseline?: string };
} = {}) {
  const progress = new Map<string, FakeProgress>();
  const api = {
    ops: {
      workspaceEnsure: async (req: { skillDir: string; id: string }) =>
        options.ensure ?? { mode: "standard" as const, workspace: process.env.__WORKSPACE__ ?? "" },
      findFixCommit: () => options.fixCommit ?? null,
      replayInit: async (opts: { skillDir: string; id: string; fixCommit: string; repo: string }): Promise<ReplayInit> => {
        if (!options.replay) throw new StageError("unexpected replay init", "finished", 1);
        return typeof options.replay === "function" ? options.replay(opts.fixCommit) : options.replay;
      },
      progressInit: async (ctx: SzdevContext): Promise<void> => {
        api.get(ctx);
      },
      progressShow: async (ctx: SzdevContext): Promise<ProgressSnapshot> => {
        const state = api.get(ctx);
        return {
          phase: state.phase,
          rounds: 0,
          mode: "file",
          track: "auto",
          base: state.base,
          gates: state.gates,
          awaiting: state.awaiting,
          notes: state.notes,
        };
      },
      progressSetPhase: async (ctx: SzdevContext, phase: number | "aborted"): Promise<void> => {
        api.get(ctx).phase = phase;
      },
      progressSetGate: async (ctx: SzdevContext, gate: GateNumber, status: "pending" | "passed" | "rejected"): Promise<void> => {
        api.get(ctx).gates[gate] = status;
      },
      progressSetBase: async (ctx: SzdevContext, base: string): Promise<void> => {
        api.get(ctx).base = base;
      },
      progressAwaiting: async (ctx: SzdevContext, escalation: string | "clear"): Promise<void> => {
        api.get(ctx).awaiting = escalation === "clear" ? null : escalation;
      },
      progressNote: async (ctx: SzdevContext, text: string): Promise<void> => {
        api.get(ctx).notes.push(text);
      },
      replayVerify: async () => "ok",
      replayAudit: async () => "clean",
      replayDiff: async () => "diff --git a/cql/lisp/added.scm\n",
      replayDiffNames: async () => ["cql/lisp/added.scm"],
      replayPackage: async (_ctx: SzdevContext, _paths: string[]) => "/tmp/replay-package.tar.gz",
      replayMeta: () => options.metaStore ?? null,
      replaySetMeta: async (_ctx: SzdevContext, meta: { fix?: string; baseline?: string }): Promise<void> => {
        const store = options.metaStore;
        if (!store) return;
        if (meta.fix) store.fix = meta.fix;
        if (meta.baseline) store.baseline = meta.baseline;
      },
    } satisfies SzdevOps,
    get(ctx: SzdevContext): FakeProgress {
      const key = `${ctx.szDevDir ?? path.join(ctx.workspace, ".sz-dev")}/${ctx.id}`;
      let state = progress.get(key);
      if (!state) {
        state = { phase: 0, gates: { 1: "pending", 2: "pending", 3: "pending", 4: "pending" }, awaiting: null, notes: [] };
        progress.set(key, state);
      }
      return state;
    },
    snapshot(ctx: SzdevContext): FakeProgress {
      return api.get(ctx);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Fake agents
// ---------------------------------------------------------------------------

function stateDirOf(cwd: string): string {
  const root = path.join(cwd, ".sz-dev");
  const existing = fs.existsSync(root) ? fs.readdirSync(root).find((name) => /^SZ\d+$/.test(name)) : undefined;
  return path.join(root, existing ?? "SZ1");
}

function writeStateFiles(cwd: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(stateDirOf(cwd), name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
}

/** Agent that follows the whole sz-dev flow: artifacts per phase, code in phase2. */
function happyAgent(fake: ReturnType<typeof fakeSzdev>, ctx: SzdevContext) {
  return async (request: AgentRequest) => {
    const prompt = fs.readFileSync(request.promptFile, "utf8");
    if (prompt.includes("Phase 1 (requirement)")) {
      writeStateFiles(request.cwd, {
        "phase1-requirement.md": "# Requirement\n\nrepro: n/a\n\nmodule pack: cql\n",
        "attachment/ticket-body.md": "# SZ1 body\n",
        "attachment/ticket-comments.md": "# comments\n",
        "deliverables/clarification-comments.md": "No blocking questions.\n",
      });
      if (fake.snapshot(ctx).awaiting === null && fs.existsSync(path.join(request.cwd, ".ask-e1"))) {
        fake.snapshot(ctx).awaiting = "E1";
      }
    } else if (prompt.includes("Phase 2 (implementation")) {
      fs.mkdirSync(path.join(request.cwd, "cql/lisp"), { recursive: true });
      fs.writeFileSync(path.join(request.cwd, "cql/lisp/added.scm"), ";;; FILE: added.scm\n");
      writeStateFiles(request.cwd, {
        "phase2-plan.md": "# Plan\n- step\n",
        "phase2-review.md": "## Self-review\nok\n\n## Independent review\nok\n",
        "phase4-handoff.md": "# Handoff\n- cql/lisp/added.scm\n",
        "checkpoints/SZ1_gate2.patch": "diff --git a/cql/lisp/added.scm\n",
      });
    } else if (prompt.includes("Phase 3 (testing)")) {
      writeStateFiles(request.cwd, {
        "phase3-test-plan.md": "# Test plan\n- case 1\n",
        "phase3-test-report.md": "# Report\n\nPASS=1 FAIL=0 SKIP=0\n",
      });
    } else if (prompt.includes("Phase 4 (deliverables)")) {
      writeStateFiles(request.cwd, {
        "deliverables/RN-SZ1.md": "# Release note\n",
        "deliverables/TC-SZ1.md": "# Test case\n",
        "deliverables/CHANGES-SZ1.patch": "diff --git a/cql/lisp/added.scm\n",
      });
    }
    return { exitCode: 0, commandName: "fake-agent" };
  };
}

function depsWith(fake: ReturnType<typeof fakeSzdev>, agent: (request: AgentRequest) => Promise<{ exitCode: number; commandName: string }>): Partial<PipelineDeps> {
  return {
    runAgent: agent,
    szdev: fake.ops,
  };
}

// ---------------------------------------------------------------------------
// Pipeline tests
// ---------------------------------------------------------------------------

test("standard run drives the sz-dev state machine and stops at gate 4", async () => {
  const root = initRepo();
  process.env.SZ_PACKAGE_DIR = path.join(root, "packages");
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const result = await runPipeline({
      repoRoot: root,
      id: "SZ1",
      log: () => undefined,
      config,
      deps: depsWith(fake, happyAgent(fake, ctx)),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.status, "awaiting_review");
    assert.equal(result.state.awaiting?.kind, "gate4");
    assert.equal(result.state.szdev.mode, "standard");
    assert.equal(result.state.szdev.pack, "cql");
    assert.equal(result.state.szdev.gates?.[1], "passed");
    assert.equal(result.state.szdev.gates?.[2], "passed");
    assert.equal(result.state.szdev.gates?.[3], "passed");
    assert.equal(result.state.szdev.gates?.[4], "pending");
    assert.equal(result.state.szdev.phase, 4);
    assert.equal(result.state.stages.review.status, "awaiting_review");

    // sz-dev evidence and delivery
    assert.equal(fs.existsSync(path.join(root, ".sz-dev", "SZ1", "phase1-requirement.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".sz-dev", "SZ1", "phase2-review.md")), true);
    assert.equal(fs.existsSync(path.join(root, ".sz-dev", "SZ1", "phase3-test-report.md")), true);
    assert.match(fs.readFileSync(path.join(root, ".sz-dev", "SZ1", "deliverables", "RN-SZ1.md"), "utf8"), /Release note/);
    assert.equal(fs.existsSync(path.join(root, ".ai-flow", "runs", "SZ1", "changes.patch")), true);
    assert.match(result.state.artifacts.package ?? "", /SZ1_\d{12}\.tar\.gz/);
    assert.equal(fs.existsSync(result.state.artifacts.package ?? ""), true);
    assert.equal(result.state.test?.verdict, "passed");

    // prompts carry hard rules and workflow paths
    const prompt2 = fs.readFileSync(path.join(root, ".ai-flow", "runs", "SZ1", "prompts", "phase2.md"), "utf8");
    assert.match(prompt2, /Never git commit/);
    assert.match(prompt2, /phase2-implementation\.md/);
    assert.match(prompt2, /references\/cql/);

    // gate 4 has not been passed yet — the human passes it on approve
    assert.equal(fake.snapshot(ctx).gates[4], "pending");

    // the run is waiting for review, so it cannot be restarted
    await assert.rejects(
      () => runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) }),
      (err: unknown) => err instanceof StageError && err.kind === "startup",
    );
  } finally {
    cleanup(root);
  }
});

test("a viewer stop racing the pipeline is preserved, not clobbered by a stage failure", async () => {
  // Regression: the viewer's Stop writes state.json (via withStateUpdate)
  // while the pipeline is still running. When the stop lands in the
  // pipeline's error window — e.g. the stop kills the run, the pipeline's
  // phase then fails, and its catch writes a stage failure — the old code
  // overwrote the operator's record: the run showed a stage error instead
  // of "Stopped by user". The pipeline now re-reads the disk and defers to
  // a record that is no longer "running".
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const racingAgent = async (request: AgentRequest): Promise<{ exitCode: number; commandName: string }> => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 1 (requirement)")) {
        // The viewer's Stop mid-phase-1: the exact mutator stopRun uses.
        const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
        await withStateUpdate(runDir, (s) => {
          if (s.status !== "running") throw new StateConflictError(`${s.id} is no longer running (${s.status})`);
          const stage = s.stage;
          finishStage(s, stage, "failed", { exitCode: null, error: "Stopped by user; state preserved — Retry to resume from here." });
          s.status = "failed";
          s.error = `Stopped by user at ${stage}; sz-dev state preserved — Retry to resume, Delete to remove.`;
          skipRest(s, stage);
        });
      }
      return { exitCode: 0, commandName: "fake-agent" };
    };
    const result = await runPipeline({
      repoRoot: root,
      id: "SZ1",
      log: () => undefined,
      config,
      deps: depsWith(fake, racingAgent),
    });
    const stored = readState(path.join(root, ".ai-flow", "runs", "SZ1"));
    assert.equal(result.exitCode, 2);
    // The stopper's record survives byte-for-byte: no stage-failure text.
    assert.equal(stored.status, "failed");
    assert.equal(stored.error, "Stopped by user at phase1; sz-dev state preserved — Retry to resume, Delete to remove.");
    assert.equal(stored.stages.phase1.error, "Stopped by user; state preserved — Retry to resume from here.");
    assert.equal(result.state.error, stored.error, "the pipeline reports the deferred record, not its own failure");
    // The lock is released and the run can be retried from the failed stage.
    assert.equal(fs.existsSync(path.join(root, ".ai-flow", "runs", "SZ1", "run.lock")), false, "the run lock is released");
  } finally {
    cleanup(root);
  }
});

test("a second runPipeline on the same ticket is refused while the lock is held", async () => {
  const root = initRepo();
  // A process whose cmdline reads like an ai-flow pipeline: `node -e <script>`
  // keeps every argv token visible in /proc/<pid>/cmdline, unlike
  // `bash -c 'sleep 30' ai-flow cli.js run` — bash exec-optimizes the simple
  // command and replaces its own image with `sleep`, dropping the marker
  // tokens that isAiFlowPipeline looks for.
  const pipeline = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "ai-flow", "cli.js", "run"], { stdio: "ignore" });
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    await new Promise((resolve) => setTimeout(resolve, 400)); // let the child settle
    const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "run.lock"), JSON.stringify({ pid: pipeline.pid, startedAt: new Date().toISOString() }));
    await assert.rejects(
      () => runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) }),
      (err: unknown) => err instanceof StageError && /already in progress/.test(err.message),
    );
    // After the holder is gone the stale lock is reaped and the ticket runs.
    pipeline.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const result = await runPipeline({
      repoRoot: root,
      id: "SZ1",
      log: () => undefined,
      config,
      deps: depsWith(fake, happyAgent(fake, ctx)),
    });
    assert.equal(result.state.szdev.mode, "standard");
  } finally {
    if (pipeline.pid !== undefined) {
      try {
        process.kill(pipeline.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    cleanup(root);
  }
});

test("an E1 escalation pauses the run and the answer resumes the same phase", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const agent = happyAgent(fake, ctx);
    fs.writeFileSync(path.join(root, ".ask-e1"), "1\n");

    const first = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
    assert.equal(first.exitCode, 0);
    assert.equal(first.state.status, "awaiting_review");
    assert.deepEqual(first.state.awaiting, { kind: "clarification", code: "E1" });
    assert.equal(first.state.stage, "phase1");
    assert.equal(fake.snapshot(ctx).gates[1], "pending");

    // Human answers: resume phase1 with the answer injected.
    const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
    const stored = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    stored.rework = { stage: "phase1", comment: "The answer is: use the shared pool", at: "2026-09-28T00:00:00.000Z" };
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(stored));
    fs.rmSync(path.join(root, ".ask-e1"));

    let phase1Prompts = 0;
    const countingAgent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 1 (requirement)")) phase1Prompts += 1;
      return agent(request);
    };
    const second = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, countingAgent) });
    assert.equal(second.exitCode, 0);
    assert.equal(second.state.status, "awaiting_review");
    assert.equal(second.state.awaiting?.kind, "gate4");
    assert.equal(phase1Prompts, 1);
    const answered = fs.readFileSync(path.join(runDir, "prompts", "phase1.md"), "utf8");
    assert.match(answered, /use the shared pool/);
    assert.equal(fake.snapshot(ctx).awaiting, null);
  } finally {
    cleanup(root);
  }
});

test("a gate-4 rejection rewinds to phase2, resets gates, and reruns", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const first = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(first.state.status, "awaiting_review");

    const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
    const stored = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    stored.rework = { stage: "phase2", comment: "Wrong approach, redo the implementation", at: "2026-09-28T00:00:00.000Z" };
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(stored));

    const prompts: string[] = [];
    const countingAgent = async (request: AgentRequest) => {
      prompts.push(path.basename(request.promptFile));
      return happyAgent(fake, ctx)(request);
    };
    const second = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, countingAgent) });
    assert.equal(second.exitCode, 0);
    assert.equal(second.state.status, "awaiting_review");
    assert.equal(second.state.rework, undefined);
    assert.deepEqual(prompts, ["phase2.md", "phase3.md", "phase4.md"]);
    assert.match(fs.readFileSync(path.join(runDir, "prompts", "phase2.md"), "utf8"), /Wrong approach/);
    // sz-progress reset the downstream gates on the backward move
    assert.equal(fake.snapshot(ctx).gates[2], "passed");
    assert.equal(fake.snapshot(ctx).gates[3], "passed");
  } finally {
    cleanup(root);
  }
});

test("a failed phase3 resumes at phase3 without re-running earlier phases", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    let phase3Runs = 0;
    const flakyAgent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 3 (testing)")) {
        phase3Runs += 1;
        if (phase3Runs === 1) throw new StageError("test host unavailable", "finished", 3, "accept");
      }
      return happyAgent(fake, ctx)(request);
    };
    const first = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, flakyAgent) });
    assert.equal(first.exitCode, 2);
    assert.equal(first.state.stages.phase3.status, "failed");
    assert.equal(first.state.stages.phase4.status, "skipped");

    const second = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, flakyAgent) });
    assert.equal(second.exitCode, 0);
    assert.equal(second.state.status, "awaiting_review");
    assert.equal(phase3Runs, 2);
    assert.equal(second.state.stages.phase1.status, "passed");
    assert.equal(second.state.stages.phase4.status, "passed");
  } finally {
    cleanup(root);
  }
});

test("a failed phase2 (first attempt) resumes without a full reset", async () => {
  // Regression: the resume baseline check used to demand gate2-reviewed.patch
  // for ANY resume at phase 2 or later — but phase 2 is the stage that WRITES
  // that file, so a first-attempt phase-2 failure demanded a full reset.
  const root = initRepo();
  process.env.SZ_PACKAGE_DIR = path.join(root, "packages");
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    let phase2Runs = 0;
    const flakyAgent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 2 (implementation")) {
        phase2Runs += 1;
        if (phase2Runs === 1) throw new StageError("fake phase-2 agent crash", "finished", 1, "fake-agent");
      }
      return happyAgent(fake, ctx)(request);
    };
    const first = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, flakyAgent) });
    assert.equal(first.exitCode, 2);
    assert.equal(first.state.status, "failed");
    assert.equal(first.state.stage, "phase2");
    // The first attempt never reached the gate-2 snapshot write.
    assert.equal(fs.existsSync(path.join(root, ".ai-flow", "runs", "SZ1", "gate2-reviewed.patch")), false);

    // Retry: must resume at phase 2 (not demand a reset) and finish cleanly.
    const second = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, flakyAgent) });
    assert.equal(second.exitCode, 0, `retry should complete: ${second.state.error ?? ""}`);
    assert.equal(second.state.status, "awaiting_review");
    assert.equal(phase2Runs, 2);
    assert.equal(second.state.stages.phase1.status, "passed");
    assert.equal(second.state.stages.phase4.status, "passed");
  } finally {
    cleanup(root);
  }
});

test("changes outside cql fail phase2 before any gate passes", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const rogueAgent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 2 (implementation")) {
        fs.writeFileSync(path.join(request.cwd, "README.md"), "nope\n");
      }
      return happyAgent(fake, ctx)(request);
    };
    const result = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, rogueAgent) });
    assert.equal(result.exitCode, 2);
    assert.equal(result.state.stages.phase2.status, "failed");
    assert.equal(result.state.szdev.gates?.[2], "pending");
    assert.equal(result.state.artifacts.package, undefined);
  } finally {
    cleanup(root);
  }
});

test("phase3 code drift outside the test area fails before gate 3", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const driftAgent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 3 (testing)")) {
        fs.writeFileSync(path.join(request.cwd, "cql/lisp/init.scm"), ";;; drifted after review\n");
      }
      return happyAgent(fake, ctx)(request);
    };
    const result = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, driftAgent) });
    assert.equal(result.exitCode, 2);
    assert.equal(result.state.stages.phase3.status, "failed");
    assert.equal(result.state.szdev.gates?.[3], "pending");
    assert.match(result.state.error ?? "", /outside the allowed test area/);
    assert.equal(result.state.artifacts.package, undefined);
  } finally {
    cleanup(root);
  }
});

test("drift surviving a phase-3 escalation is caught at phase 4", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    let firstPhase3 = true;
    const agent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 3 (testing)") && firstPhase3) {
        firstPhase3 = false;
        // Drift the reviewed tree, then block on an escalation. The resume
        // re-snapshots on entry, so the phase-3 check alone cannot see this.
        fs.writeFileSync(path.join(request.cwd, "cql/lisp/init.scm"), ";;; drifted after review\n");
        fake.snapshot(ctx).awaiting = "E2";
      }
      return happyAgent(fake, ctx)(request);
    };
    const first = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
    assert.equal(first.exitCode, 0);
    assert.equal(first.state.status, "awaiting_review");
    assert.deepEqual(first.state.awaiting, { kind: "escalation", code: "E2" });

    // Human resolves the escalation; phase 3 finishes on the drifted tree.
    const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
    const stored = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    stored.rework = { stage: "phase3", comment: "Escalation resolved", at: "2026-09-28T00:00:00.000Z" };
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(stored));

    const second = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
    assert.equal(second.exitCode, 2);
    assert.equal(second.state.stages.phase3.status, "passed");
    assert.equal(second.state.szdev.gates?.[3], "passed");
    assert.equal(second.state.stages.phase4.status, "failed");
    assert.match(second.state.error ?? "", /gate-2 review/);
    assert.equal(second.state.artifacts.package, undefined);
  } finally {
    cleanup(root);
  }
});

test("phase3 changes inside the module test area are allowed through phase 4", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const testAreaAgent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 3 (testing)")) {
        // The accepted phase-3 failure loop may add test material to the
        // module test area; the phase-4 backstop compares the product
        // surface only, so this must not fail the run.
        const dir = path.join(request.cwd, "cql/test/acceptance");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "sz1-case.sql"), "-- new acceptance case\n");
      }
      return happyAgent(fake, ctx)(request);
    };
    const result = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, testAreaAgent) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.status, "awaiting_review");
    assert.equal(result.state.stages.phase4.status, "passed");
  } finally {
    cleanup(root);
  }
});

test("replay mode routes diff and packaging through sz-replay", async () => {
  const root = initRepo();
  try {
    // A real replay tree is a detached checkout of the baseline (sz-replay
    // init always lands detached); the clean-baseline invariant requires it.
    git(root, ["checkout", "--quiet", "--detach"]);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const fake = fakeSzdev({
      ensure: { mode: "replay", workspace: root },
      fixCommit: "fixcommit",
      replay: {
        replayDir: root,
        szDevDir: path.join(root, ".sz-dev"),
        baselineCommit: head,
        fixCommit: "fixcommit",
      },
    });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root, szDevDir: path.join(root, ".sz-dev") };
    const result = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.szdev.mode, "replay");
    assert.equal(result.state.szdev.fixCommit, "fixcommit");
    assert.equal(result.state.szdev.baselineCommit, head);
    assert.equal(result.state.baseCommit, head);
    assert.equal(result.state.artifacts.package, "/tmp/replay-package.tar.gz");
    const prompt1 = fs.readFileSync(path.join(root, ".ai-flow", "runs", "SZ1", "prompts", "phase1.md"), "utf8");
    assert.match(prompt1, /REPLAY MODE/);
    assert.match(prompt1, /fixcommit/);
  } finally {
    cleanup(root);
  }
});

/**
 * Incident-shaped history (SZ34445): R (init) → A0 → B (the genuine SZ1 fix,
 * subject-mention + content) → M (merge-style) → H (a harness commit that
 * mentions SZ1 only in its body). The STALE anchor is H (baseline M, which
 * already contains the fix); the CORRECT anchor is B (baseline A0).
 */
function initReplayHistory(): { root: string; a0: string; fix: string; merge: string; harness: string } {
  const root = initRepo();
  const commitMsg = (message: string): void =>
    git(root, ["-c", "user.email=ai-flow@local", "-c", "user.name=ai-flow", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message]);
  const head = (): string => execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(root, "cql/a.scm"), ";;; a\n");
  git(root, ["add", "."]);
  commitMsg("unrelated baseline work");
  const a0 = head();
  fs.writeFileSync(path.join(root, "cql/b.scm"), ";;; b\n");
  git(root, ["add", "."]);
  commitMsg("SZ1 - RadioView Report CQL crash when MRN not found");
  const fix = head();
  fs.writeFileSync(path.join(root, "cql/m.scm"), ";;; m\n");
  git(root, ["add", "."]);
  commitMsg("Merge branch 'ee-branch-ai' into cql-auto-dev-1.0.0");
  const merge = head();
  fs.mkdirSync(path.join(root, "ai-flow"), { recursive: true });
  fs.writeFileSync(path.join(root, "ai-flow/tweak.ts"), "// tweak\n");
  git(root, ["add", "."]);
  commitMsg("ai-flow: fix test verdict parse, viewer/sz-replay tweaks\n\n(fixes false 'Failed' on SZ1)");
  const harness = head();
  return { root, a0, fix, merge, harness };
}

test("replay: the sanctioned Phase-1 re-baseline is adopted, not failed as overreach (SZ34445-shaped)", async () => {
  const h = initReplayHistory();
  const metaStore: { fix?: string; baseline?: string } = { fix: h.harness, baseline: h.merge };
  try {
    // The run starts anchored on the STALE harness commit (old findFixCommit /
    // registry reuse): detached, tracked-clean at the harness commit's parent.
    git(h.root, ["checkout", "--quiet", "--detach", h.merge]);
    const fake = fakeSzdev({
      ensure: { mode: "replay", workspace: h.root },
      fixCommit: h.harness,
      replay: { replayDir: h.root, szDevDir: path.join(h.root, ".sz-dev"), baselineCommit: h.merge, fixCommit: h.harness },
      metaStore,
    });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: h.root, szDevDir: path.join(h.root, ".sz-dev") };
    const baseAgent = happyAgent(fake, ctx);
    const agent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 1 (requirement)")) {
        // Disambiguation: the supplied anchor is a harness commit. Perform the
        // replay switch (real run: sz-replay init + sz-progress set meta base).
        git(h.root, ["checkout", "--quiet", "--detach", h.a0]);
        fake.snapshot(ctx).base = h.a0;
      }
      return baseAgent(request);
    };
    const result = await runPipeline({ repoRoot: h.root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.status, "awaiting_review");
    // The re-anchored baseline is adopted and every anchor agrees.
    assert.equal(result.state.baseCommit, h.a0);
    assert.equal(result.state.szdev.baselineCommit, h.a0);
    assert.equal(result.state.szdev.fixCommit, h.fix);
    assert.equal(metaStore.baseline, h.a0, "the replay registry is re-anchored too (sz-replay diff/verify/package must run against the real baseline)");
    assert.equal(metaStore.fix, h.fix);
    assert.equal(fake.snapshot(ctx).base, h.a0, "progress.md is re-anchored so sz-verify-tree and later sessions agree");
  } finally {
    cleanup(h.root);
  }
});

test("replay: a stale tool anchor is re-anchored to the true fix at the workspace stage", async () => {
  const h = initReplayHistory();
  const metaStore: { fix?: string; baseline?: string } = { fix: h.harness, baseline: h.merge };
  try {
    git(h.root, ["checkout", "--quiet", "--detach", h.merge]);
    let replayCalls = 0;
    const fake = fakeSzdev({
      ensure: { mode: "replay", workspace: h.root },
      fixCommit: h.fix, // the corrected detection: the genuine fix
      replay: (fixCommit: string) => {
        replayCalls++;
        if (replayCalls === 1) {
          // The registry reuse wins the first call: the stale anchor comes back.
          return { replayDir: h.root, szDevDir: path.join(h.root, ".sz-dev"), baselineCommit: h.merge, fixCommit: h.harness };
        }
        // The cross-check re-runs sz-replay init: checkout <true-fix>^ and rewrite the registry.
        git(h.root, ["checkout", "--quiet", "--detach", h.a0]);
        metaStore.fix = fixCommit;
        metaStore.baseline = h.a0;
        return { replayDir: h.root, szDevDir: path.join(h.root, ".sz-dev"), baselineCommit: h.a0, fixCommit };
      },
      metaStore,
    });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: h.root, szDevDir: path.join(h.root, ".sz-dev") };
    const result = await runPipeline({ repoRoot: h.root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.status, "awaiting_review");
    assert.equal(replayCalls, 2, "the mismatched anchor triggers exactly one re-init");
    assert.equal(result.state.baseCommit, h.a0);
    assert.equal(result.state.szdev.baselineCommit, h.a0);
    assert.equal(result.state.szdev.fixCommit, h.fix);
    assert.equal(metaStore.baseline, h.a0);
    assert.equal(metaStore.fix, h.fix);
  } finally {
    cleanup(h.root);
  }
});

test("replay: a phase-1 commit still fails as overreach (a new commit is never a valid switch)", async () => {
  const h = initReplayHistory();
  try {
    git(h.root, ["checkout", "--quiet", "--detach", h.merge]);
    const fake = fakeSzdev({
      ensure: { mode: "replay", workspace: h.root },
      fixCommit: h.harness,
      replay: { replayDir: h.root, szDevDir: path.join(h.root, ".sz-dev"), baselineCommit: h.merge, fixCommit: h.harness },
    });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: h.root, szDevDir: path.join(h.root, ".sz-dev") };
    const baseAgent = happyAgent(fake, ctx);
    const agent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 1 (requirement)")) {
        // The agent commits (forbidden). Even with a matching progress base,
        // the new commit is not the parent of a genuine SZ1 fix → overreach.
        fs.writeFileSync(path.join(h.root, "cql/cheat.scm"), ";;; cheat\n");
        git(h.root, ["add", "."]);
        git(h.root, ["-c", "user.email=a@b", "-c", "user.name=a", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "agent commit"]);
        fake.snapshot(ctx).base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.root, encoding: "utf8" }).trim();
      }
      return baseAgent(request);
    };
    const result = await runPipeline({ repoRoot: h.root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
    assert.equal(result.exitCode, 2);
    assert.equal(result.state.status, "failed");
    assert.equal(result.state.stages.phase1.status, "failed");
    assert.match(result.state.error ?? "", /without a valid replay switch/);
  } finally {
    cleanup(h.root);
  }
});

test("replay: phase 1 must end on a tracked-clean baseline (no code before gate 2)", async () => {
  const h = initReplayHistory();
  try {
    git(h.root, ["checkout", "--quiet", "--detach", h.merge]);
    const fake = fakeSzdev({
      ensure: { mode: "replay", workspace: h.root },
      fixCommit: h.harness,
      replay: { replayDir: h.root, szDevDir: path.join(h.root, ".sz-dev"), baselineCommit: h.merge, fixCommit: h.harness },
    });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: h.root, szDevDir: path.join(h.root, ".sz-dev") };
    const baseAgent = happyAgent(fake, ctx);
    const agent = async (request: AgentRequest) => {
      const prompt = fs.readFileSync(request.promptFile, "utf8");
      if (prompt.includes("Phase 1 (requirement)")) {
        // The agent gets ahead: a tracked change during the requirement phase.
        fs.appendFileSync(path.join(h.root, "cql/m.scm"), ";;; early change\n");
      }
      return baseAgent(request);
    };
    const result = await runPipeline({ repoRoot: h.root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
    assert.equal(result.exitCode, 2);
    assert.equal(result.state.status, "failed");
    assert.equal(result.state.stages.phase1.status, "failed");
    assert.match(result.state.error ?? "", /not a clean baseline after phase 1/);
  } finally {
    cleanup(h.root);
  }
});

test("replay: the workspace stage restores leftover tracked changes to a clean baseline", async () => {
  const h = initReplayHistory();
  try {
    git(h.root, ["checkout", "--quiet", "--detach", h.merge]);
    // A crashed prior run of the same SZ left a tracked modification behind.
    fs.appendFileSync(path.join(h.root, "cql/m.scm"), ";;; leftover\n");
    const fake = fakeSzdev({
      ensure: { mode: "replay", workspace: h.root },
      fixCommit: h.harness,
      replay: { replayDir: h.root, szDevDir: path.join(h.root, ".sz-dev"), baselineCommit: h.merge, fixCommit: h.harness },
    });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: h.root, szDevDir: path.join(h.root, ".sz-dev") };
    const result = await runPipeline({ repoRoot: h.root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.status, "awaiting_review");
    assert.equal(fs.readFileSync(path.join(h.root, "cql/m.scm"), "utf8"), ";;; m\n", "the leftover is restored byte-for-byte to the baseline");
  } finally {
    cleanup(h.root);
  }
});

// ---------------------------------------------------------------------------
// Runner behavior (unchanged contract)
// ---------------------------------------------------------------------------

test("runner reports a missing command as startup failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-runner-"));
  const prompt = path.join(dir, "prompt.md");
  fs.writeFileSync(prompt, "hello");
  await assert.rejects(
    () =>
      runAgent({
        command: ["ai-flow-missing-bin", "{promptFile}"],
        cwd: dir,
        promptFile: prompt,
        logFile: path.join(dir, "agent.log"),
      }),
    (err: unknown) => err instanceof StageError && err.kind === "startup",
  );
});

test("runner accepts a local process that writes the expected file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-runner-"));
  const prompt = path.join(dir, "prompt.md");
  const output = path.join(dir, "out.md");
  fs.writeFileSync(prompt, "hello");
  const agent = path.join(dir, "agent.mjs");
  fs.writeFileSync(agent, "import fs from 'node:fs'; fs.writeFileSync(process.argv[3], 'done\\n');\n");
  const result = await runAgent({
    command: [process.execPath, agent, "{promptFile}", output],
    cwd: dir,
    promptFile: prompt,
    logFile: path.join(dir, "agent.log"),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(fs.readFileSync(output, "utf8"), "done\n");
});

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

test("ui lists sz-dev state, serves state docs, and handles gate-4 plus escalation reviews", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-"));
  // The package download is restricted to the pipeline's package directory.
  const prevPkgDir = process.env.SZ_PACKAGE_DIR;
  process.env.SZ_PACKAGE_DIR = root;
  const restorePkgDir = (): void => {
    if (prevPkgDir === undefined) delete process.env.SZ_PACKAGE_DIR;
    else process.env.SZ_PACKAGE_DIR = prevPkgDir;
  };
  const packageFile = path.join(root, "SZ3_202609281200.tar.gz");
  fs.writeFileSync(packageFile, "fake-tar");
  const workspace = root;
  const stateDir = path.join(workspace, ".sz-dev", "SZ3");
  fs.mkdirSync(path.join(stateDir, "deliverables"), { recursive: true });
  fs.writeFileSync(path.join(stateDir, "phase1-requirement.md"), "# Requirement\n");
  fs.writeFileSync(path.join(stateDir, "deliverables", "clarification-comments.md"), "Question?\n");
  fs.mkdirSync(path.join(root, ".ai-flow", "runs", "SZ3"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".ai-flow", "runs", "SZ3", "state.json"),
    JSON.stringify({
      id: "SZ3",
      status: "awaiting_review",
      stage: "review",
      startedAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
      baseCommit: "abc",
      worktree: workspace,
      stages: { review: { status: "awaiting_review" } },
      artifacts: { package: packageFile },
      szdev: { mode: "standard", workspace, gates: { 1: "passed", 2: "passed", 3: "passed", 4: "pending" }, phase: 4 },
      awaiting: { kind: "gate4" },
      error: null,
    }),
  );
  const started: string[] = [];
  const server = await startUi(root, "127.0.0.1", 0, {
    startRun: (_repoRoot, id) => {
      started.push(id);
      // Simulate the pipeline having written its initial state file for a fresh run.
      const stateFile = path.join(_repoRoot, ".ai-flow", "runs", id, "state.json");
      if (!fs.existsSync(stateFile)) {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(
          stateFile,
          JSON.stringify({
            id,
            status: "running",
            stage: "fetch",
            startedAt: "2026-09-23T00:00:00.000Z",
            updatedAt: "2026-09-23T00:00:00.000Z",
            baseCommit: "abc",
            worktree: root,
            stages: { fetch: { status: "running" } },
            artifacts: {},
            error: null,
          }),
        );
      }
    },
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const listed = await fetch(`http://127.0.0.1:${port}/api/runs`);
    const body = (await listed.json()) as { runs: Array<{ id: string; mode: string | null; gates: Record<string, string> | null }> };
    assert.equal(body.runs[0]?.id, "SZ3");
    assert.equal(body.runs[0]?.mode, "standard");
    assert.equal(body.runs[0]?.gates?.[1], "passed");

    const detail = await fetch(`http://127.0.0.1:${port}/api/runs/SZ3`);
    const page = (await detail.json()) as { docs: { requirement: { ready: boolean }; clarifications: { ready: boolean } } };
    assert.equal(page.docs.requirement.ready, true);
    assert.equal(page.docs.clarifications.ready, true);

    const approved = await fetch(`http://127.0.0.1:${port}/api/runs/SZ3/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    assert.equal(approved.status, 200);
    const approvedState = JSON.parse(fs.readFileSync(path.join(root, ".ai-flow", "runs", "SZ3", "state.json"), "utf8")) as { status: string };
    assert.equal(approvedState.status, "approved");

    // An escalation answer resumes the phase with the answer injected.
    const escalationDir = path.join(root, ".ai-flow", "runs", "SZ5");
    fs.mkdirSync(escalationDir, { recursive: true });
    fs.writeFileSync(
      path.join(escalationDir, "state.json"),
      JSON.stringify({
        id: "SZ5",
        status: "awaiting_review",
        stage: "phase1",
        startedAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
        baseCommit: "abc",
        worktree: workspace,
        stages: { phase1: { status: "awaiting_review" } },
        artifacts: {},
        szdev: { mode: "standard", workspace, gates: {} },
        awaiting: { kind: "clarification", code: "E1" },
        error: null,
      }),
    );
    const answered = await fetch(`http://127.0.0.1:${port}/api/runs/SZ5/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", comment: "Use the shared pool" }),
    });
    assert.equal(answered.status, 202);
    assert.deepEqual(await answered.json(), { id: "SZ5", resumedFrom: "phase1" });
    assert.equal(started.at(-1), "SZ5");
    const escalationState = JSON.parse(fs.readFileSync(path.join(escalationDir, "state.json"), "utf8")) as {
      rework: { stage: string; comment: string };
    };
    assert.equal(escalationState.rework.stage, "phase1");
    assert.equal(escalationState.rework.comment, "Use the shared pool");

    // Gate-4 rejection rewinds to a phase.
    const rejectDir = path.join(root, ".ai-flow", "runs", "SZ7");
    fs.mkdirSync(rejectDir, { recursive: true });
    fs.writeFileSync(
      path.join(rejectDir, "state.json"),
      JSON.stringify({
        id: "SZ7",
        status: "awaiting_review",
        stage: "review",
        startedAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
        baseCommit: "abc",
        worktree: workspace,
        stages: { review: { status: "awaiting_review" } },
        artifacts: {},
        szdev: { mode: "standard", workspace, gates: {} },
        awaiting: { kind: "gate4" },
        error: null,
      }),
    );
    const badStage = await fetch(`http://127.0.0.1:${port}/api/runs/SZ7/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "reject", stage: "implement", comment: "x" }),
    });
    assert.equal(badStage.status, 400);
    const rejected = await fetch(`http://127.0.0.1:${port}/api/runs/SZ7/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "reject", stage: "phase2", comment: "Wrong approach" }),
    });
    assert.equal(rejected.status, 202);
    assert.deepEqual(await rejected.json(), { id: "SZ7", resumedFrom: "phase2" });
    assert.equal(started.at(-1), "SZ7");

    const downloaded = await fetch(`http://127.0.0.1:${port}/api/runs/SZ3/package`);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("content-type"), "application/gzip");
    assert.match(downloaded.headers.get("content-disposition") ?? "", /SZ3_202609281200\.tar\.gz/);

    // A failed run can be deleted (record, sz-dev state, replay tree).
    fs.mkdirSync(path.join(root, ".ai-flow", "runs", "SZ9"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".ai-flow", "runs", "SZ9", "state.json"),
      JSON.stringify({
        id: "SZ9",
        status: "failed",
        stage: "phase3",
        startedAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
        baseCommit: "abc",
        worktree: workspace,
        stages: { phase3: { status: "failed" } },
        artifacts: {},
        szdev: { mode: "standard", workspace, gates: {} },
        error: "boom",
      }),
    );
    const removed = await fetch(`http://127.0.0.1:${port}/api/runs/SZ9`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { id: "SZ9", deleted: true });
    assert.equal(fs.existsSync(path.join(root, ".ai-flow", "runs", "SZ9")), false);
    const afterDelete = (await (await fetch(`http://127.0.0.1:${port}/api/runs`)).json()) as { runs: Array<{ id: string }> };
    assert.equal(afterDelete.runs.some((run) => run.id === "SZ9"), false);

    const missingDelete = await fetch(`http://127.0.0.1:${port}/api/runs/SZ1`, { method: "DELETE" });
    assert.equal(missingDelete.status, 404);

    const denied = await fetch(`http://127.0.0.1:${port}/api/runs`, { method: "PUT" });
    assert.equal(denied.status, 405);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    restorePkgDir();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ui token auth: 401 without, 200 with Bearer or ?token=, static included", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-token-"));
  try {
    fs.writeFileSync(
      path.join(root, "ai-flow.config.json"),
      JSON.stringify({ runner: { command: ["fake-agent", "{promptFile}"] }, ui: { token: "s3cret-token" } }),
    );
    const server = await startUi(root, "127.0.0.1", 0, { startRun: () => undefined });
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    try {
      const noToken = await fetch(`http://127.0.0.1:${port}/api/runs`);
      assert.equal(noToken.status, 401);
      const wrongToken = await fetch(`http://127.0.0.1:${port}/api/runs`, { headers: { authorization: "Bearer wrong" } });
      assert.equal(wrongToken.status, 401);
      const bearer = await fetch(`http://127.0.0.1:${port}/api/runs`, { headers: { authorization: "Bearer s3cret-token" } });
      assert.equal(bearer.status, 200);
      const query = await fetch(`http://127.0.0.1:${port}/api/runs?token=s3cret-token`);
      assert.equal(query.status, 200);
      // Static assets are behind the same check.
      const page = await fetch(`http://127.0.0.1:${port}/`);
      assert.notEqual(page.status, 200);
      assert.equal(page.status, 401);
      const pageWithToken = await fetch(`http://127.0.0.1:${port}/?token=s3cret-token`);
      assert.notEqual(pageWithToken.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ui rejects cross-origin mutating requests and rate-limits bursts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-guard-"));
  try {
    // A low ceiling so the burst is short: 12 requests/minute.
    fs.writeFileSync(
      path.join(root, "ai-flow.config.json"),
      JSON.stringify({ runner: { command: ["fake-agent", "{promptFile}"] }, ui: { rateLimitPerMinute: 12 } }),
    );
    const server = await startUi(root, "127.0.0.1", 0, { startRun: () => undefined });
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    try {
      // CSRF: a cross-origin DELETE is refused before the route runs...
      const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/runs/SZ1`, {
        method: "DELETE",
        headers: { origin: "http://evil.example" },
      });
      assert.equal(crossOrigin.status, 403);
      // ...a same-origin DELETE reaches the route (404: no such run)...
      const sameOrigin = await fetch(`http://127.0.0.1:${port}/api/runs/SZ1`, {
        method: "DELETE",
        headers: { origin: `http://127.0.0.1:${port}` },
      });
      assert.equal(sameOrigin.status, 404);
      // ...and so does an origin-less (curl-style) one.
      const noOrigin = await fetch(`http://127.0.0.1:${port}/api/runs/SZ1`, { method: "DELETE" });
      assert.equal(noOrigin.status, 404);
      // Rate limit: GETs up to the ceiling pass, the next one is 429.
      let limited: number | null = null;
      for (let i = 0; i < 14; i += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/api/runs`);
        if (response.status === 429) {
          limited = i;
          break;
        }
        assert.equal(response.status, 200, `request ${i} should pass the limit`);
      }
      assert.notEqual(limited, null, "the burst must eventually be limited");
      assert.ok((limited ?? 0) <= 12, "the ceiling is 12 requests/minute");
      const body = (await fetch(`http://127.0.0.1:${port}/api/runs`)).status;
      assert.equal(body, 429, "the client stays limited inside the window");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ui rejects oversized request bodies with 413 and keeps the process up", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-413-"));
  const server = await startUi(root, "127.0.0.1", 0, { startRun: () => undefined });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    // Beyond the 1MB body cap: a 413, not an OOM or a 400.
    const big = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "SZ1", pad: "x".repeat(2 * 1024 * 1024) }),
    });
    assert.equal(big.status, 413);
    // The viewer process survived the oversized body.
    const alive = await fetch(`http://127.0.0.1:${port}/api/runs`);
    assert.equal(alive.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ui package download refuses paths outside the package directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-pkg-"));
  const prevPkgDir = process.env.SZ_PACKAGE_DIR;
  process.env.SZ_PACKAGE_DIR = path.join(root, "packages");
  const restorePkgDir = (): void => {
    if (prevPkgDir === undefined) delete process.env.SZ_PACKAGE_DIR;
    else process.env.SZ_PACKAGE_DIR = prevPkgDir;
  };
  const elsewhere = path.join(root, "elsewhere", "SZ8_202609281200.tar.gz");
  fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
  fs.writeFileSync(elsewhere, "sensitive");
  fs.mkdirSync(path.join(root, ".ai-flow", "runs", "SZ8"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".ai-flow", "runs", "SZ8", "state.json"),
    JSON.stringify({
      id: "SZ8",
      status: "awaiting_review",
      stage: "review",
      startedAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
      baseCommit: "abc",
      worktree: root,
      stages: { review: { status: "awaiting_review" } },
      artifacts: { package: elsewhere },
      error: null,
    }),
  );
  const server = await startUi(root, "127.0.0.1", 0, { startRun: () => undefined });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    // state.artifacts.package pointing outside the package dir: 404, no leak.
    const denied = await fetch(`http://127.0.0.1:${port}/api/runs/SZ8/package`);
    assert.equal(denied.status, 404);
    // A tarball properly placed in the package dir is served.
    const good = path.join(root, "packages", "SZ8_202609281200.tar.gz");
    fs.mkdirSync(path.dirname(good), { recursive: true });
    fs.writeFileSync(good, "fake-tar");
    const stateFile = path.join(root, ".ai-flow", "runs", "SZ8", "state.json");
    const st = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { artifacts: { package?: string } };
    st.artifacts.package = good;
    fs.writeFileSync(stateFile, JSON.stringify(st));
    const ok = await fetch(`http://127.0.0.1:${port}/api/runs/SZ8/package`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "fake-tar");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    restorePkgDir();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
test("ui reports an immediate startup failure instead of a fake success", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-fail-"));
  const server = await startUi(root, "127.0.0.1", 0, {
    startRun: (_repoRoot, id) => {
      // Simulate a runner that fails preflight before writing a state file.
      const logDir = path.join(_repoRoot, ".ai-flow", "logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(
        path.join(logDir, `start-${id}.log`),
        "Runner preflight failed: configured agent command 'fake-agent' was not found.\n",
      );
    },
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "SZ34445" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; started: boolean; error?: string };
    assert.equal(body.id, "SZ34445");
    assert.equal(body.started, false);
    assert.match(body.error ?? "", /fake-agent/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ui createRun fast-fails when the pipeline pid is already dead", async () => {
  // Regression: createRun used to wait the full 5s window even when the
  // spawned pipeline had already exited, making immediate startup failures
  // look like a hang. The viewer now records the child pid in
  // start-<id>.pgid; a dead pid short-circuits the wait and the start log
  // error is surfaced at once.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-deadpid-"));
  // A real, verifiably dead pid: spawn `true` and wait for its exit.
  const deadPid: number = await new Promise((resolve, reject) => {
    const child = spawn("true", { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", () => {
      if (child.pid === undefined) reject(new Error("no pid"));
      else resolve(child.pid);
    });
  });
  const server = await startUi(root, "127.0.0.1", 0, {
    startRun: (_repoRoot, id) => {
      const logDir = path.join(_repoRoot, ".ai-flow", "logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, `start-${id}.log`), "Error: Cannot find module '/repo/ai-flow/dist/cli.js'\n");
      fs.writeFileSync(path.join(logDir, `start-${id}.pgid`), String(deadPid));
    },
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const startedAt = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "SZ34446" }),
    });
    const elapsed = Date.now() - startedAt;
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; started: boolean; error?: string };
    assert.equal(body.id, "SZ34446");
    assert.equal(body.started, false);
    assert.match(body.error ?? "", /Cannot find module/);
    // The default window is 5s; a dead pid must answer in a fraction of it.
    assert.ok(elapsed < 4000, `dead pid must short-circuit the wait (took ${elapsed}ms)`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("reset removes the run record, workspace, replay tree, wrapper and registry", async () => {
  const root = initRepo();
  const registry = path.join(root, "registry");
  process.env.SZ_WORKSPACE_REGISTRY = registry;
  fs.mkdirSync(registry, { recursive: true });
  // sz-replay init seeds <project>_aireplay/ccsrc and sz-workspace registers
  // the workspace clone — both are created trees a full delete removes.
  const workspace = path.join(root, "guoyq_sz1_ai", "ccsrc");
  const replayDir = path.join(root, "guoyq_sz1_aireplay", "ccsrc");
  const replayWrapper = path.join(root, "guoyq_sz1_aireplay");
  fs.mkdirSync(path.join(workspace, ".sz-dev", "SZ1"), { recursive: true });
  fs.mkdirSync(replayDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".ai-flow", "runs", "SZ1"), { recursive: true });
  fs.writeFileSync(path.join(root, ".ai-flow", "runs", "SZ1", "state.json"), "{}");
  fs.writeFileSync(path.join(workspace, ".sz-dev", "SZ1", "progress.md"), "phase: 4\n");
  fs.writeFileSync(path.join(registry, "SZ1"), `${workspace}\n`);
  fs.writeFileSync(path.join(registry, "SZ1.mode"), "replay\n");
  fs.writeFileSync(path.join(registry, "replay-SZ1.path"), `${replayDir}\n`);
  fs.writeFileSync(path.join(registry, "replay-SZ1.meta"), "fix=abc\n");
  try {
    await resetRun({ repoRoot: root, id: "SZ1", log: () => undefined });
    assert.equal(fs.existsSync(path.join(root, ".ai-flow", "runs", "SZ1")), false);
    assert.equal(fs.existsSync(replayDir), false);
    assert.equal(fs.existsSync(replayWrapper), false);
    assert.equal(fs.existsSync(path.join(registry, "replay-SZ1.path")), false);
    assert.equal(fs.existsSync(path.join(registry, "replay-SZ1.meta")), false);
    // A full delete takes the created workspace and every registry entry with
    // it, so the next run starts from scratch.
    assert.equal(fs.existsSync(workspace), false);
    assert.equal(fs.existsSync(path.join(registry, "SZ1")), false);
    assert.equal(fs.existsSync(path.join(registry, "SZ1.mode")), false);
  } finally {
    delete process.env.SZ_WORKSPACE_REGISTRY;
    cleanup(root);
  }
  assert.equal(registryDir().endsWith("registry"), false);
});

test("a stale pre-migration run record starts fresh instead of erroring", async () => {
  const root = initRepo();
  try {
    const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
    fs.mkdirSync(runDir, { recursive: true });
    // Old-pipeline record: stage names that no longer exist, no szdev mirror.
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify({
        id: "SZ1",
        status: "failed",
        stage: "analyze",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        baseCommit: "abc",
        worktree: root,
        stages: { analyze: { status: "failed" } },
        artifacts: {},
        error: "old pipeline failure",
      }),
    );
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const result = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.state.status, "awaiting_review");
    assert.equal(result.state.szdev.mode, "standard");
    assert.equal(result.state.stages.workspace.status, "passed");
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Corrupted state.json resilience (one bad record must not crash anything)
// ---------------------------------------------------------------------------

test("viewer answers a corrupted state.json with JSON errors, not a crash", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-corrupt-"));
  const registry = path.join(root, "registry");
  process.env.SZ_WORKSPACE_REGISTRY = registry;
  const runDir = path.join(root, ".ai-flow", "runs", "SZ2");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "state.json"), "{ this is not valid json");
  const server = await startUi(root, "127.0.0.1", 0, {
    startRun: () => {
      throw new Error("a corrupted run must never be (re)started");
    },
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    // Every state-reading endpoint degrades to a JSON error...
    const detail = await fetch(`http://127.0.0.1:${port}/api/runs/SZ2`);
    assert.equal(detail.status, 500);
    assert.match(((await detail.json()) as { error: string }).error, /corrupted/);

    const created = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "SZ2" }),
    });
    assert.equal(created.status, 409);

    const reviewed = await fetch(`http://127.0.0.1:${port}/api/runs/SZ2/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    assert.equal(reviewed.status, 500);

    const stopped = await fetch(`http://127.0.0.1:${port}/api/runs/SZ2/stop`, { method: "POST" });
    assert.equal(stopped.status, 500);

    const packaged = await fetch(`http://127.0.0.1:${port}/api/runs/SZ2/package`);
    assert.equal(packaged.status, 500);

    // ...and the server is still alive for other runs.
    const list = await fetch(`http://127.0.0.1:${port}/api/runs`);
    assert.equal(list.status, 200);

    // Delete is the way out of a corrupted record (resetRun only needs the id).
    const removed = await fetch(`http://127.0.0.1:${port}/api/runs/SZ2`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const removedBody = (await removed.json()) as { deleted: boolean };
    assert.equal(removedBody.deleted, true);
    assert.equal(fs.existsSync(path.join(runDir, "state.json")), false);
  } finally {
    delete process.env.SZ_WORKSPACE_REGISTRY;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPipeline rejects a corrupted state file with a clear startup error", async () => {
  const root = initRepo();
  try {
    const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "state.json"), "{ broken");
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    await assert.rejects(
      () => runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) }),
      (err: unknown) =>
        err instanceof StageError && err.kind === "startup" && /corrupted/i.test(err.message) && /reset/.test(err.message),
    );
  } finally {
    cleanup(root);
  }
});

test("writeState is atomic: no temp file left, corrupted file reads as null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-atomic-"));
  try {
    const state = {
      id: "SZ1",
      status: "running" as const,
      stage: "workspace" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      baseCommit: "abc",
      worktree: root,
      stages: {} as never,
      artifacts: {},
      szdev: { mode: "standard" as const, workspace: root, gates: {} },
      error: null,
    };
    writeState(root, state);
    // No leftover temp file after a successful write. The temp name is
    // unique per process+moment (state.json.tmp-<pid>-<epoch>) so the check
    // must glob the prefix, not one fixed name.
    assert.ok(!fs.readdirSync(root).some((name) => name.startsWith("state.json.tmp")), "no temp file left");
    assert.equal(readState(root).id, "SZ1");
    assert.equal(readStateOrNull(root)?.id, "SZ1");
    // A corrupted file is reported as null, not as an exception.
    fs.writeFileSync(path.join(root, "state.json"), "{ torn");
    assert.equal(readStateOrNull(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Stop: the agent is killed by recorded pid, never by an unanchored pattern
// ---------------------------------------------------------------------------

test("stopPipeline kills the live agent from agent.pid and ignores stale pids", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-stop-"));
  const runDir = path.join(dir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  try {
    const config: AiFlowConfig = { runner: { command: [process.execPath] } };
    // Live agent: the pid file points at a real, matching process.
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore" });
    const pid = child.pid;
    assert.ok(pid);
    // Reap the child so that once it dies its pid actually disappears — an
    // unreaped zombie would still answer process.kill(pid, 0).
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    fs.writeFileSync(path.join(runDir, "agent.pid"), String(pid));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const outcome = await stopPipeline(runDir, config, "SZ1");
    assert.equal(outcome.agent.killed, true);
    assert.equal(outcome.agent.pid, pid);
    await exited;
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "the recorded agent must be dead");

    // Stale pid file (process gone): reported, not an error, nothing killed.
    fs.writeFileSync(path.join(runDir, "agent.pid"), "999999999");
    const stale = await stopPipeline(runDir, config, "SZ1");
    assert.equal(stale.agent.stale, true);
    assert.equal(stale.agent.killed, false);

    // No pid file: missing, nothing to kill.
    fs.rmSync(path.join(runDir, "agent.pid"), { force: true });
    const missing = await stopPipeline(runDir, config, "SZ1");
    assert.equal(missing.agent.missing, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("full-log includes the repo-level start-<id>.log", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-fulllog-"));
  const runDir = path.join(root, ".ai-flow", "runs", "SZ4");
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "logs", "phase1.log"), "phase one output\n");
  fs.mkdirSync(path.join(root, ".ai-flow", "logs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".ai-flow", "logs", "start-SZ4.log"), "startup failure: fake-agent not found\n");
  const server = await startUi(root, "127.0.0.1", 0, { startRun: () => undefined });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/SZ4/full-log`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /===== phase1 =====/);
    assert.match(text, /phase one output/);
    assert.match(text, /===== start-SZ4 =====/);
    assert.match(text, /fake-agent not found/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Regression tests added by the 2026-10-07 hardening pass
// ---------------------------------------------------------------------------

test("runPipeline reports a startup failure (exit code 1) when the config is missing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-noconfig-"));
  try {
    // No ai-flow.config.json anywhere under this root: loadConfig throws a
    // startup StageError, which the CLI maps to exit code 1 (never a stage-2).
    await assert.rejects(
      () => runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined }),
      (err: unknown) => err instanceof StageError && err.kind === "startup",
    );
  } finally {
    cleanup(root);
  }
});

test("escalations E1-E7 pause the run with the right awaiting kind and resume on the answer", async () => {
  for (const code of ["E1", "E2", "E3", "E4", "E5", "E6", "E7"]) {
    const root = initRepo();
    try {
      const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
      const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
      // The escalation is raised exactly once (on the first phase-1 pass);
      // the resumed pass must run clean and complete through to gate 4.
      let escalated = false;
      const agent = async (request: AgentRequest) => {
        const prompt = fs.readFileSync(request.promptFile, "utf8");
        if (prompt.includes("Phase 1 (requirement)")) {
          writeStateFiles(request.cwd, {
            "phase1-requirement.md": "# Requirement\n\nrepro: n/a\n\nmodule pack: cql\n",
            "attachment/ticket-body.md": "# SZ1 body\n",
            "attachment/ticket-comments.md": "# comments\n",
            "deliverables/clarification-comments.md": "No blocking questions.\n",
          });
          if (!escalated) {
            escalated = true;
            fake.snapshot(ctx).awaiting = code;
          }
        } else {
          await happyAgent(fake, ctx)(request);
        }
        return { exitCode: 0, commandName: "fake-agent" };
      };
      const first = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
      assert.equal(first.exitCode, 0);
      assert.equal(first.state.status, "awaiting_review");
      assert.equal(first.state.stage, "phase1");
      const expectedKind = code === "E1" ? "clarification" : "escalation";
      assert.deepEqual(first.state.awaiting, { kind: expectedKind, code });

      // The human answers: the run resumes the same phase with the answer injected.
      const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
      const stored = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as { rework?: unknown };
      stored.rework = { stage: "phase1", comment: `answer for ${code}`, at: "2026-09-28T00:00:00.000Z" };
      fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(stored));
      const second = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
      assert.equal(second.exitCode, 0);
      assert.equal(second.state.status, "awaiting_review");
      assert.equal(second.state.awaiting?.kind, "gate4");
      assert.match(fs.readFileSync(path.join(runDir, "prompts", "phase1.md"), "utf8"), new RegExp(`answer for ${code}`));
    } finally {
      cleanup(root);
    }
  }
});

test("the delivery tarball contains the changed code and no runtime state", async () => {
  const root = initRepo();
  const pkgDir = path.join(root, "packages");
  const prevPkgDir = process.env.SZ_PACKAGE_DIR;
  process.env.SZ_PACKAGE_DIR = pkgDir;
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const result = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(result.exitCode, 0);
    const tarPath = result.state.artifacts.package ?? "";
    assert.ok(tarPath && fs.existsSync(tarPath), "the package tarball exists");
    const listing = execFileSync("tar", ["tzf", tarPath], { encoding: "utf8" });
    const entries = listing.split("\n").filter(Boolean).map((line) => line.replace(/^\.\//, ""));
    assert.ok(entries.includes("cql/lisp/added.scm"), "the changed product file is packed");
    for (const entry of entries) {
      assert.ok(entry !== ".sz-dev" && !entry.startsWith(".sz-dev/"), "sz-dev state must never be packaged");
      assert.ok(entry !== ".ai-flow" && !entry.startsWith(".ai-flow/"), "pipeline runtime must never be packaged");
      assert.ok(entry !== "skills" && !entry.startsWith("skills/"), "seeded skills must never be packaged");
    }
  } finally {
    if (prevPkgDir === undefined) delete process.env.SZ_PACKAGE_DIR;
    else process.env.SZ_PACKAGE_DIR = prevPkgDir;
    cleanup(root);
  }
});

test("a stage failure carrying a secret is redacted before it lands in state.json", async () => {
  const root = initRepo();
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const agent = async (_request: AgentRequest): Promise<{ exitCode: number; commandName: string }> => {
      throw new StageError("fetch failed: Bugzilla_logincookie=SECRET_COOKIE_VALUE_12345", "finished", 1, "fake-agent");
    };
    // A stage failure does not reject: runPipeline records it and returns
    // exit code 2 (exit 1 is reserved for never-started processes).
    const result = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, agent) });
    assert.equal(result.exitCode, 2);
    assert.equal(result.state.status, "failed");
    const stored = fs.readFileSync(path.join(root, ".ai-flow", "runs", "SZ1", "state.json"), "utf8");
    assert.ok(!stored.includes("SECRET_COOKIE_VALUE_12345"), "the cookie value must not reach the run record");
    assert.match(stored, /<redacted>/);
  } finally {
    cleanup(root);
  }
});

test("stopPipeline kills the ticket-anchored CLI process and spares other tickets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-stop-"));
  const runDir = path.join(dir, ".ai-flow", "runs", "SZ77777");
  fs.mkdirSync(runDir, { recursive: true });
  const marker = (ticket: string) => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "cli.js", "run", ticket], { stdio: "ignore" });
  const target = marker("SZ77777");
  const other = marker("SZ88888");
  // Prefix-related ticket: "cli.js run SZ77777" is a substring of
  // "cli.js run SZ777779", so without the pattern's trailing boundary the
  // anchored pkill would kill this pipeline too.
  const prefix = marker("SZ777779");
  const alive = (pid: number | undefined): boolean => {
    if (pid === undefined) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitForExit = (pid: number | undefined, ms: number): Promise<void> =>
    new Promise((resolve) => {
      const started = Date.now();
      const tick = (): void => {
        if (!alive(pid) || Date.now() - started > ms) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    assert.ok(alive(target.pid), "the target CLI process started");
    assert.ok(alive(other.pid), "the other ticket's CLI process started");
    assert.ok(alive(prefix.pid), "the prefix-related ticket's CLI process started");
    const outcome = await stopPipeline(runDir, { runner: { command: [] } } as AiFlowConfig, "SZ77777");
    assert.equal(outcome.agent.missing, true);
    await waitForExit(target.pid, 8000);
    assert.equal(alive(target.pid), false, "the ticket-anchored process was killed");
    assert.equal(alive(other.pid), true, "the other ticket's process is spared");
    assert.equal(alive(prefix.pid), true, "the prefix-related ticket's process is spared (trailing boundary)");
  } finally {
    if (target.pid !== undefined && alive(target.pid)) process.kill(target.pid, "SIGKILL");
    if (other.pid !== undefined && alive(other.pid)) process.kill(other.pid, "SIGKILL");
    if (prefix.pid !== undefined && alive(prefix.pid)) process.kill(prefix.pid, "SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resetRun kills the ticket-anchored CLI process via its fallback pattern when the config is missing", async () => {
  // Regression: the fallback (no-config) pkill used the PCRE non-capturing
  // form `cli\.(?:js|ts)` — invalid POSIX ERE, so pkill's regcomp failed
  // (exit 2) and silently killed NOTHING, letting the orphan pipeline
  // survive the record deletion.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-reset-fallback-"));
  const registry = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-reset-registry-"));
  const prevRegistry = process.env.SZ_WORKSPACE_REGISTRY;
  process.env.SZ_WORKSPACE_REGISTRY = registry;
  const marker = (ticket: string) => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "cli.js", "run", ticket], { stdio: "ignore" });
  const target = marker("SZ555");
  const prefix = marker("SZ5551");
  const alive = (pid: number | undefined): boolean => {
    if (pid === undefined) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitForExit = (pid: number | undefined, ms: number): Promise<void> =>
    new Promise((resolve) => {
      const started = Date.now();
      const tick = (): void => {
        if (!alive(pid) || Date.now() - started > ms) return resolve();
        setTimeout(tick, 100);
      };
      tick();
    });
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    assert.ok(alive(target.pid), "the target CLI process started");
    assert.ok(alive(prefix.pid), "the prefix-related ticket's CLI process started");
    // No ai-flow.config.json in the repo root: loadConfig throws, so reset
    // takes its fallback pattern path.
    await resetRun({ repoRoot: root, id: "SZ555", log: () => undefined });
    await waitForExit(target.pid, 8000);
    assert.equal(alive(target.pid), false, "the fallback pattern killed the ticket-anchored process");
    assert.equal(alive(prefix.pid), true, "the prefix-related ticket's process is spared");
  } finally {
    if (target.pid !== undefined && alive(target.pid)) process.kill(target.pid, "SIGKILL");
    if (prefix.pid !== undefined && alive(prefix.pid)) process.kill(prefix.pid, "SIGKILL");
    if (prevRegistry === undefined) delete process.env.SZ_WORKSPACE_REGISTRY;
    else process.env.SZ_WORKSPACE_REGISTRY = prevRegistry;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(registry, { recursive: true, force: true });
  }
});

test("ui /api/mcp lists, upserts, toggles and removes MCP servers", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-mcp-ui-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-mcp-home-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  fs.writeFileSync(path.join(root, "ai-flow.config.json"), JSON.stringify({ agent: "cursor", model: "", runner: { command: ["fake-agent", "{promptFile}"] } }));
  const server = await startUi(root, "127.0.0.1", 0, { startRun: () => undefined });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    const base = `http://127.0.0.1:${port}/api/mcp`;
    const listed = (await (await fetch(base)).json()) as {
      agent: string | null;
      supported: boolean;
      scopes: Array<{ scope: string; path: string; servers: Array<{ name: string }> }>;
    };
    assert.equal(listed.agent, "cursor");
    assert.equal(listed.supported, true);
    const userScope = listed.scopes.find((scope) => scope.scope === "user");
    assert.ok(userScope, "the user scope is listed");
    assert.equal(userScope.path, path.join(home, ".cursor", "mcp.json"));
    const configFile = path.join(home, ".cursor", "mcp.json");

    // Upsert a stdio server.
    const upsert = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "user", name: "softzilla", spec: { type: "stdio", command: "npx", args: ["-y", "softzilla-mcp"] } }),
    });
    assert.equal(upsert.status, 200);
    const file1 = JSON.parse(fs.readFileSync(configFile, "utf8")) as { mcpServers: Record<string, { command?: string; args?: string[] }> };
    assert.equal(file1.mcpServers.softzilla.command, "npx");

    // Toggle it off (native `disabled` flag round-trips).
    const toggle = await fetch(`${base}/softzilla?scope=user`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(toggle.status, 200);
    const file2 = JSON.parse(fs.readFileSync(configFile, "utf8")) as { mcpServers: Record<string, { disabled?: boolean }> };
    assert.equal(file2.mcpServers.softzilla.disabled, true);

    // Remove it.
    const removed = await fetch(`${base}/softzilla?scope=user`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const file3 = JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
    assert.equal((file3.mcpServers as Record<string, unknown>).softzilla, undefined);

    // An invalid server name is rejected with 400.
    const bad = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "user", name: "bad name!", spec: { type: "stdio", command: "echo" } }),
    });
    assert.equal(bad.status, 400);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("filterPatchToProductSurface byte-matches the product-surface snapshot on real git output", () => {
  const root = initRepo();
  try {
    // A tracked test-area file in the base commit, so the tree diff (not just
    // the untracked --no-index additions) carries test-area sections.
    fs.mkdirSync(path.join(root, "cql/test"), { recursive: true });
    fs.writeFileSync(path.join(root, "cql/test", "old_test.scm"), ";;; base test\n");
    git(root, ["add", "."]);
    commit(root);
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    // Tracked product + tracked test change, untracked product + test files.
    fs.writeFileSync(path.join(root, "cql/lisp", "init.scm"), ";;; FILE: init.scm\n;;; edited\n");
    fs.writeFileSync(path.join(root, "cql/lisp", "new.scm"), ";;; FILE: new.scm\n");
    fs.writeFileSync(path.join(root, "cql/test", "old_test.scm"), ";;; base test\n;;; edited\n");
    fs.writeFileSync(path.join(root, "cql/test", "new_test.scm"), ";;; new test\n");

    const full = patchText(root, base);
    const product = patchText(root, base, {
      diffExclude: [":(exclude)cql/test"],
      pathExclude: (file) => file.startsWith("cql/test/"),
    });
    assert.ok(full.includes("cql/test/old_test.scm") && full.includes("cql/test/new_test.scm"), "the full patch carries the test area");
    assert.ok(!product.includes("cql/test/old_test.scm") && !product.includes("cql/test/new_test.scm"), "the snapshot excludes the test area");
    // The legacy-compat guarantee: narrowing the FULL-tree patch an older
    // ai-flow version would have written must reproduce the product snapshot
    // byte-for-byte (tree sections adjacent, untracked additions joined).
    assert.equal(filterPatchToProductSurface(full, ["cql/test/"]), product);
    // No exclusions → the patch is returned unchanged.
    assert.equal(filterPatchToProductSurface(full, []), full);
  } finally {
    cleanup(root);
  }
});

test("a legacy full-tree gate2-reviewed.patch passes the phase-4 compare after test-area evolution", async () => {
  const root = initRepo();
  const pkgDir = path.join(root, "packages");
  const prevPkgDir = process.env.SZ_PACKAGE_DIR;
  process.env.SZ_PACKAGE_DIR = pkgDir;
  try {
    const fake = fakeSzdev({ ensure: { mode: "standard", workspace: root } });
    const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ1", workspace: root };
    const first = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(first.exitCode, 0);
    assert.equal(first.state.awaiting?.kind, "gate4");

    // Simulate an upgrade: the trusted patch was written by an older version
    // (FULL tree, no surface marker in state), and the run is reworked into
    // phase 4.
    const runDir = path.join(root, ".ai-flow", "runs", "SZ1");
    fs.writeFileSync(path.join(runDir, "gate2-reviewed.patch"), patchText(root, first.state.baseCommit), "utf8");
    const stateFile = path.join(runDir, "state.json");
    const stored = JSON.parse(fs.readFileSync(stateFile, "utf8")) as { szdev: { gate2Surface?: string }; rework?: unknown };
    delete stored.szdev.gate2Surface;
    stored.rework = { stage: "phase4", comment: "legacy compat check", at: "2026-09-28T00:00:00.000Z" };
    fs.writeFileSync(stateFile, JSON.stringify(stored));

    // Phase-3-style test-area evolution: allowed, and excluded from both the
    // legacy patch's narrowed product sections and the current snapshot.
    fs.mkdirSync(path.join(root, "cql/test"), { recursive: true });
    fs.writeFileSync(path.join(root, "cql/test", "phase3-extra.scm"), ";;; phase 3 test\n");

    const second = await runPipeline({ repoRoot: root, id: "SZ1", log: () => undefined, config, deps: depsWith(fake, happyAgent(fake, ctx)) });
    assert.equal(second.exitCode, 0, "an upgraded run with a legacy full-tree patch must not false-fail");
    assert.equal(second.state.awaiting?.kind, "gate4");
  } finally {
    if (prevPkgDir === undefined) delete process.env.SZ_PACKAGE_DIR;
    else process.env.SZ_PACKAGE_DIR = prevPkgDir;
    cleanup(root);
  }
});

test("ui /api/runs/:id/message resumes a failed phase with the answer injected", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-msg-ui-"));
  const writeRun = (id: string, status: string, stage: string): void => {
    const runDir = path.join(root, ".ai-flow", "runs", id);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify({
        id,
        status,
        stage,
        startedAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
        baseCommit: "abc",
        worktree: root,
        stages: { [stage]: { status } },
        artifacts: {},
        szdev: { mode: "standard", workspace: root, gates: { 1: "pending", 2: "pending", 3: "pending", 4: "pending" }, phase: Number(stage.replace("phase", "")) },
        error: status === "failed" ? "agent exited 1" : null,
      }),
    );
  };
  writeRun("SZ6", "failed", "phase2");
  writeRun("SZ7", "awaiting_review", "review");
  const started: string[] = [];
  const server = await startUi(root, "127.0.0.1", 0, {
    startRun: (_repoRoot, id) => {
      started.push(id);
    },
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  try {
    // A failed run with a message: rework recorded, review kind "message", respawn.
    const sent = await fetch(`http://127.0.0.1:${port}/api/runs/SZ6/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "try the other fix" }),
    });
    assert.equal(sent.status, 202);
    const sentBody = (await sent.json()) as { resumedFrom: string };
    assert.equal(sentBody.resumedFrom, "phase2");
    const stored = JSON.parse(fs.readFileSync(path.join(root, ".ai-flow", "runs", "SZ6", "state.json"), "utf8")) as {
      rework?: { stage: string; comment: string };
      reviews?: Array<{ decision: string; stage: string; comment: string }>;
    };
    assert.equal(stored.rework?.stage, "phase2");
    assert.equal(stored.rework?.comment, "try the other fix");
    assert.ok(stored.rework !== undefined && "at" in stored.rework, "the rework record carries a timestamp");
    assert.equal(stored.reviews?.at(-1)?.decision, "message");
    assert.deepEqual(started, ["SZ6"]);

    // An empty message is rejected, an awaiting run gets 409 (review actions only).
    const empty = await fetch(`http://127.0.0.1:${port}/api/runs/SZ6/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "  " }),
    });
    assert.equal(empty.status, 400);
    const notFailed = await fetch(`http://127.0.0.1:${port}/api/runs/SZ7/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "nope" }),
    });
    assert.equal(notFailed.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runTool reports a timeout as a timeout, not a start failure", async () => {
  // Regression: a spawnSync timeout lands in result.error (ETIMEDOUT) the
  // same way a spawn failure does, so the old message said "failed to start"
  // for a tool that ran and ran long.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-timeout-"));
  const skillDir = path.join(dir, "skills", "sz-dev");
  const toolsDir = path.join(skillDir, "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  const tool = path.join(toolsDir, "sz-progress");
  fs.writeFileSync(tool, "#!/usr/bin/env bash\nsleep 5\n", "utf8");
  fs.chmodSync(tool, 0o755);
  try {
    await assert.rejects(
      runToolOrThrow({ skillDir, tool: "sz-progress", args: ["show", "SZ1"], cwd: dir, timeoutMs: 300 }),
      (err: unknown) => err instanceof StageError && /timed out after 300ms/.test(err.message),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real sz-progress drives the szdev wrappers end-to-end (skipped without the tools)", {
  skip: !fs.existsSync(path.join(SKILL_DIR, "tools", "sz-progress")),
}, async () => {
  const root = initRepo();
  const ctx: SzdevContext = { skillDir: SKILL_DIR, id: "SZ9", workspace: root };
  try {
    // sz-progress init requires the state root (normally created by
    // sz-workspace ensure / phase 0); stand it up directly.
    fs.mkdirSync(path.join(root, ".sz-dev", "SZ9"), { recursive: true });
    await progressInit(ctx);
    let snapshot = await progressShow(ctx);
    assert.equal(snapshot.phase, 0);
    assert.deepEqual(snapshot.gates, { 1: "pending", 2: "pending", 3: "pending", 4: "pending" });
    assert.equal(snapshot.awaiting, null);

    await progressSetPhase(ctx, 1);
    await progressNote(ctx, "module pack: cql");
    // The real tool enforces gate evidence: gate 1 needs the requirement
    // (with a repro conclusion) plus the raw ticket sources on disk.
    const szDir = path.join(root, ".sz-dev", "SZ9");
    fs.mkdirSync(path.join(szDir, "attachment"), { recursive: true });
    fs.writeFileSync(path.join(szDir, "phase1-requirement.md"), "# Requirement\n\nrepro: n/a\n");
    fs.writeFileSync(path.join(szDir, "attachment", "ticket-body.md"), "# SZ9 body\n");
    fs.writeFileSync(path.join(szDir, "attachment", "ticket-comments.md"), "# comments\n");
    await progressSetGate(ctx, 1, "passed");
    await progressAwaiting(ctx, "E3");
    snapshot = await progressShow(ctx);
    assert.equal(snapshot.phase, 1);
    assert.equal(snapshot.gates[1], "passed");
    assert.equal(snapshot.awaiting, "E3");
    assert.ok(snapshot.notes.some((note) => note.includes("module pack: cql")), "the note is recorded");

    await progressAwaiting(ctx, "clear");
    snapshot = await progressShow(ctx);
    assert.equal(snapshot.awaiting, null);
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-repo-"));
  git(dir, ["init"]);
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "cql/lisp"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cql/lisp/init.scm"), ";;; FILE: init.scm\n");
  git(dir, ["add", "."]);
  commit(dir);
  return dir;
}

function commit(cwd: string): void {
  git(cwd, ["-c", "user.email=ai-flow@local", "-c", "user.name=ai-flow", "-c", "commit.gpgsign=false", "commit", "-m", "init"]);
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function cleanup(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}
