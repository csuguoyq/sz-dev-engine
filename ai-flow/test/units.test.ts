import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyZcodeModel, expandArgv, findPreset, parseModelLines, readZcodeProviderModels, resolvePresetBin, resolvePresetCommand, resolvePresetStatusCommand, type AgentPreset } from "../src/agents.js";
import { agentProcessPatterns, loadConfig } from "../src/config.js";
import { findExecutable, listPresetModels, runInit } from "../src/init.js";
import { createStreamFormatter } from "../src/streamFormat.js";
import { runAgent } from "../src/runner.js";
import { claimAdapter, cqlAdapter, getAdapter } from "../src/adapters/index.js";
import { installRefTransactionLock, removeRefTransactionLock } from "../src/gitLock.js";
import { createLineRedactor, redact, RedactingLineTransform } from "../src/redact.js";
import {
  beijingTimestamp,
  changedPathsStandard,
  packageName,
} from "../src/package.js";
import {
  findFixChild,
  findFixCommit,
  parseCapabilityTable,
  parseProgress,
  parseReplayInit,
  parseWorkspaceEnsure,
  readReplayMeta,
  replayHarnessEnv,
  replayInit,
  writeReplayMeta,
  type SzdevContext,
} from "../src/szdev.js";
import { phase1Prompt, phase2Prompt, phase3Prompt, phase4Prompt, withReviewFeedback } from "../src/prompts.js";
import { armRunWatchdog, assertNoAgentOverreach, fileFingerprint, normalizeId } from "../src/orchestrator.js";
import { acquireRunLock, isAiFlowPipeline, isProcessAlive } from "../src/lock.js";
import { stopAgent, stopPipeline } from "../src/stop.js";
import { startUi, wireStartLog } from "../src/viewer/server.js";
import { parseCheckResult } from "../src/testStage.js";
import {
  ConcurrentStateError,
  createState,
  readState,
  StateConflictError,
  withStateUpdate,
  writeState,
} from "../src/store.js";
import { checkCsrf, RateLimiter, rejectIfLimited } from "../src/viewer/guards.js";
import { summary } from "../src/viewer/http.js";
import { dropStreamCache, readStreamLog } from "../src/viewer/streamCache.js";
import { escapeHtml, renderFallbackMarkdown } from "../viewer-ui/src/markdown.ts";
import type { AiFlowConfig, Change, RunState } from "../src/types.js";

test("normalizeId accepts SZ numbers and digits", () => {
  assert.equal(normalizeId("SZ34623"), "SZ34623");
  assert.equal(normalizeId("sz12"), "SZ12");
  assert.equal(normalizeId(" 99 "), "SZ99");
  assert.throws(() => normalizeId("TC12"));
});

test("redact hides bug-tracker cookies", () => {
  const text = "Bugzilla_login=a@b.c; Bugzilla_logincookie=798147;";
  assert.equal(redact(text).includes("798147"), false);
  assert.match(redact(text), /redacted/);
});

test("redact hides a broad set of credentials", () => {
  const samples: Array<[string, string]> = [
    ["password=supersecret", "supersecret"],
    ["api_token=sk_live_abc123", "sk_live_abc123"],
    ["access_token=ghp_0123456789", "ghp_0123456789"],
    ["auth_token: sess_abcdef", "sess_abcdef"],
    ["Authorization: Bearer tokentokentoken", "tokentokentoken"],
    ["Cookie: session=abcdef0123456789", "abcdef0123456789"],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", "MIIabc"],
  ];
  for (const [text, secret] of samples) {
    const out = redact(text);
    assert.equal(out.includes(secret), false, `expected ${secret} to be redacted in: ${text}`);
    assert.match(out, /redacted/);
  }
  // Public keys are NOT secrets and must survive.
  assert.match(redact("ssh-rsa AAAAB3publickeycomment user@host"), /AAAAB3publickeycomment/);
  // Plain, non-secret words are not touched.
  assert.equal(redact("token: 12345 is a count"), "token: 12345 is a count");
});

test("createLineRedactor redacts per complete line across chunk boundaries", () => {
  const lines: string[] = [];
  const redactor = createLineRedactor((line) => lines.push(line));
  // A secret split across chunks must still be caught: redaction runs on the
  // COMPLETED line, not on each chunk.
  redactor.push("password=");
  redactor.push("topsecre");
  redactor.push("t123 done\nnext line\n");
  redactor.flush();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].includes("topsecret123"), false, "the split secret must be redacted");
  assert.match(lines[0], /password=<redacted> done/);
  assert.equal(lines[1], "next line\n");
});

test("createLineRedactor keeps a mid-UTF8 chunk split intact", () => {
  const lines: string[] = [];
  const redactor = createLineRedactor((line) => lines.push(line));
  const full = "h\u00e9llo w\u00f6rld\n";
  const buf = Buffer.from(full, "utf8");
  // Split in the middle of the multi-byte \u00e9.
  redactor.push(buf.subarray(0, 2));
  redactor.push(buf.subarray(2));
  redactor.flush();
  assert.equal(lines.join(""), full, "a split multi-byte char must reassemble");
});

test("createLineRedactor flushes a trailing partial line exactly once", () => {
  const lines: string[] = [];
  const redactor = createLineRedactor((line) => lines.push(line));
  redactor.push("tail without newline");
  redactor.flush();
  assert.deepEqual(lines, ["tail without newline\n"]);
  redactor.flush();
  assert.equal(lines.length, 1, "a second flush must not re-emit");
});

test("createLineRedactor bounds memory on a newline-free stream", () => {
  const lines: string[] = [];
  const redactor = createLineRedactor((line) => lines.push(line), 16);
  redactor.push("x".repeat(40));
  assert.equal(lines.length, 1, "the cap must flush the pending buffer");
  assert.equal(lines[0], "x".repeat(40) + "\n");
});

test("RedactingLineTransform redacts a piped stream", async () => {
  const transform = new RedactingLineTransform();
  const out: string[] = [];
  transform.on("data", (chunk: Buffer) => out.push(chunk.toString("utf8")));
  const done = new Promise<void>((resolve, reject) => {
    transform.on("end", () => resolve());
    transform.on("error", reject);
  });
  transform.write("line one password=abc123\nplain\n");
  transform.write("partial");
  transform.end();
  await done;
  assert.equal(out.join(""), "line one password=<redacted>\nplain\npartial\n");
});

test("run lock serializes a single ticket and reaps stale locks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-lock-"));
  try {
    // Fresh acquisition writes the lock and release removes it.
    const a = await acquireRunLock(dir);
    assert.equal(fs.existsSync(path.join(dir, "run.lock")), true);
    a.release();
    assert.equal(fs.existsSync(path.join(dir, "run.lock")), false);

    // A stale lock (dead pid) is reaped and a new lock is taken.
    fs.writeFileSync(path.join(dir, "run.lock"), JSON.stringify({ pid: 9_999_999, startedAt: "x" }));
    const b = await acquireRunLock(dir);
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "run.lock"), "utf8"));
    assert.equal(typeof lock.pid, "number");
    assert.notEqual(lock.pid, 9_999_999);
    b.release();

    // An orphan agent left behind by a crashed run is reaped (here the pid is
    // dead, so it is simply ignored without error).
    fs.writeFileSync(path.join(dir, "agent.pid"), "9_999_999");
    const c = await acquireRunLock(dir);
    c.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lock release only removes the lock of its own pid", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-lock-"));
  try {
    const handle = await acquireRunLock(dir);
    // Simulate a force takeover: the lock now records a different pid.
    fs.writeFileSync(path.join(dir, "run.lock"), JSON.stringify({ pid: 424242, startedAt: new Date().toISOString() }));
    handle.release();
    assert.equal(fs.existsSync(path.join(dir, "run.lock")), true, "a foreign lock must survive release");
    fs.rmSync(path.join(dir, "run.lock"), { force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a live pipeline lock is refused without force and taken over with it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-lock-"));
  // A process whose cmdline reads like an ai-flow pipeline: the marker
  // tokens must survive in /proc/<pid>/cmdline. bash -c exec-optimizes a
  // single simple command (the process replaces itself and the argv
  // degrades to ["sleep","30"], losing the markers), so the script is a
  // two-command list — bash then stays resident with the tokens in argv.
  const pipeline = spawn("bash", ["-c", "sleep 30; :", "ai-flow", "cli.js", "run"], { stdio: "ignore" });
  const foreign = spawn("bash", ["-c", "sleep 30; :"], { stdio: "ignore" });
  const cmdline = (pid?: number): string[] => {
    if (pid === undefined) return [];
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    } catch {
      return [];
    }
  };
  try {
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Fixture precondition: the pipeline must look live and recognizable
    // (a bash behavior change must fail here with evidence, not as a
    // confusing "missing expected rejection").
    const argv = cmdline(pipeline.pid);
    assert.ok(argv.includes("ai-flow") && argv.includes("run"), `pipeline fixture lost its marker argv: ${JSON.stringify(argv)}`);
    assert.equal(isProcessAlive(pipeline.pid!), true, "pipeline fixture died before the assertions");
    // Live, recognizable pipeline lock: a plain acquire must refuse...
    fs.writeFileSync(path.join(dir, "run.lock"), JSON.stringify({ pid: pipeline.pid, startedAt: new Date().toISOString() }));
    await assert.rejects(acquireRunLock(dir), (err: unknown) => err instanceof Error && /already in progress/.test(err.message));
    // ...but --force takes it over.
    const forced = await acquireRunLock(dir, { force: true });
    const lock = JSON.parse(fs.readFileSync(path.join(dir, "run.lock"), "utf8")) as { pid: number };
    assert.equal(lock.pid, process.pid);
    forced.release();
    // Live but NOT recognizable (a foreign process holding the lock number):
    // taken over without force, documented as a stale/foreign pid.
    assert.equal(isAiFlowPipeline(foreign.pid!), false, "foreign fixture must not read like an ai-flow pipeline");
    fs.writeFileSync(path.join(dir, "run.lock"), JSON.stringify({ pid: foreign.pid, startedAt: new Date().toISOString() }));
    const taken = await acquireRunLock(dir);
    taken.release();
  } finally {
    for (const child of [pipeline, foreign]) {
      if (child.pid !== undefined) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a live but unverifiable lock is refused without force (probe seam)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-lock-"));
  // The probe is injected (a test seam on acquireRunLock) so the VERDICT
  // handling is covered without actually making a live pid's cmdline
  // unreadable; the real /proc read is exercised by the fixture test above.
  try {
    // Alive + cmdline UNREADABLE ("unknown"): refuse, and the lock survives.
    fs.writeFileSync(path.join(dir, "run.lock"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await assert.rejects(
      acquireRunLock(dir, { probe: () => "unknown" }),
      (err: unknown) => err instanceof Error && /could not be verified/.test(err.message),
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "run.lock"), "utf8")).pid, process.pid, "a refused lock must stay put");
    // --force takes an unverifiable lock over.
    const forced = await acquireRunLock(dir, { probe: () => "unknown", force: true });
    forced.release();
    // A VERIFIED-foreign live pid is taken over without force.
    fs.writeFileSync(path.join(dir, "run.lock"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const taken = await acquireRunLock(dir, { probe: () => "no" });
    taken.release();
    // A VERIFIED ai-flow pid refuses through the same verdict path.
    fs.writeFileSync(path.join(dir, "run.lock"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await assert.rejects(acquireRunLock(dir, { probe: () => "yes" }), (err: unknown) => err instanceof Error && /already in progress/.test(err.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace ensure output parses mode and workspace", () => {
  const parsed = parseWorkspaceEnsure("MODE=replay\nBRANCH=sz/35256\nWORKSPACE=/home/u_sz1/ccsrc\n");
  assert.deepEqual(parsed, { mode: "replay", workspace: "/home/u_sz1/ccsrc", branch: "sz/35256" });
  assert.equal(parseWorkspaceEnsure("WORKSPACE=/repo\n").mode, "standard");
  assert.throws(() => parseWorkspaceEnsure("no output"));
});

test("replay init output parses all keys", () => {
  const parsed = parseReplayInit(
    "REPLAY_DIR=/r/ccsrc\nSZ_DEV_DIR=/r/ccsrc/.sz-dev\nBASELINE_COMMIT=aaa\nFIX_COMMIT=bbb\nCOPIED=skills/ cql/test/\n",
  );
  assert.equal(parsed.replayDir, "/r/ccsrc");
  assert.equal(parsed.baselineCommit, "aaa");
  assert.equal(parsed.fixCommit, "bbb");
  assert.equal(parsed.copied, "skills/ cql/test/");
  assert.throws(() => parseReplayInit("REPLAY_DIR=/r\n"));
});

test("progress markdown parses phase, gates, awaiting, and notes", () => {
  const snapshot = parseProgress(
    [
      "state root: /w/.sz-dev",
      "# Progress: SZ1",
      "phase: 2",
      "mode: file",
      "track: auto",
      "slice: -",
      "rounds: 1",
      "gate1: passed",
      "gate2: pending",
      "gate3: pending",
      "gate4: pending",
      "awaiting: E1",
      "constraints:",
      "notes:",
      "- module pack: cql",
      "- escalation open: E1 (blocks the current phase; resume re-presents it)",
    ].join("\n"),
  );
  assert.equal(snapshot.phase, 2);
  assert.equal(snapshot.rounds, 1);
  assert.equal(snapshot.gates[1], "passed");
  assert.equal(snapshot.gates[2], "pending");
  assert.equal(snapshot.awaiting, "E1");
  assert.equal(snapshot.notes.length, 2);
  const aborted = parseProgress("phase: aborted\nawaiting:\n");
  assert.equal(aborted.phase, "aborted");
  assert.equal(aborted.awaiting, null);
});

test("capability table parses the seven pack rows and detects manual track", () => {
  const readme = [
    "| Capability | Phase | File(s) |",
    "|---|---|---|",
    "| check | Phase 2 | tools/cql_lint.py |",
    "| repro | Phase 1 | repro.md |",
    "| routing | Phase 1 | routing.md |",
    "| accept | Phase 3 | manual track |",
    "| build | Phase 2 | — |",
    "| deliverables | Phase 4 | gen_docs.py |",
    "| review-checklist | Phase 2.5 | automation.md |",
  ].join("\n");
  const parsed = parseCapabilityTable(readme, "cql");
  assert.equal(parsed.files.check, "tools/cql_lint.py");
  assert.equal(parsed.files.accept, undefined);
  assert.equal(parsed.autoTrack, false);

  const complete = parseCapabilityTable(
    readme.replace("| accept | Phase 3 | manual track |", "| accept | Phase 3 | runner.py |").replace("| build | Phase 2 | — |", "| build | Phase 2 | Makefile |"),
    "cql",
  );
  assert.equal(complete.autoTrack, true);
});

test("cql adapter scope guards keep changes inside cql", () => {
  assert.throws(() => cqlAdapter.assertPhase2Scope([{ status: "A", path: "README.md" }] as Change[]));
  assert.doesNotThrow(() => cqlAdapter.assertPhase2Scope([{ status: "M", path: "cql/lisp/init.scm" }] as Change[]));
  assert.throws(() => cqlAdapter.assertPhase2Scope([] as Change[]));
  assert.throws(() => cqlAdapter.assertPhase3Scope("same", "changed"));
  assert.doesNotThrow(() => cqlAdapter.assertPhase3Scope("same", "same"));
});

test("claim adapter scope guards keep changes inside the two claim roots", () => {
  // In scope: the VERIFIED frontend root and the webframe backend root.
  assert.doesNotThrow(() =>
    claimAdapter.assertPhase2Scope([
      { status: "M", path: "ehr/src/Charge/Claim/Fee.tsx" },
      { status: "A", path: "webframe/app3/classes/Controller/Claim.php" },
    ] as Change[]),
  );
  // Out of scope: a historical claim area (HOBJS) alongside an in-scope change is rejected.
  assert.throws(
    () =>
      claimAdapter.assertPhase2Scope([
        { status: "M", path: "ehr/src/Charge/Claim/Fee.tsx" },
        { status: "M", path: "HOBJS/claim/getclaimlist" },
      ] as Change[]),
    /outside the claim scope/,
  );
  // Nothing in scope (a scripts-only change) is a failure, not a pass.
  assert.throws(() => claimAdapter.assertPhase2Scope([{ status: "M", path: "scripts/InitGuarantorDB.sh" }] as Change[]), /no changes under the claim scope/);
  assert.throws(() => claimAdapter.assertPhase2Scope([] as Change[]));
  // Generated reports are noise: a report-only change still has no in-scope work.
  assert.throws(() => claimAdapter.assertPhase2Scope([{ status: "A", path: "test-reports/SZ1.md" }] as Change[]), /no changes under the claim scope/);
  // No test area for claim: any phase-3 drift is a failure.
  assert.throws(() => claimAdapter.assertPhase3Scope("same", "changed"));
  assert.doesNotThrow(() => claimAdapter.assertPhase3Scope("same", "same"));
});

test("claim adapter check is a manual-track warning pass", async () => {
  const outcome = await claimAdapter.check({ worktree: "/w", changedFiles: [], logFile: "/w/log" });
  assert.equal(outcome.passed, true);
  assert.match(outcome.output, /MANUAL track/);
});

test("getAdapter dispatches cql and claim, falls back to generic", () => {
  assert.equal(getAdapter("cql").module, "cql");
  assert.equal(getAdapter("claim").module, "claim");
  assert.equal(getAdapter("CLAIM").module, "claim");
  assert.equal(getAdapter(undefined).module, "cql");
  assert.equal(getAdapter("billing").module, "generic");
});

test("phase prompts carry the hard rules and workflow path", () => {
  const p1 = phase1Prompt({ skillDir: "/skills/sz-dev", ticketPath: "/run/ticket.md", workspace: "/w", mode: "standard", id: "SZ1" });
  assert.match(p1, /workflows\/phase1-requirement\.md/);
  assert.match(p1, /Never git commit/);
  assert.match(p1, /repro: red\|n\/a\|manual/);
  assert.match(p1, /Fetch SZ1 yourself/);
  assert.equal(p1.includes("SZSZ"), false);
  assert.match(p1, /Do not run sz-workspace ensure/);
  assert.match(p1, /Do not open existing tar archives/);
  assert.equal(p1.includes("Do not run sz-preflight"), false);
  const p1replay = phase1Prompt({
    skillDir: "/skills/sz-dev",
    ticketPath: "/run/ticket.md",
    workspace: "/w",
    mode: "replay",
    id: "SZ1",
    fixCommit: "fix",
    baselineCommit: "base",
  });
  assert.match(p1replay, /REPLAY MODE/);
  const p2 = phase2Prompt({ skillDir: "/skills/sz-dev", workspace: "/w", pack: "cql", mode: "standard", requirementPath: "/w/.sz-dev/SZ1/phase1-requirement.md" });
  assert.match(p2, /references\/cql/);
  assert.match(p2, /Do not run sz-preflight again/);
  assert.match(withReviewFeedback(p2, "fix scope"), /Human review comment/);
  const p3 = phase3Prompt({ skillDir: "/skills/sz-dev", workspace: "/w", pack: "cql", testPlanPath: "/w/phase3-test-plan.md", testReportPath: "/w/phase3-test-report.md" });
  assert.match(p3, /Do not run sz-preflight again/);
  const p4 = phase4Prompt({ skillDir: "/skills/sz-dev", workspace: "/w", pack: "cql", deliverablesDir: "/w/deliverables" });
  assert.match(p4, /Do not install again/);
  assert.match(p4, /sz-replay verify/);
});

test("replay init names the launching checkout as the skills harness", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-harness-"));
  const saved = process.env.SZ_REPLAY_HARNESS_SRC;
  try {
    delete process.env.SZ_REPLAY_HARNESS_SRC;
    assert.equal(replayHarnessEnv(root), undefined);

    const skillDir = path.join(root, "skills", "sz-dev");
    fs.mkdirSync(path.join(skillDir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# skill\n");
    assert.deepEqual(replayHarnessEnv(root), { SZ_REPLAY_HARNESS_SRC: root });

    const seen = path.join(skillDir, "tools", "seen-harness");
    fs.writeFileSync(
      path.join(skillDir, "tools", "sz-replay"),
      `#!/bin/bash
printf '%s' "\${SZ_REPLAY_HARNESS_SRC-}" > ${JSON.stringify(seen)}
printf 'REPLAY_DIR=/replay\\nSZ_DEV_DIR=/replay/.sz-dev\\nBASELINE_COMMIT=base\\nFIX_COMMIT=fix\\n'
`,
    );
    fs.chmodSync(path.join(skillDir, "tools", "sz-replay"), 0o755);
    const parsed = await replayInit({ skillDir, id: "SZ1", fixCommit: "fix", repo: root });
    assert.equal(parsed.replayDir, "/replay");
    assert.equal(fs.readFileSync(seen, "utf8"), root);

    process.env.SZ_REPLAY_HARNESS_SRC = "/operator/checkout";
    assert.equal(replayHarnessEnv(root), undefined);
  } finally {
    if (saved === undefined) delete process.env.SZ_REPLAY_HARNESS_SRC;
    else process.env.SZ_REPLAY_HARNESS_SRC = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("package names use the Beijing timestamp", () => {
  const utc = new Date("2026-09-28T08:05:00Z"); // 16:05 Beijing
  assert.equal(packageName("SZ35256", utc), "SZ35256_202609281605.tar.gz");
  assert.match(beijingTimestamp(utc), /^\d{12}$/);
});

test("changedPathsStandard keeps non-deleted changes and drops reports", () => {
  assert.throws(() => changedPathsStandard("/nonexistent", "head"));
});

test("check report maps SKIP to blocked and FAIL to failed", () => {
  const skipped = parseCheckResult(
    JSON.stringify({
      totals: { pass: 2, fail: 0, skip: 1 },
      cases: [{ id: "db-pat-bymrn-01", status: "SKIP(env): no cis escalation" }],
    }),
    "",
  );
  assert.equal(skipped.verdict, "passed_with_blocked");
  assert.equal(skipped.skipped.length, 1);

  const failed = parseCheckResult(null, "Totals: PASS=0 FAIL=1 SKIP=0");
  assert.equal(failed.verdict, "failed");
});

test("expandArgv fills or drops the model flag and feeds the prompt", () => {
  const empty = expandArgv(["agent", "--model", "{model}", "{promptStdin}"], {
    cwd: "/work",
    promptFile: "/tmp/p.md",
    prompt: "stage prompt",
    model: "",
  });
  assert.deepEqual(empty.argv, ["agent"]);
  assert.equal(empty.stdin, "stage prompt");

  const filled = expandArgv(["agent", "--workspace", "{cwd}", "--model", "{model}", "{promptStdin}"], {
    cwd: "/work",
    promptFile: "/tmp/p.md",
    prompt: "stage prompt",
    model: "composer-2.5",
  });
  assert.deepEqual(filled.argv, ["agent", "--workspace", "/work", "--model", "composer-2.5"]);

  const positional = expandArgv(["dsh", "--profile", "headless", "{promptArg}"], {
    cwd: "/work",
    promptFile: "/tmp/p.md",
    prompt: "do the work",
    model: "deepseek-v4",
    applyModel: false,
  });
  assert.deepEqual(positional.argv, ["dsh", "--profile", "headless", "do the work"]);
  assert.equal(positional.stdin, null);

  const legacy = expandArgv(["opencode", "run", "{promptStdin}"], {
    cwd: "/work",
    promptFile: "/tmp/p.md",
    prompt: "hi",
    model: "provider/model",
  });
  assert.deepEqual(legacy.argv, ["opencode", "run", "-m", "provider/model"]);
});

test("parseModelLines reads cursor and opencode listings", () => {
  const ids = parseModelLines("Available models\n\nauto - Auto (current, default)\ncomposer-2.5 - Composer 2.5\nTip: use --model\nprovider/model\n");
  assert.deepEqual(ids, ["auto", "composer-2.5", "provider/model"]);
});

test("findExecutable searches PATH and does not use which", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-bin-"));
  const bin = path.join(dir, "agent");
  fs.writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(bin, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = dir;
  try {
    assert.equal(findExecutable("agent"), bin);
    assert.equal(findExecutable("not-a-real-cli-xyz"), null);
  } finally {
    process.env.PATH = previous;
  }
});

test("loadConfig expands an agent preset and still accepts a legacy command", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-config-"));
  const file = path.join(root, "ai-flow.config.json");
  fs.writeFileSync(file, JSON.stringify({ agent: "cursor", model: "composer-2.5", runner: { command: ["stale"] } }));
  const loaded = loadConfig(root);
  assert.equal(loaded.agent, "cursor");
  assert.equal(loaded.model, "composer-2.5");
  assert.equal(loaded.runner.command[0], "agent");
  assert.ok(loaded.runner.command.includes("{promptStdin}"));

  fs.writeFileSync(file, JSON.stringify({ runner: { command: ["fake-agent", "{promptFile}"] } }));
  const legacy = loadConfig(root);
  assert.deepEqual(legacy.runner.command, ["fake-agent", "{promptFile}"]);
  assert.equal(legacy.agent, undefined);

  // An explicit, prompt-token-bearing command alongside an agent is honored
  // (what the file shows is what runs); a stale command without a prompt
  // token falls back to the preset expansion.
  fs.writeFileSync(
    file,
    JSON.stringify({ agent: "deepseek", runner: { command: ["/opt/dsh", "--profile", "headless", "{promptArg}"] } }),
  );
  const explicit = loadConfig(root);
  assert.deepEqual(explicit.runner.command, ["/opt/dsh", "--profile", "headless", "{promptArg}"]);

  // Operator runner extras survive the agent expansion alongside an explicit
  // command.
  fs.writeFileSync(
    file,
    JSON.stringify({
      agent: "zcode",
      runner: {
        command: ["/opt/zcode", "--cwd", "{cwd}", "--prompt", "{promptArg}"],
        statusCommand: ["/opt/zcode-status", "{dir}"],
        modelsCommand: ["/opt/zcode-models"],
      },
    }),
  );
  const extras = loadConfig(root);
  assert.deepEqual(extras.runner.command, ["/opt/zcode", "--cwd", "{cwd}", "--prompt", "{promptArg}"]);
  assert.deepEqual(extras.runner.statusCommand, ["/opt/zcode-status", "{dir}"]);
  assert.deepEqual(extras.runner.modelsCommand, ["/opt/zcode-models"]);
});

test("loadConfig warns when {model} follows a non-flag token", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-modelwarn-"));
  const file = path.join(root, "ai-flow.config.json");
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (line: string) => {
    warnings.push(String(line));
  };
  try {
    // A flag immediately before {model} is the safe shape: no warning.
    fs.writeFileSync(file, JSON.stringify({ runner: { command: ["fake-agent", "-m", "{model}", "{promptFile}"] } }));
    loadConfig(root);
    assert.equal(warnings.length, 0, "a flag-adjacent {model} is fine");

    // A bare word before {model} will be glued to the model name by most
    // agents: warn the operator at config load, but still run the command.
    fs.writeFileSync(file, JSON.stringify({ runner: { command: ["fake-agent", "model-is", "{model}", "{promptFile}"] } }));
    const loaded = loadConfig(root);
    assert.deepEqual(loaded.runner.command, ["fake-agent", "model-is", "{model}", "{promptFile}"]);
    assert.equal(warnings.length, 1, "exactly one warning");
    assert.match(warnings[0], /\{model\} right after "model-is"/);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolvePresetBin falls back to binCandidates and rewrites the command", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-bin-"));
  const bin = path.join(root, "zcode-fake");
  fs.writeFileSync(bin, "#!/bin/sh\n");
  fs.chmodSync(bin, 0o755);
  const preset: AgentPreset = {
    id: "fake",
    label: "Fake",
    bin: "definitely-not-on-path-xyz",
    command: ["definitely-not-on-path-xyz", "--cwd", "{cwd}", "{promptArg}"],
    binCandidates: ["~/no/such/place/zcode", bin],
    modelInCommand: false,
  };
  assert.equal(resolvePresetBin(preset), bin);
  assert.deepEqual(resolvePresetCommand(preset), [bin, "--cwd", "{cwd}", "{promptArg}"]);

  // No reachable candidate: the template is returned unchanged so the runner
  // reports the familiar "not on PATH" startup error.
  assert.equal(resolvePresetBin({ ...preset, binCandidates: [] }), null);
  assert.deepEqual(resolvePresetCommand({ ...preset, binCandidates: [] }), [
    "definitely-not-on-path-xyz",
    "--cwd",
    "{cwd}",
    "{promptArg}",
  ]);
});

test("resolvePresetStatusCommand resolves the bundled status probe", () => {
  const zcode = findPreset("zcode");
  assert.ok(zcode, "zcode preset exists");
  const command = resolvePresetStatusCommand(zcode!);
  assert.ok(command, "zcode ships a status probe");
  assert.equal(command![1], "{dir}");
  assert.ok(command![0].endsWith(path.join("tools", "zcode-status.sh")));
  assert.equal(resolvePresetStatusCommand({ ...zcode!, statusScript: undefined }), null);
  assert.equal(resolvePresetStatusCommand({ ...zcode!, statusScript: "missing.sh" }), null);

  const opencode = findPreset("opencode");
  assert.ok(opencode, "opencode preset exists");
  assert.ok(resolvePresetStatusCommand(opencode!), "opencode ships a status probe");
});

test("stream formatter turns zcode stream-json into a readable process log", () => {
  const events = [
    { type: "turn.started", payload: { input: "Fix the bug and verify." } },
    { type: "session.updated", payload: { noise: true } },
    { type: "model.streaming", payload: { assistantMessageId: "m1", kind: "reasoning_start" } },
    { type: "model.streaming", payload: { assistantMessageId: "m1", kind: "reasoning_delta", delta: "Read the file first" } },
    { type: "model.streaming", payload: { assistantMessageId: "m1", kind: "reasoning_end" } },
    { type: "model.streaming", payload: { assistantMessageId: "m1", kind: "tool_call", toolCallId: "c1", toolName: "Bash", input: { command: "echo hi" } } },
    { type: "tool.updated", payload: { toolCallId: "c1", kind: "started", toolName: "Bash" } },
    { type: "tool.updated", payload: { toolCallId: "c1", kind: "result", result: { success: true, content: "hi", perf: { totalMs: 2595 } } } },
    { type: "model.streaming", payload: { assistantMessageId: "m2", kind: "text_start" } },
    { type: "model.streaming", payload: { assistantMessageId: "m2", kind: "text_delta", delta: "DONE" } },
    { type: "model.streaming", payload: { assistantMessageId: "m2", kind: "text_end" } },
    { type: "turn.completed", payload: { response: "DONE", usage: { totalTokens: 46917 } } },
  ];
  const formatter = createStreamFormatter();
  const out: string[] = [];
  for (const event of events) out.push(...formatter.push(JSON.stringify(event)));
  out.push(...formatter.finish());
  const text = out.join("\n");
  assert.match(text, /\[user\] Fix the bug and verify\./);
  assert.match(text, /── step 1 ──/);
  assert.match(text, /thinking: Read the file first/);
  assert.match(text, /tool: Bash echo hi → ok \(2\.6s\)/);
  assert.match(text, /assistant: DONE/);
  assert.match(text, /\[turn completed\] response: DONE · tokens: 46917/);
  // session.updated noise is dropped, deltas never leak as raw lines.
  assert.doesNotMatch(text, /session\.updated|reasoning_delta/);

  // A stream cut mid-message still flushes what accumulated, and unknown
  // payloads stay invisible instead of crashing the reader.
  const cut = createStreamFormatter();
  cut.push(JSON.stringify(events[2]));
  cut.push(JSON.stringify(events[3]));
  assert.match(cut.finish().join("\n"), /thinking: Read the file first/);
  assert.deepEqual(cut.push("not json at all"), ["not json at all"]);
});

test("init writes the repo-root config and carries ui/szdev over from the legacy file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-home-"));
  const legacy = path.join(root, "ai-flow", "ai-flow.config.json");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({ ui: { host: "127.0.0.1", port: 4179 }, szdev: { pack: "cql" } }));
  const lines: string[] = [];
  const result = await runInit({
    repoRoot: root,
    agent: "deepseek",
    model: "deepseek-v4",
    yes: true,
    installed: () => false,
    // Hermetic resolution: no PATH, empty HOME — dsh cannot be found on any host.
    env: { ...process.env, HOME: home, PATH: "" },
    log: (line) => lines.push(line),
  });
  assert.equal(result.wrote, true);
  assert.equal(result.file, path.join(root, "ai-flow.config.json"));
  const written = JSON.parse(fs.readFileSync(result.file, "utf8")) as { agent: string; model: string; ui: { port: number }; szdev: { pack: string } };
  assert.equal(written.agent, "deepseek");
  assert.equal(written.model, "deepseek-v4");
  assert.equal(written.ui.port, 4179);
  assert.equal(written.szdev.pack, "cql");
  assert.match(lines.join("\n"), /dsh --profile headless \{promptArg\}/);
  assert.match(lines.join("\n"), /not found on PATH/);
});

test("init with no previous config writes the repo-root file with remote-reachable defaults", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-"));
  // Hermetic zcode install: a fake desktop binCandidate under a temp HOME and
  // an empty PATH, so the resolved command is the same on every host (the
  // test must not depend on whether zcode is installed on the CI machine).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-zcode-home-"));
  const agentDir = path.join(home, ".zcode", "server", "agents", "glm");
  fs.mkdirSync(agentDir, { recursive: true });
  const agentBinPath = path.join(agentDir, "zcode-agent");
  fs.writeFileSync(agentBinPath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(agentBinPath, 0o755);
  const result = await runInit({
    repoRoot: root,
    agent: "zcode",
    yes: true,
    installed: () => false,
    env: { ...process.env, HOME: home, PATH: "" },
    log: () => undefined,
  });
  assert.equal(result.wrote, true);
  assert.equal(result.file, path.join(root, "ai-flow.config.json"));
  const written = JSON.parse(fs.readFileSync(result.file, "utf8")) as {
    agent: string;
    model: string;
    runner: { command: string[] };
    ui: { host: string; port: number };
    szdev: { skillDir: string; pack: string };
  };
  assert.equal(written.agent, "zcode");
  assert.equal(written.model, "");
  assert.equal(written.runner.command[0], agentBinPath, "init writes the resolved absolute command");
  assert.ok(written.runner.command.includes("{promptArg}"));
  assert.deepEqual(written.ui, { host: "127.0.0.1", port: 4173 });
  assert.deepEqual(written.szdev, { skillDir: "skills/sz-dev", pack: "cql" });
});

test("init persists the chosen zcode model into zcode's CLI config", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-zcode-home-"));
  const zcodeConfig = path.join(home, ".zcode", "cli", "config.json");
  fs.mkdirSync(path.dirname(zcodeConfig), { recursive: true });
  fs.writeFileSync(zcodeConfig, JSON.stringify({ hooks: { enabled: true }, model: { main: "account:bigmodel-start-plan/GLM-5.3-Flash" } }));
  const lines: string[] = [];
  const result = await runInit({
    repoRoot: root,
    agent: "zcode",
    model: "account:bigmodel-individual-coding-plan/GLM-5.3-Flash",
    yes: true,
    installed: () => true,
    applyZcodeModel: (model) => applyZcodeModel(model, { HOME: home } as NodeJS.ProcessEnv),
    log: (line) => lines.push(line),
  });
  assert.equal(result.model, "account:bigmodel-individual-coding-plan/GLM-5.3-Flash");
  const zcodeBody = JSON.parse(fs.readFileSync(zcodeConfig, "utf8")) as { model: { main: string }; hooks: { enabled: boolean } };
  assert.equal(zcodeBody.model.main, "account:bigmodel-individual-coding-plan/GLM-5.3-Flash");
  assert.equal(zcodeBody.hooks.enabled, true, "other config fields survive the update");
  assert.match(lines.join("\n"), /written to .*config\.json/);

  // An empty model keeps the zcode CLI default and leaves the file untouched.
  const before = fs.readFileSync(zcodeConfig, "utf8");
  await runInit({ repoRoot: root, agent: "zcode", model: "", yes: true, installed: () => true, applyZcodeModel: (model) => applyZcodeModel(model, { HOME: home } as NodeJS.ProcessEnv), log: () => undefined });
  assert.equal(fs.readFileSync(zcodeConfig, "utf8"), before, "empty model must not rewrite the zcode config");
});

test("applyZcodeModel creates the config when missing and reports the previous model", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-zcode-home-"));
  const env = { HOME: home } as NodeJS.ProcessEnv;
  const file = path.join(home, ".zcode", "cli", "config.json");
  const first = applyZcodeModel("account:bigmodel-offpeak-idle-plan/GLM-5.3", env);
  assert.equal(first.file, file);
  assert.equal(first.previous, "");
  const second = applyZcodeModel("account:bigmodel-individual-coding-plan/GLM-5.3-Flash", env);
  assert.equal(second.previous, "account:bigmodel-offpeak-idle-plan/GLM-5.3");
  const body = JSON.parse(fs.readFileSync(file, "utf8")) as { model: { main: string } };
  assert.equal(body.model.main, "account:bigmodel-individual-coding-plan/GLM-5.3-Flash");
});

test("zcode models come from the provider config, with the static list as fallback", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-zcode-home-"));
  const env = { HOME: home } as NodeJS.ProcessEnv;
  const dir = path.join(home, ".zcode", "v2");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "provider_config.json"),
    JSON.stringify({
      config: {
        providerConfigRules: {
          providerRules: [
            { providerId: "account:bigmodel-start-plan", config: { modelOrder: ["GLM-5.3-Flash"] } },
            { providerId: "account:bigmodel-team-coding-plan", config: { access: { apiKey: "sk-team" }, modelOrder: ["GLM-5.3-Flash"] } },
            { providerId: "account:bigmodel-individual-coding-plan", config: { modelOrder: ["GLM-5.3", "GLM-5.3-Flash"] } },
            { providerId: "uuid-openrouter", enabled: false, config: { personalModelIds: ["qwen/qwen3.8-27b:free"] } },
            { providerId: "keyless-provider", config: { modelOrder: ["mimo-v2.5"] } },
            { providerId: "bigmodel-api", config: { access: { apiKey: "sk-plan" }, modelOrder: ["GLM-5.3", "GLM-5.3-Flash"] } },
            { providerId: "new-provider", config: { access: { apiKey: "sk-test" }, personalModelIds: ["qwen3.8-27b"], modelOrder: [] } },
          ],
        },
        // Per-model disables: bigmodel-api has turned GLM-5.3 off.
        modelConfigRules: {
          providerModelRules: [{ providerId: "bigmodel-api", modelId: "GLM-5.3", config: { enabled: false } }],
        },
      },
    }),
  );
  // Account rules are held to the same bar as custom ones: the rule must
  // carry its own API key. credentials.json and setting.json are deliberately
  // not consulted.
  fs.mkdirSync(path.join(dir, "runtime", "provider", "bundled"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "runtime", "provider", "bundled", "zcode-builtin.json"),
    JSON.stringify({
      config: {
        providerConfigRules: {
          templateRules: [
            { templateId: "bigmodel-api", config: { builtinModelIds: ["GLM-5.3", "GLM-5.3-Flash"] } },
            { templateId: "zai-api", config: { builtinModelIds: ["GLM-5.3"] } },
          ],
        },
      },
    }),
  );
  const models = readZcodeProviderModels(env);
  assert.deepEqual(
    models.filter((id) => id.startsWith("account:bigmodel-team-coding-plan")),
    ["account:bigmodel-team-coding-plan/GLM-5.3-Flash"],
    "account rules with an API key are listed",
  );
  assert.equal(models.some((id) => id.startsWith("account:bigmodel-start-plan")), false, "account rules without an API key are skipped");
  assert.equal(models.some((id) => id.startsWith("account:bigmodel-individual-coding-plan")), false, "account rules without an API key are skipped");
  assert.deepEqual(
    models.filter((id) => id.startsWith("new-provider")),
    ["new-provider/qwen3.8-27b"],
    "enabled custom providers with an API key are listed",
  );
  assert.equal(models.some((id) => id.startsWith("keyless-provider")), false, "custom providers without an API key are skipped");
  assert.equal(models.some((id) => id.startsWith("uuid-openrouter")), false, "disabled providers are skipped");
  const zcode = findPreset("zcode") as AgentPreset;
  assert.deepEqual(listPresetModels(zcode, true, env), models, "init offers the config-derived list");

  // No config files (or unparsable ones) fall back to the preset's static list.
  const empty = { HOME: fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-zcode-home-")) } as NodeJS.ProcessEnv;
  assert.deepEqual(readZcodeProviderModels(empty), []);
  assert.deepEqual(listPresetModels(zcode, true, empty), zcode.models);
  fs.writeFileSync(path.join(dir, "provider_config.json"), "{broken");
  assert.deepEqual(readZcodeProviderModels(env), []);
});

test("init leaves the existing repo-root config when overwrite is declined", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-"));
  const file = path.join(root, "ai-flow.config.json");
  fs.writeFileSync(file, "{\"keep\":true}\n");
  const result = await runInit({
    repoRoot: root,
    agent: "claude",
    model: "sonnet",
    ask: async () => "n",
    installed: () => true,
    log: () => undefined,
  });
  assert.equal(result.wrote, false);
  assert.equal(fs.readFileSync(file, "utf8"), "{\"keep\":true}\n");
});

test("runner launches a CLI from ~/.local/bin when PATH does not include it", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-home-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-runner-"));
  const bindir = path.join(home, ".local", "bin");
  fs.mkdirSync(bindir, { recursive: true });
  const output = path.join(dir, "out.txt");
  const script = path.join(bindir, "fakeagent");
  fs.writeFileSync(script, "#!/bin/sh\nprintf '%s' \"$1\" > \"$2\"\n");
  fs.chmodSync(script, 0o755);
  const prompt = path.join(dir, "prompt.md");
  fs.writeFileSync(prompt, "stage prompt");
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  process.env.HOME = home;
  process.env.PATH = "/usr/bin:/bin";
  try {
    const result = await runAgent({
      command: ["fakeagent", "{promptArg}", output],
      cwd: dir,
      promptFile: prompt,
      logFile: path.join(dir, "agent.log"),
      applyModel: false,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(fs.readFileSync(output, "utf8"), "stage prompt");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test("runner records the agent and model and passes the prompt as an argument", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-runner-"));
  const prompt = path.join(dir, "prompt.md");
  const output = path.join(dir, "out.txt");
  const logFile = path.join(dir, "agent.log");
  fs.writeFileSync(prompt, "stage prompt");
  const script = path.join(dir, "agent.mjs");
  fs.writeFileSync(script, "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], process.argv[3] ?? '');\n");
  const result = await runAgent({
    command: [process.execPath, script, output, "{promptArg}"],
    cwd: dir,
    promptFile: prompt,
    logFile,
    model: "composer-2.5",
    agentId: "cursor",
    applyModel: false,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(fs.readFileSync(output, "utf8"), "stage prompt");
  assert.match(fs.readFileSync(logFile, "utf8"), /^# agent=cursor model=composer-2\.5\n/);
});

test("runner redacts the on-disk stage log (console stays raw)", async () => {
  // Regression for the on-disk log surface gap: the durable stage log file
  // must never contain credentials the agent echoed, even though the
  // operator console stream is intentionally left raw.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-runner-redact-"));
  const logFile = path.join(dir, "agent.log");
  const prompt = path.join(dir, "prompt.md");
  fs.writeFileSync(prompt, "p");
  const script = path.join(dir, "agent.mjs");
  fs.writeFileSync(script, "console.log(\"Authorization: Bearer supersecrettoken\"); console.log(\"password=hunter22\");\n");
  const result = await runAgent({
    command: [process.execPath, script],
    cwd: dir,
    promptFile: prompt,
    logFile,
    applyModel: false,
  });
  assert.equal(result.exitCode, 0);
  const onDisk = fs.readFileSync(logFile, "utf8");
  assert.equal(onDisk.includes("supersecrettoken"), false, "the on-disk log must be redacted");
  assert.equal(onDisk.includes("hunter22"), false, "the on-disk log must be redacted");
  assert.match(onDisk, /Authorization: <redacted>/);
  assert.match(onDisk, /password=<redacted>/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("stop patterns only anchor the agent pattern when the command has {cwd}", () => {
  const cfg = (command: string[]) => ({ runner: { command } });
  // deepseek preset: prompt-only command, no {cwd} → only the ticket-anchored
  // CLI pattern. An unanchored agent pattern would match every dsh headless
  // process on the machine (other tickets included).
  const deepseek = agentProcessPatterns(cfg(["dsh", "--profile", "headless", "{promptArg}"]), "SZ34445");
  // The pattern must stay valid POSIX ERE: pkill's regcomp rejects the PCRE
  // non-capturing (?:..) form (exit 2, kills nothing), so only capturing
  // groups are used. The anchor must match both the node-run CLI
  // (dist/cli.js run SZ..) and the installed `ai-flow` / `ai-flow.exe` bin.
  // The trailing boundary keeps prefix-related tickets apart (pkill -f is
  // an unanchored substring search: "run SZ34445" is a substring of
  // "run SZ344451").
  assert.deepEqual(deepseek, ["(cli\\.(js|ts)|ai-flow(\\.exe)?) run SZ34445([^0-9]|$)"]);
  assert.doesNotMatch(deepseek[0], /\(\?:/);
  // cursor preset: embeds {cwd} mid-command → the agent pattern is allowed,
  // anchored to sz<digits> case-insensitively (workspace paths may carry
  // SZ<digits>). Another token follows {cwd}, so the joining \s+ already
  // delimits the ticket number — no explicit boundary needed.
  const cursor = agentProcessPatterns(cfg(["agent", "--workspace", "{cwd}", "--model", "{model}", "{promptStdin}"]), "SZ34445");
  assert.equal(cursor.length, 2);
  assert.match(cursor[1], /\[sS\]\[zZ\]34445\\s\+/);
  assert.doesNotMatch(cursor[1], /34445\(\[\^0-9\]/);
  // {cwd} as the LAST token: the number runs to the end of the cmdline and
  // needs the explicit boundary (the $-anchor form is valid glibc ERE).
  const trailing = agentProcessPatterns(cfg(["zcode", "--prompt", "{promptArg}", "--cwd", "{cwd}"]), "SZ34445");
  assert.equal(trailing.length, 2);
  assert.match(trailing[1], /\[sS\]\[zZ\]34445\(\[\^0-9\]\|\$\)$/);
  // no command at all → CLI pattern only.
  assert.deepEqual(agentProcessPatterns(cfg([]), "SZ99"), ["(cli\\.(js|ts)|ai-flow(\\.exe)?) run SZ99([^0-9]|$)"]);
});

test("git ref lock blocks the agent from committing or checking out", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-reflock-"));
  const run = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  // reference-transaction arrived in Git 2.28; skip the behavioral assertions
  // on older git (the hook is simply never invoked there, and the after-the-fact
  // assertNoAgentOverreach check remains the backstop).
  const version = spawnSync("git", ["--version"], { encoding: "utf8" }).stdout.trim();
  const match = /(\d+)\.(\d+)/.exec(version);
  const supported = match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 28));
  try {
    run(["init", "-q"]);
    run(["config", "user.email", "test@example.com"]);
    run(["config", "user.name", "test"]);
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    run(["add", "a.txt"]);
    run(["commit", "-q", "-m", "base"]);
    const headBefore = run(["rev-parse", "HEAD"]).stdout.trim();

    assert.equal(installRefTransactionLock(dir), true, "lock installs in a git repo");

    // A commit by the agent must be aborted by the reference-transaction hook.
    fs.writeFileSync(path.join(dir, "b.txt"), "b");
    run(["add", "b.txt"]);
    const blockedCommit = run(["commit", "-q", "-m", "agent change"]);
    if (!supported) {
      removeRefTransactionLock(dir);
      return;
    }
    assert.notEqual(blockedCommit.status, 0, "agent commit is aborted by the hook");
    assert.equal(run(["rev-parse", "HEAD"]).stdout.trim(), headBefore, "HEAD must not move when the agent commits");

    // With the lock removed, the pipeline's own writes proceed normally.
    removeRefTransactionLock(dir);
    const allowedCommit = run(["commit", "-q", "-m", "agent change allowed"]);
    assert.equal(allowedCommit.status, 0, "commit is allowed once the lock is removed");
    const headAfter = run(["rev-parse", "HEAD"]).stdout.trim();
    assert.notEqual(headAfter, headBefore, "HEAD moves after lock removal");

    // Re-locking also blocks a branch-creating checkout.
    assert.equal(installRefTransactionLock(dir), true);
    run(["checkout", "-q", "-b", "agent-branch"]);
    assert.notEqual(run(["rev-parse", "--verify", "agent-branch"]).status, 0, "agent checkout/branch is blocked");
    assert.equal(run(["rev-parse", "HEAD"]).stdout.trim(), headAfter, "HEAD unchanged after blocked checkout");
  } finally {
    removeRefTransactionLock(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseCheckResult marks a totals-less report as unverified, not passed", () => {
  // Hand-authored prose with no PASS=/FAIL=/SKIP= tokens at all.
  const prose = parseCheckResult(null, "# Test report\n\nAll cases behaved as expected.\n");
  assert.equal(prose.verdict, "unverified");
  assert.deepEqual([prose.pass, prose.fail, prose.skip], [0, 0, 0]);
  // An explicit (even all-zero) totals line is still a real result.
  assert.equal(parseCheckResult(null, "PASS=0 FAIL=0 SKIP=0").verdict, "passed");
  assert.equal(parseCheckResult(null, "Totals: PASS=2 FAIL=0 SKIP=1").verdict, "passed_with_blocked");
  // A parsed JSON body without totals and without cases is not evidence of a run.
  assert.equal(parseCheckResult("{}", "").verdict, "unverified");
  assert.equal(parseCheckResult('{"totals":{"pass":1,"fail":0,"skip":0}}', "").verdict, "passed");
});

test("runner records the agent pid and removes it on exit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-pid-"));
  const prompt = path.join(dir, "prompt.md");
  const script = path.join(dir, "agent.mjs");
  fs.writeFileSync(prompt, "stage prompt");
  fs.writeFileSync(script, "setTimeout(() => {}, 1500);\n");
  const pidFile = path.join(dir, "agent.pid");
  const agent = runAgent({
    command: [process.execPath, script],
    cwd: dir,
    promptFile: prompt,
    logFile: path.join(dir, "agent.log"),
    pidFile,
  });
  // The pid file appears while the agent is alive...
  let sawPid = false;
  for (let i = 0; i < 100 && !sawPid; i += 1) {
    if (fs.existsSync(pidFile)) {
      sawPid = true;
      assert.match(fs.readFileSync(pidFile, "utf8"), /^\d+$/);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(sawPid, true);
  await agent;
  // ...and is gone once the agent exits.
  assert.equal(fs.existsSync(pidFile), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fallback markdown escapes ticket HTML before rendering", () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  const html = renderFallbackMarkdown("# Title\n\n<script>alert(1)</script>\n\n- **bold** item");
  assert.ok(!html.includes("<script>"), "raw <script> must never reach the DOM");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<b>bold<\/b>/);
});

test("writeState bumps rev monotonically and refuses a stale write", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-rev-"));
  try {
    writeState(dir, createState("SZ1", "/wt", "abc"));
    assert.equal(readState(dir).rev, 1);
    // A second writer that still holds the rev-0 snapshot...
    const stale = createState("SZ1", "/wt", "abc");
    assert.throws(() => writeState(dir, stale), (err: unknown) => err instanceof ConcurrentStateError);
    assert.equal(readState(dir).rev, 1, "the refused write applies nothing");
    // ...while a fresh view still writes fine.
    const fresh = readState(dir);
    fresh.error = "updated";
    writeState(dir, fresh);
    assert.equal(readState(dir).rev, 2);
    assert.equal(readState(dir).error, "updated");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("withStateUpdate retries a concurrent write and keeps both updates", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-rev-"));
  try {
    writeState(dir, createState("SZ1", "/wt", "abc"));
    let attempts = 0;
    await withStateUpdate(dir, (state) => {
      attempts += 1;
      if (attempts === 1) {
        // Emulate a one-shot concurrent writer: bump the on-disk rev past
        // this snapshot's rev, so the write at the end of attempt 1 is
        // refused and retried against a fresh snapshot.
        const concurrent = readState(dir);
        concurrent.error = "concurrent writer";
        writeState(dir, concurrent);
      }
      state.error = `our update (attempt ${attempts})`;
    });
    assert.equal(attempts, 2, "the first attempt is refused and retried");
    const final = readState(dir);
    assert.equal(final.error, "our update (attempt 2)");
    assert.equal(final.rev, 3, "both writers' updates are kept");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("withStateUpdate rethrows StateConflictError without retrying", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-rev-"));
  let attempts = 0;
  try {
    const base = createState("SZ1", "/wt", "abc");
    writeState(dir, base);
    await assert.rejects(
      withStateUpdate(dir, () => {
        attempts += 1;
        throw new StateConflictError("no longer awaiting review");
      }),
      (err: unknown) => err instanceof StateConflictError,
    );
    assert.equal(attempts, 1, "a semantic conflict is not a retry");
    assert.equal(readState(dir).rev, 1, "the state is untouched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// G14: watchdog, overreach guard, stream cache, CSRF, rate limit
// ---------------------------------------------------------------------------

test("the run watchdog stops the recorded agent after maxMinutes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-watchdog-"));
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 250)); // let the child settle
    fs.writeFileSync(path.join(dir, "agent.pid"), String(child.pid));
    const timers = t.mock.timers;
    timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      const disarm = armRunWatchdog(dir, { run: { maxMinutes: 1 } } as AiFlowConfig, () => undefined);
      timers.tick(60_000); // watchdog fires: stopAgent SIGTERMs the agent, then waits
      timers.tick(1_100); // the SIGTERM grace window inside stopAgent
      disarm();
    } finally {
      timers.reset();
    }
    // Real-time wait for the exit to be observed.
    for (let i = 0; i < 150 && !exited; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(exited, true, "the recorded agent must be killed by the watchdog");
  } finally {
    if (!exited) child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the run watchdog is disabled by maxMinutes 0", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-watchdog0-"));
  try {
    const timers = t.mock.timers;
    timers.enable({ apis: ["setTimeout", "setInterval"] });
    try {
      const disarm = armRunWatchdog(dir, { run: { maxMinutes: 0 } } as AiFlowConfig, () => undefined);
      timers.tick(24 * 60 * 60_000); // a whole day: nothing may be scheduled
      disarm();
    } finally {
      timers.reset();
    }
    assert.ok(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the overreach guard fails a run whose MCP config or HEAD moved", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-overreach-"));
  const git = (args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git(["init"]);
    fs.writeFileSync(path.join(root, "f.txt"), "x\n");
    git(["add", "."]);
    git(["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-m", "init"]);
    const head = git(["rev-parse", "HEAD"]);
    // A zcode project-scope MCP config file (the descriptor shape the
    // pipeline fingerprints).
    const mcpFile = path.join(root, ".zcode", "config.json");
    fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
    const original = JSON.stringify({ mcp: { servers: { softzilla: { command: "npx" } } } }, null, 2) + "\n";
    fs.writeFileSync(mcpFile, original);
    const fingerprint = fileFingerprint(mcpFile);
    assert.match(fingerprint, /^sha256:/);
    const context = { skillDir: "/skills", id: "SZ1", workspace: root };
    const state = {
      baseCommit: head,
      szdev: { mode: "standard" },
      mcpHashes: { [mcpFile]: fingerprint },
    } as unknown as RunState;
    // Unchanged tree + unchanged MCP config: no overreach.
    assert.doesNotThrow(() => assertNoAgentOverreach(state, context));
    // The agent edited its own MCP config: caught.
    fs.writeFileSync(mcpFile, JSON.stringify({ mcp: { servers: {} } }, null, 2) + "\n");
    assert.throws(() => assertNoAgentOverreach(state, context), /MCP config changed/);
    // Config restored, but HEAD moved (the agent committed): caught.
    fs.writeFileSync(mcpFile, original);
    git(["-c", "user.email=a@b", "-c", "user.name=a", "commit", "--allow-empty", "-m", "agent commit"]);
    assert.throws(() => assertNoAgentOverreach(state, context), /HEAD moved/);
    // A file that was absent at run start and appears mid-run: caught.
    const ghost = path.join(root, ".zcode", "ghost.json");
    const ghostState = {
      baseCommit: git(["rev-parse", "HEAD"]),
      szdev: { mode: "standard" },
      mcpHashes: { [ghost]: "absent" },
    } as unknown as RunState;
    assert.doesNotThrow(() => assertNoAgentOverreach(ghostState, context));
    fs.writeFileSync(ghost, "{}\n");
    assert.throws(() => assertNoAgentOverreach(ghostState, context), /MCP config changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** The full-read reference parse: what a non-incremental reader would return. */
function fullParseStream(file: string): string {
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line && !line.includes('"type":"session.updated"'));
  const formatter = createStreamFormatter();
  const out: string[] = [];
  for (const line of lines) out.push(...formatter.push(line));
  out.push(...formatter.finish());
  return out.join("\n");
}

/** One zcode stream-json line that yields exactly one collected event. */
const TURN_START = '{"type":"turn.started","payload":{"input":"phase 2"}}';
const TURN_DONE = '{"type":"turn.completed","payload":{"response":"ok","usage":{"totalTokens":42}}}';

test("the stream cache parses incrementally, skips partial lines, and resets on shrink", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-streamcache-"));
  const file = path.join(dir, "phase2.log");
  try {
    // Drop this path first so a sibling test cannot leak a cached entry.
    dropStreamCache(file);
    // First read: full parse of one event.
    fs.writeFileSync(file, TURN_START + "\n");
    const first = readStreamLog(file);
    assert.equal(first.exists, true);
    assert.equal(first.reset, true);
    assert.equal(first.events.length, 1);
    assert.equal(first.content, fullParseStream(file));

    // Append: only the new line is consumed; output equals a full parse.
    fs.appendFileSync(file, TURN_DONE + "\n");
    const second = readStreamLog(file);
    assert.equal(second.reset, false);
    assert.equal(second.events.length, 2);
    assert.equal(second.content, fullParseStream(file));

    // A final line without a trailing newline is not consumed yet.
    fs.appendFileSync(file, TURN_START.slice(0, 20));
    const third = readStreamLog(file);
    assert.equal(third.events.length, 2, "a growing final line must not be parsed");
    // The line completes (plus a bookkeeping line that must be filtered).
    fs.appendFileSync(file, TURN_START.slice(20) + "\n" + '{"type":"session.updated","session":"abc"}\n');
    const fourth = readStreamLog(file);
    assert.equal(fourth.events.length, 3);
    assert.equal(fourth.content, fullParseStream(file));
    assert.ok(!fourth.content.includes("session.updated"));

    // Shrink: the append-only contract broke - force a full re-parse.
    fs.writeFileSync(file, TURN_START + "\n");
    const fifth = readStreamLog(file);
    assert.equal(fifth.reset, true);
    assert.equal(fifth.events.length, 1);
    assert.equal(fifth.content, fullParseStream(file));

    // A missing file clears its cache entry and reports exists:false.
    fs.rmSync(file);
    const missing = readStreamLog(file);
    assert.equal(missing.exists, false);
    assert.equal(missing.events.length, 0);
  } finally {
    dropStreamCache(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fakeRequest(method: string, headers: Record<string, string>): http.IncomingMessage {
  return { method, headers } as unknown as http.IncomingMessage;
}

function fakeResponse(): { response: http.ServerResponse; status: number | null; body: string | null } {
  const out = { response: undefined as unknown as http.ServerResponse, status: null as number | null, body: null as string | null };
  out.response = {
    writeHead(status: number): void {
      out.status = status;
    },
    end(chunk?: string): void {
      out.body = chunk ?? null;
    },
  } as unknown as http.ServerResponse;
  return out;
}

test("the CSRF guard allows same-origin and origin-less, rejects cross-origin", () => {
  const ok: Array<[string, Record<string, string> | undefined]> = [
    // curl / CLI: no Origin at all.
    ["POST", undefined],
    // The UI's own origin.
    ["POST", { origin: "http://127.0.0.1:4173", host: "127.0.0.1:4173" }],
    // Default ports: https origin vs a Host header without a port.
    ["DELETE", { origin: "https://viewer.local", host: "viewer.local" }],
    // A read is not mutating: cross-origin is fine for GET.
    ["GET", { origin: "http://evil.example", host: "127.0.0.1:4173" }],
  ];
  for (const [method, headers] of ok) {
    assert.equal(checkCsrf(fakeRequest(method, headers ?? {}), fakeResponse().response), true, `${method} ${JSON.stringify(headers)}`);
  }
  const denied: Array<[string, Record<string, string>]> = [
    // A LAN page driving the viewer.
    ["POST", { origin: "http://evil.example", host: "127.0.0.1:4173" }],
    // Same host, wrong port.
    ["POST", { origin: "http://127.0.0.1:9999", host: "127.0.0.1:4173" }],
    // Unparseable Origin.
    ["PUT", { origin: "not a url", host: "127.0.0.1:4173" }],
    // A non-web Origin protocol (file://) naming the same host is rejected
    // by the protocol check, not by the host comparison.
    ["POST", { origin: "file:///127.0.0.1", host: "127.0.0.1:4173" }],
    // Mutating request without a Host header cannot be verified.
    ["DELETE", { origin: "http://127.0.0.1:4173" }],
  ];
  for (const [method, headers] of denied) {
    assert.equal(checkCsrf(fakeRequest(method, headers), fakeResponse().response), false, `${method} ${JSON.stringify(headers)}`);
  }
});

test("the rate limiter allows the ceiling, then 429s until the window drains", () => {
  const limiter = new RateLimiter(5);
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.allow("10.0.0.1"), true, `request ${i + 1}`);
  assert.equal(limiter.allow("10.0.0.1"), false, "the 6th request in the window is limited");
  // A different client is unaffected.
  assert.equal(limiter.allow("10.0.0.2"), true);
  // A disabled ceiling (0) never limits.
  const open = new RateLimiter(0);
  for (let i = 0; i < 20; i += 1) assert.equal(open.allow("10.0.0.1"), true);
  // rejectIfLimited wires the 429 to the response.
  const wire = new RateLimiter(1);
  const request = { socket: { remoteAddress: "10.0.0.9" } } as unknown as http.IncomingMessage;
  assert.equal(rejectIfLimited(wire, request, fakeResponse().response), false, "first request passes");
  const limited = fakeResponse();
  assert.equal(rejectIfLimited(wire, request, limited.response), true, "second request is rejected");
  assert.equal(limited.status, 429);
  assert.match(limited.body ?? "", /Too many requests/);
});

function initFixCommitFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiflow-fixcommit-"));
  const git = (args: string[]): string => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout;
  };
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "test"]);
  return dir;
}

function fixtureCommit(dir: string, file: string, subject: string, body = ""): string {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), "change\n");
  const add = spawnSync("git", ["-C", dir, "add", "-A"], { encoding: "utf8" });
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const message = body ? `${subject}\n\n${body}` : subject;
  const result = spawnSync("git", ["-C", dir, "commit", "-q", "-m", message], { encoding: "utf8" });
  assert.equal(result.status, 0, `git commit failed: ${result.stderr}`);
  return spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
}

test("findFixCommit picks the first landed content commit, never a harness mention", () => {
  const dir = initFixCommitFixture();
  try {
    // The SZ's real fix: subject mentions the SZ (check-in convention), touches cql/.
    const fix = fixtureCommit(dir, "cql/lisp/hl7bcma.scm", "Checked in from server:eec26a; Checked in by:shengli; SZ424242. [DSS]hl7bcma.scm needs to deal with RXA-7");
    // An older subject-mentioning content commit for a second SZ.
    const older = fixtureCommit(dir, "cql/old.scm", "SZ424243 first landing of the fix");
    // Newer harness commit: body mentions SZ424242 — must not shadow the real fix.
    fixtureCommit(dir, "ai-flow/src/szdev.ts", "ai-flow: viewer polish", "- sz-dev: updates from the SZ424242 replay sessions");
    // Newer content commit whose subject mentions SZ424243 — oldest still wins.
    fixtureCommit(dir, "cql/new.scm", "SZ424243 follow-up touching the same SZ");
    // Harness-only subject mention: not a fix for any SZ.
    fixtureCommit(dir, "ai-flow/src/other.ts", "ai-flow: SZ424245 harness support");
    // Content commit whose body-only mention must never qualify.
    fixtureCommit(dir, "cql/unrelated.scm", "cql: unrelated work", "see SZ424244 notes");

    assert.equal(findFixCommit(dir, "SZ424242"), fix, "a newer harness body mention must not shadow the real fix");
    assert.equal(findFixCommit(dir, "SZ424243"), older, "the oldest content-touching subject mention wins");
    assert.equal(findFixCommit(dir, "SZ424244"), null, "a body-only mention on a content commit never qualifies");
    assert.equal(findFixCommit(dir, "SZ424245"), null, "a harness-only subject mention never qualifies");
    assert.equal(findFixCommit(dir, "SZ999999"), null, "an unknown SZ has no fix commit");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The exact shape of the SZ34445 incident: the real fix lands, a later merge
// carries it forward, and the NEWEST commit mentioning the SZ is a harness
// commit that references the ticket only in its body. The anchor must be the
// real fix — and its parent (not the merge) is the pre-fix baseline.
test("findFixCommit survives the incident shape (merge parent + newest harness body mention)", () => {
  const dir = initFixCommitFixture();
  try {
    const a0 = fixtureCommit(dir, "cql/a.scm", "unrelated baseline work");
    const fix = fixtureCommit(dir, "cql/b.scm", "SZ424246 - RadioView Report CQL crash when MRN not found");
    fixtureCommit(dir, "cql/m.scm", "Merge branch 'ee-branch-ai' into cql-auto-dev-1.0.0");
    fixtureCommit(dir, "ai-flow/src/runner.ts", "ai-flow: fix test verdict parse + init config path, viewer/sz-replay tweaks", "(fixes false 'Failed' on SZ424246)");

    assert.equal(findFixCommit(dir, "SZ424246"), fix, "the newest harness body mention (on top of a merge) must not shadow the real fix");
    // findFixChild re-derives the fix from the (possibly re-baselined) baseline.
    assert.equal(findFixChild(dir, "SZ424246", a0), fix, "the fix is the direct content child of the correct pre-fix baseline");
    assert.equal(findFixChild(dir, "SZ424246", fix), null, "a child of the fix (the merge) is not itself the fix");
    assert.equal(findFixChild(dir, "SZ424247", a0), null, "no matching child means no fix for this SZ");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseProgress exposes the replay base meta line", () => {
  assert.equal(parseProgress("phase: 1\nmode: file\nbase: fc0fd30d476cdc13e4e13f1070aeec8f675b4f8f\nawaiting:\n").base, "fc0fd30d476cdc13e4e13f1070aeec8f675b4f8f");
  assert.equal(parseProgress("phase: 1\n").base, undefined, "absent base stays undefined");
});

test("replay registry meta read/write preserves the tool-managed lines", () => {
  const prev = process.env.SZ_WORKSPACE_REGISTRY;
  const reg = fs.mkdtempSync(path.join(os.tmpdir(), "aiflow-registry-"));
  process.env.SZ_WORKSPACE_REGISTRY = reg;
  const ctx: SzdevContext = { skillDir: "/skills", id: "SZ34445", workspace: "/w" };
  try {
    assert.equal(readReplayMeta(ctx), null, "no entry before init");
    writeReplayMeta(ctx, { fix: "aa806e32", baseline: "af725be8" });
    let meta = readReplayMeta(ctx);
    assert.ok(meta && meta.fix === "aa806e32" && meta.baseline === "af725be8");
    // A tool-written entry also carries repo=/root=; adopting a re-baseline
    // must update only fix=/baseline= and keep the rest byte-for-byte.
    fs.writeFileSync(path.join(reg, "replay-SZ34445.meta"), "fix=aa806e32\nbaseline=af725be8\nrepo=/w/ccsrc\nroot=/proj\n", "utf8");
    writeReplayMeta(ctx, { fix: "d9d7fc78", baseline: "fc0fd30d" });
    meta = readReplayMeta(ctx);
    assert.ok(meta && meta.fix === "d9d7fc78" && meta.baseline === "fc0fd30d" && meta.repo === "/w/ccsrc" && meta.root === "/proj");
  } finally {
    if (prev === undefined) delete process.env.SZ_WORKSPACE_REGISTRY;
    else process.env.SZ_WORKSPACE_REGISTRY = prev;
    fs.rmSync(reg, { recursive: true, force: true });
  }
});

test("summary flags generic-pack runs (no scope guard)", () => {
  const base = (over: Partial<RunState>): RunState => ({
    id: "SZ1",
    status: "running",
    stage: "phase1",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    worktree: "/w",
    baseCommit: "abc",
    stages: {} as never,
    artifacts: {},
    szdev: { mode: "standard", workspace: "/w" },
    error: null,
    ...over,
  });
  assert.equal(summary(base({})).genericPack, false, "no recorded pack means the cql default, which has an adapter");
  assert.equal(summary(base({ szdev: { mode: "standard", workspace: "/w", pack: "cql" } })).genericPack, false);
  assert.equal(summary(base({ szdev: { mode: "standard", workspace: "/w", pack: "claim" } })).genericPack, false);
  assert.equal(summary(base({ szdev: { mode: "standard", workspace: "/w", pack: "somefuturepack" } })).genericPack, true, "an unadapted pack must be flagged");
});

// ---------------------------------------------------------------------------
// Stop: leaked ref-lock hook, process-group kill
// ---------------------------------------------------------------------------

test("stopPipeline removes the leaked git ref-lock hook from the run's workspace", async () => {
  // Regression: the orchestrator installs the reference-transaction hook
  // around each agent phase and removes it in a finally block. A pipeline
  // killed with SIGKILL never reaches that finally, and the leaked hook
  // then blocked the operator's own manual commits in the workspace.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-stop-reflock-"));
  const git = (args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git(["init", "-q"]);
    fs.writeFileSync(path.join(root, "a.txt"), "a");
    git(["add", "."]);
    git(["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "-m", "base"]);
    // A pre-existing user hook that a clean stop must restore byte-for-byte.
    const hooksDir = path.resolve(root, git(["rev-parse", "--git-dir"]), "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "reference-transaction");
    const userHook = "#!/bin/sh\n# user hook\nexit 0\n";
    fs.writeFileSync(hookPath, userHook);

    const runDir = path.join(root, ".ai-flow", "runs", "SZ77999");
    fs.mkdirSync(runDir, { recursive: true });
    writeState(runDir, {
      ...createState("SZ77999", root, "x"),
      szdev: { mode: "standard", workspace: root, gates: {} },
    });
    // Simulate a pipeline that died mid-phase (its finally never ran).
    assert.equal(installRefTransactionLock(root), true);
    assert.match(fs.readFileSync(hookPath, "utf8"), /ai-flow reference-transaction ref lock/);

    // The command has no {cwd} token, so the only pkill pattern is the
    // ticket-anchored CLI one — it cannot match this test process.
    await stopPipeline(runDir, { runner: { command: ["fake-agent-never-alive", "{promptFile}"] } }, "SZ77999");

    assert.equal(fs.readFileSync(hookPath, "utf8"), userHook, "the user hook is restored byte-for-byte");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stopAgent kills the agent's whole process group, not just its pid", async () => {
  // Regression: the runner spawns the agent detached (own process group),
  // so stop must signal the group — a bare pid kill leaves the agent's own
  // children (a test harness, a linter) running in the workspace.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-stopgroup-"));
  const grandFile = path.join(dir, "grandchild.pid");
  // A fake agent script, run as `bash <script>` (as the runner spawns the
  // configured command): it starts a grandchild a bare pid kill would not
  // reach, then keeps running. It is a script FILE (not `bash -c`) with a
  // trailing `exit 0`, because bash execs a -c script's last command in
  // place — which would replace the agent's cmdline and break the
  // cmdline-verified pid check. A cold spawn under load can take a while,
  // so the grandchild file is polled instead of using a fixed sleep.
  const script = path.join(dir, "agent.sh");
  fs.writeFileSync(script, `sleep 300 &\necho $! > ${grandFile}\nsleep 300\nexit 0\n`);
  const child = spawn("bash", [script], { stdio: "ignore", detached: true });
  try {
    const pid = child.pid;
    assert.ok(pid, "the fake agent has a pid");
    let grandchild = 0;
    for (let i = 0; i < 50; i += 1) {
      if (fs.existsSync(grandFile)) {
        grandchild = Number(fs.readFileSync(grandFile, "utf8").trim());
        if (grandchild > 0) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(grandchild > 0, "the fake agent started its grandchild");

    fs.writeFileSync(path.join(dir, "agent.pid"), String(pid));
    const outcome = await stopAgent(dir, { runner: { command: ["bash", "-c", "x"] } });
    assert.equal(outcome.killed, true);

    for (let i = 0; i < 50 && isProcessAlive(grandchild); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(isProcessAlive(grandchild), false, "the grandchild must die with the agent's process group");
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Viewer: start-log disk error, createRun window
// ---------------------------------------------------------------------------

test("a start-log disk error does not back-pressure the detached pipeline", async () => {
  // Regression: the start log's write-stream error handler used to swallow
  // the error while the pipe kept flowing into a dead stream — back-pressure
  // stalled the pipeline's stdout once the pipe buffer filled, hanging a run
  // whose log path happened to be a directory (or the disk filled).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-startlog-err-"));
  // Pre-create the log path as a DIRECTORY: the write stream fails on open
  // (EISDIR), the exact failure mode a colliding path or corrupt logs dir hits.
  const logPath = path.join(dir, "start-SZ1.log");
  fs.mkdirSync(logPath);
  // The child must write well past the pipe buffer: without the fix it would
  // stall on the full pipe and never reach the final exit(0).
  const child = spawn(
    process.execPath,
    [
      "-e",
      "let n = 0; const iv = setInterval(() => { process.stdout.write('x'.repeat(65536)); if (++n >= 50) { clearInterval(iv); process.exit(0); } }, 5);",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr?.resume();
  wireStartLog(child, logPath);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the child stalled on a broken start log (backpressure)")), 15000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`the child exited ${code}`));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("createRun waits the longer window while a recorded pipeline pid is alive", async () => {
  // With a recorded LIVE pid the window is START_WAIT_MS_WITH_PID (a slow
  // preflight is normal); with no pid it stays START_WAIT_MS. A dead pid
  // still short-circuits immediately. The env override keeps this fast.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-ui-livewait-"));
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  const prevWithPid = process.env.AI_FLOW_START_WAIT_MS_WITH_PID;
  process.env.AI_FLOW_START_WAIT_MS_WITH_PID = "1200";
  let server: http.Server | undefined;
  try {
    server = await startUi(root, "127.0.0.1", 0, {
      startRun: (_repoRoot, id) => {
        const logDir = path.join(_repoRoot, ".ai-flow", "logs");
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(path.join(logDir, `start-${id}.pgid`), String(child.pid ?? 1));
      },
    });
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    const startedAt = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "SZ88442" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; started: boolean; error?: string };
    assert.equal(body.started, false);
    // No pid-dead wording (the pid is alive) — the "still starting" message
    // after the live window, which is longer than the 500ms no-pid default.
    assert.match(body.error ?? "", /may still be starting/);
    assert.ok(Date.now() - startedAt >= 1000, "the live-pid window must be waited out");
  } finally {
    if (prevWithPid === undefined) delete process.env.AI_FLOW_START_WAIT_MS_WITH_PID;
    else process.env.AI_FLOW_START_WAIT_MS_WITH_PID = prevWithPid;
    if (child.pid) process.kill(child.pid);
    const closingServer = server;
    if (closingServer) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 2000);
        closingServer.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// init: runner customization survives re-init
// ---------------------------------------------------------------------------

test("init preserves a legacy custom runner.command and user-set runner fields across re-init", async () => {
  // Regression: re-running init rebuilt the file from the preset and silently
  // dropped a legacy (pre-agent) hand-tuned command and the user's modelFlag /
  // modelsCommand / statusCommand / versionCheck.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-legacy-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-home-"));
  try {
    // A legacy file: no `agent` (pre-agent shape), a hand-tuned command.
    fs.writeFileSync(
      path.join(root, "ai-flow.config.json"),
      JSON.stringify({
        runner: {
          command: ["myagent", "--flag", "{promptStdin}"],
          modelFlag: "--model-id",
          modelsCommand: ["myagent", "models"],
          statusCommand: ["stat.sh", "{dir}"],
          versionCheck: "^1\\.",
        },
        ui: { host: "127.0.0.1", port: 4190 },
        szdev: { pack: "claim" },
      }),
    );
    const lines: string[] = [];
    const result = await runInit({
      repoRoot: root,
      agent: "deepseek",
      model: "deepseek-v4",
      yes: true,
      installed: () => false,
      // Hermetic resolution: no PATH, empty HOME — dsh cannot be found.
      env: { ...process.env, HOME: home, PATH: "" },
      log: (line) => lines.push(line),
    });
    const written = JSON.parse(fs.readFileSync(result.file, "utf8")) as {
      agent: string;
      model: string;
      runner: { command: string[]; modelFlag: string; modelsCommand: string[]; statusCommand: string[]; versionCheck: string };
      ui: { port: number };
      szdev: { pack: string };
    };
    assert.deepEqual(written.runner.command, ["myagent", "--flag", "{promptStdin}"], "the custom command survives re-init");
    assert.equal(written.runner.modelFlag, "--model-id");
    assert.deepEqual(written.runner.modelsCommand, ["myagent", "models"]);
    assert.deepEqual(written.runner.statusCommand, ["stat.sh", "{dir}"]);
    assert.equal(written.runner.versionCheck, "^1\\.");
    assert.equal(written.agent, "deepseek");
    assert.equal(written.model, "deepseek-v4");
    assert.equal(written.ui.port, 4190);
    assert.equal(written.szdev.pack, "claim");
    assert.match(lines.join("\n"), /Kept the existing custom runner\.command/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("init refreshes an unchanged preset command on re-init and never keeps a previous agent's command", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-refresh-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-flow-init-home-"));
  // Hermetic zcode install: a fake desktop binCandidate under a temp HOME.
  const agentDir = path.join(home, ".zcode", "server", "agents", "glm");
  fs.mkdirSync(agentDir, { recursive: true });
  const agentBinPath = path.join(agentDir, "zcode-agent");
  fs.writeFileSync(agentBinPath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(agentBinPath, 0o755);
  const init = async (agent: string): Promise<string> => {
    const result = await runInit({
      repoRoot: root,
      agent,
      model: "",
      yes: true,
      installed: () => false,
      env: { ...process.env, HOME: home, PATH: "" },
      log: () => undefined,
    });
    return fs.readFileSync(result.file, "utf8");
  };
  const read = (text: string): { agent: string; runner: { command: string[] } } => JSON.parse(text) as {
    agent: string;
    runner: { command: string[] };
  };
  try {
    // First init writes the resolved zcode command (absolute bin path).
    const first = read(await init("zcode"));
    const resolved = first.runner.command;
    assert.equal(path.basename(resolved[0]), "zcode-agent", "the bin resolves to the hermetic candidate");
    assert.ok(resolved[0].startsWith("/"), "the resolved command carries an absolute bin path");

    // Same agent, untouched command: re-init keeps it (bin path may move,
    // so the comparison ignores the bin path itself).
    const second = read(await init("zcode"));
    assert.deepEqual(second.runner.command, resolved, "an unchanged preset command stays the resolved one");

    // Same agent, a hand-tuned tweak: the tweak survives the re-init.
    const tweaked = JSON.parse(JSON.stringify(first));
    tweaked.runner.command = [resolved[0], "--extra", ...resolved.slice(1)];
    fs.writeFileSync(path.join(root, "ai-flow.config.json"), JSON.stringify(tweaked, null, 2));
    const third = read(await init("zcode"));
    assert.deepEqual(third.runner.command, tweaked.runner.command, "a customized command survives the re-init");

    // A DIFFERENT previous agent's command is never carried over: the new
    // preset owns the invocation.
    const stale = JSON.parse(JSON.stringify(first));
    stale.agent = "deepseek";
    stale.runner.command = ["dsh", "--profile", "headless", "{promptArg}"];
    fs.writeFileSync(path.join(root, "ai-flow.config.json"), JSON.stringify(stale, null, 2));
    const fourth = read(await init("zcode"));
    assert.deepEqual(fourth.runner.command, resolved, "switching agents replaces the stale previous command");
    assert.equal(fourth.agent, "zcode");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
