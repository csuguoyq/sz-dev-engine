# Integrating sz-dev into ai-flow — Record, Problems, and Playbook

This document records how `skills/sz-dev` was integrated into the `ai-flow`
pipeline, every problem found during the real-ticket validation (SZ22052,
SZ30349, SZ34595), the fixes applied, and a step-by-step playbook so the
integration can be re-executed (or re-done for a new module) without repeating
the detours. Current code is the reference; where this document and the code
disagree, the code wins. `ai-flow/AGENTS.md` is the short architecture
companion; this file is the long-form history and how-to.

---

## 1. Architecture decision

**ai-flow is the driver; sz-dev is the state machine and knowledge source.**

- The single source of truth for run state is sz-dev's `sz-progress`
  (`.sz-dev/SZxxxx/progress.md`). ai-flow's `state.json` is only a render
  mirror for the viewer and for fast resume.
- ai-flow does not re-implement the sz-dev workflow. Its stages map onto
  sz-dev phases, and the agent's execution specification for each stage is
  the corresponding `skills/sz-dev/workflows/phaseN-*.md`, referenced by
  absolute path inside the stage prompt.
- The agent may run `sz-progress bump/awaiting/note` but never
  `set phase` / `set gate` — only the orchestrator advances phases and
  passes gates (gate 4 by the human via the viewer).

Stage mapping (types.ts `STAGES`):

| ai-flow stage | sz-dev meaning | gate |
|---|---|---|
| `workspace` | Phase 0: `sz-workspace ensure` (+ `sz-replay init` when MODE=replay) | — |
| `phase1` | Requirement: ticket cache, pack selection, routing, repro | gate 1 auto-passed on evidence |
| `phase2` | Implementation: plan, code, pack check, self+independent review | gate 2 auto-passed |
| `phase3` | Testing: case set, machine review, accept execution, report | gate 3 auto-passed |
| `phase4` | Deliverables + delivery tarball | — |
| `review` | Gate 4 — the only human checkpoint | approve sets gate 4 passed |

Gate semantics: gates 1-3 are automation milestones — `sz-progress set gate N
passed` enforces the evidence files itself, the orchestrator just calls it
after verifying the same files. Gate 4 is human-only (viewer Approve).
Open escalations (`awaiting: E1-E7`) pause the run as `awaiting_review` with
`state.awaiting.kind = "clarification"` (E1) or `"escalation"`; the human's
answer becomes `state.rework` on the current phase and is injected into that
phase's prompt on resume.

---

## 2. What was built (final layout)

```
ai-flow/src/
  szdev.ts        typed wrappers over sz-workspace/sz-progress/sz-replay,
                  output parsers (pure functions), pack capability-table parser
  orchestrator.ts stage order, gate evidence checks, state.json mirror,
                  delivery packaging, escalation pause/resume
  prompts.ts      phase1-4 prompts (each names its workflow file), COMMON hard
                  rules, skillDirFor() (prefer workspace-seeded skills)
  runner.ts       spawns the configured command (runner.command); {promptStdin}
                  placeholder feeds the prompt via stdin; optional model via
                  runner.modelFlag (default -m) or a {model} token
  package.ts      tar.gz to ~/sz/SZxxxx_<Beijing timestamp>.tar.gz
  reset.ts        `ai-flow reset SZxxxx` — wipes run record, sz-dev state,
                  replay tree (keeps workspace clone + registry mode)
  adapters/index.ts  ModuleAdapter contract (scope guards, pack check,
                  snapshot) + cql implementation
  viewer/server.ts   /api/runs, /api/runs/<SZ>/logs/<stage> (live log),
                  /api/agent-status (session status from runner.statusCommand),
                  /api/models (from runner.modelsCommand), stop/delete/review
                  (gate4 + escalation)
viewer-ui/        React page: stages-with-timestamps navigation, docs tabs,
                  Deliverables tab (state dir + ~/sz TC wiki), Live log with
                  wheel-intent auto-scroll, EHR theme, bottom status bar
```

Key invariants to preserve when touching any of this:

1. **Only `sz-progress` writes phase/gate state.** Orchestrator sets phases
   and gates 1-3; the viewer sets gate 4. Never `--force`.
2. **The gate-2 patch is snapshotted by the orchestrator** at gate-2 time
   (replay mode: verbatim `sz-replay diff` output; standard: the adapter's
   reviewed surface — product code, module test area excluded). Any later
   code change fails phase 3's snapshot check or phase 4's `sz-replay
   verify` (replay) / byte-compare against the trusted run-dir copy
   `gate2-reviewed.patch` (standard), forcing rework. A legacy full-tree
   `gate2-reviewed.patch` (older ai-flow version) is automatically
   narrowed to its product sections before the compare. Do not let the
   agent manage that file.
3. **`.sz-dev/` and `skills/` are pipeline runtime**, never part of a
   change set, never packaged, invisible to scope guards (git.ts
   `ignoredByCheck`).
4. **Generated `test-reports/` never enter changed-paths.txt or the
   delivery**; the orchestrator archives them into the run dir before
   `sz-replay verify`.
5. Nothing outside the agent's working directory is referenced by prompts
   (see problem P2 below for why).

---

## 3. Playbook: re-executing the integration

Assumes `ai-flow/` (old 7-stage fetch/analyze/… pipeline) and
`skills/sz-dev/` both exist, as at commit `95a942859c`.

### Step 1 — Stage model and state mirror

1. Rewrite `types.ts`: `STAGES = ["workspace","phase1","phase2","phase3",
   "phase4","review"]`; `REWORK_STAGES = phase1..phase4`; add
   `SzdevMirror` (mode, workspace, pack, replayDir, baseline/fixCommit,
   phase, gates, awaiting) and `model?: string` to `RunState`; add
   `Awaiting { kind: gate4|clarification|escalation }`; add config
   `szdev: { skillDir?, workspaceRoot?, pack? }`.
2. `store.ts createState` seeds `szdev: { mode: "standard", gates: {} }`.

### Step 2 — Control-plane wrapper (`szdev.ts`)

Implement against the tools' documented output contracts (verified by
reading the bash sources — do not guess):

- `sz-workspace ensure` prints `MODE=<standard|replay>`, optional
  `BRANCH=`, mandatory final `WORKSPACE=<path>`.
- `sz-replay init <SZ> <fix-commit>` prints `REPLAY_DIR=`, `SZ_DEV_DIR=`,
  `BASELINE_COMMIT=`, `FIX_COMMIT=`, optional `COPIED=`.
- `sz-progress show` prints `state root: …` then progress.md
  (`phase:`, `gate1..4:`, `awaiting:`, `notes:` list) — parse `key: value`.
- `sz-replay package` reports the archive as **`package: <path>` on
  stderr** (its `log()`), followed by `tar -tzf` listing on stdout. Parse
  both streams.
- The fix commit for replay mode is resolved INSIDE `sz-workspace` via
  `git log --all --extended-regexp --grep="SZ<digits>([^0-9]|$)" -1
  --pretty=%H` (the `([^0-9]|$)` guard stops SZ123 matching SZ12345);
  ai-flow only consumes the result — `MODE=`/`WORKSPACE=` from
  `sz-workspace ensure` and `FIX_COMMIT=`/`BASELINE_COMMIT=` from
  `sz-replay init` — and must never re-derive it itself.

Also implement the seven-row capability-table parser
(`references/<module>/README.md`) — missing row or "manual track" cell =
capability degrades to manual track, never a failure.

### Step 3 — Prompts

One prompt per phase. Rules that proved necessary:

- COMMON carries the sz-dev hard rules (ticket read-only; fetched by the
  agent through its configured softzilla MCP — ai-flow runs no separate MCP
  client; never commit/push; evidence for every claim; English output)
  **plus**: "execute only the named phase document; do NOT advance
  phases; do NOT run `sz-progress set phase/gate`".
- Every path in the prompt must be inside the agent's working directory —
  ticket cache and skill dir must resolve inside the workspace
  (`skillDirFor()` prefers `<workspace>/skills/sz-dev`, which
  `sz-workspace`/`sz-replay` seed).
- Phase 1 prompt tells the agent to record the chosen pack via
  `sz-progress note "module pack: <name>"` (orchestrator parses the note,
  falling back to the requirement text, falling back to config).

### Step 4 — Orchestrator

Per-stage behavior (all sz-dev calls through an injectable `SzdevOps`
interface so tests can fake it):

- `workspace`: `sz-workspace ensure` → replay? `sz-replay init` →
  `progressInit` → baseCommit = workspace HEAD (replay: baselineCommit).
  The ticket is **no longer** fetched here — the phase-1 agent fetches it
  through its configured softzilla MCP and seeds
  `attachment/ticket-body.md` + `attachment/ticket-comments.md` inside the
  state dir; the phase-1 evidence check enforces that the cache exists
  before gate 1.
- `phaseN`: `progressShow` → clear answered escalations →
  `progressSetPhase(N)` when different (backward sets reset downstream
  gates — that is the rework path) → run agent with phase prompt →
  refresh mirror → if `awaiting` open: mark run `awaiting_review`
  (E1 = clarification, else escalation) and STOP → else verify evidence
  → set gate (1-3 only) → next.
- Evidence per phase (in addition to sz-progress's own checks):
  phase1: requirement + ticket caches (+ parse pack name); phase2:
  `phase2-plan*.md`, `phase2-review.md`, `phase4-handoff.md`,
  `checkpoints/SZxxxx_gate2.patch` + adapter scope guard + pack check
  (cql: `cql_lint.py`) + **snapshot gate-2 patch**; phase3:
  test-plan + test-report (parse PASS/FAIL/SKIP into state.test);
  phase4: deliverables dir non-empty + `CHANGES-SZxxxx.patch` →
  package delivery.
- Packaging: standard = tar of working-tree diff vs base;
  replay = `sz-replay verify` → `sz-replay diff --names` → 
  `sz-replay package`. Before verify (replay): archive `test-reports/`
  out of the tree and sanitize changed-paths.txt (drop generated
  reports/.sz-dev/skills lines).
- Resume: on startup, `progressShow` rebuilds the mirror; stale
  pre-migration run records (unknown stage names, no szdev mirror) start
  fresh instead of erroring.

### Step 5 — Runner (agent invocation)

- Support `{promptStdin}`: feed the prompt file content via **stdin**.
  Do not pass the prompt file path as an argument — sandboxed agents
  reject reading outside their cwd (headless ask = auto-reject/hang).
- Optional `model` → passed via `runner.modelFlag` (default `-m`; e.g.
  `--model` for other agents) or, when the command carries a `{model}` token,
  substituted into it. Persisted in `RunState.model` so resume keeps the model.

### Step 6 — Adapter

`ModuleAdapter { module, check, assertPhase2Scope, assertPhase3Scope,
phase2Snapshot, phase4Snapshot, productSurfaceExclusions? }` + registry
`getAdapter(module)`. cql v1: changes under `cql/` only; check =
`cql/test/tools/cql_lint.py` (skip silently when absent); snapshots =
diff excluding cql/test reports and runtime dirs. `phase4Snapshot` is
the reviewed surface for the trusted `gate2-reviewed.patch` and the
phase-4 byte-compare: product code, with the module test area excluded
(that area may evolve during phase 3 — `assertPhase3Scope` ignores it —
and ships in the delivery tarball, audited at gate 4). The exclusions are
data (`productSurfaceExclusions`, e.g. `:(exclude)cql/test` + `cql/test/`
prefix) so the same list drives the snapshot and the legacy-compat path:
a `gate2-reviewed.patch` written by an older ai-flow version that
snapshotted the FULL tree is narrowed to its product sections
(`filterPatchToProductSurface`) before the phase-4 compare, so a run that
outlives an upgrade does not false-fail when its test area evolved —
no manual reset needed. The agent-side gate-2 patch
(`checkpoints/SZxxxx_gate2.patch`, the deliverable CHANGES patch) stays
the full tree diff.
A new module pack = new adapter file + pack directory with the 7-row
capability table.

### Step 7 — Viewer

- Endpoints: run CRUD/review (already existed) + `stop` (kill pipeline +
  agent processes, mark failed "Stopped by user; state preserved"),
  `DELETE` (any state; resetRun stops the live agent and pipeline first),
  `logs/<stage>` (tail 256KB, ANSI stripped),
  `package` (download; only the pipeline's own tarball inside the package
  dir — a corrupted state.json cannot point it at an arbitrary file),
  `agent-status` (per-agent session probe: `tools/<agent>-status.sh`
  prints one JSON line per session from the agent's own store —
  OpenCode: `~/.local/share/opencode/opencode.db`, ZCode:
  `~/.zcode/cli/db/db.sqlite` — keyed by workspace directory; generic
  agents use `runner.statusCommand`), `models`, and `/api/mcp`
  (GET status / POST upsert / PATCH enabled / DELETE — the operator-only
  Manage MCP CRUD over the configured agent's config files).
- UI: stages list clickable → jump to that stage's artifact tab, each
  row shows its pass timestamp; total duration in the Stages header;
  default tab = liveLog while running, handoff once stopped (set ONLY on
  run switch, never on the 3s poll — otherwise tabs reset constantly);
  Live log auto-follows with wheel-intent stop + "↓ Follow" button;
  Deliverables tab lists state-dir files plus `~/sz/TC<digits>.wiki`
  (note: digits only, no SZ prefix); copy buttons with
  execCommand fallback (plain-HTTP LAN access has no
  `navigator.clipboard`); EHR theme (primary #1467b7, success #319436,
  danger #E74C3C, warning #FEC341, radius 4/6px, Roboto 14px, light
  header/status bars); bottom status bar shows session model/thinking
  variant/token usage.

### Step 8 — reset/stop CLI

`ai-flow reset SZxxxx` and `ai-flow stop SZxxxx` as described in
AGENTS.md. Reset keeps the workspace clone and the registry MODE verdict
(replay-ness is a property of git history, it never changes).

### Step 9 — Tests

`npm test` (node:test; run count changes over time — the TAP summary is authoritative) — the fakes matter:

- `fakeSzdev`: in-memory sz-progress (phase/gates/awaiting/notes) +
  configurable ensure/replay results.
- `happyAgent`: writes the sz-dev evidence files per phase based on
  prompt markers ("Phase 1 (requirement)" etc.), code only in phase 2.
- Coverage: happy path (gates mirror, tar in SZ_PACKAGE_DIR, prompts),
  E1-E7 pause + answer resume (E1 = clarification kind, rest = escalation),
  startup failure → exit code 1 (missing config), delivery tarball content
  (changed code packed; `.sz-dev/`/`.ai-flow/`/`skills/` never packed),
  stage-failure redaction (a cookie in a StageError never reaches
  state.json), stop's ticket-anchored pkill (kills the SZ-anchored CLI
  process, spares other tickets; the pattern must stay valid POSIX ERE),
  run-lock semantics (stale takeover, live-pipeline refusal, `--force`),
  gate-4 reject rewind (gates reset, phases re-run), failed-phase resume
  without re-running earlier phases, scope violation, replay mode
  (sz-replay routing), stale record reset, runner behaviors, viewer
  (stop/delete/review/log endpoints, /api/mcp CRUD), and a real
  `sz-progress` integration test (skipped automatically when the tools
  are absent) that drives the szdev wrappers through the actual bash tool.

---

## 4. Problems found in real runs, and their fixes

Each entry: symptom → root cause → fix (all fixes are in the code now;
listed here so a re-integration recognizes them instantly).

### P1 — Agent hangs forever on a permission "ask"
Symptom: opencode starts, logs `init`, then nothing for 20+ minutes.
Root cause: headless `opencode run` cannot answer permission prompts;
unconfigured `external_directory` reads and (later) writes are
ask/auto-rejected.
Fix (environment, `~/.config/opencode/opencode.json`): whitelist what the
workflow legitimately needs. Final working set:
```json
"permission": {
  "bash": { "*": "allow", "git commit*": "ask", "git push*": "ask", "git amend*": "ask" },
  "edit": { "*": "allow" },
  "external_directory": { "*": "allow" }
}
```
Rationale: the agent works in disposable sandboxes; correctness is
enforced by pipeline gates (pack check, sz-progress evidence,
sz-replay verify, human gate 4), not by sandbox prompts. Only the
commit red line stays. Iterative per-path whitelisting cost hours
(`rm -rf` variants, relative paths, redirects to /tmp…) — go straight
to the full whitelist. Also note: some rejections don't stop the agent
(it works around them); the killer is when the rejection hits evidence
production — then the orchestrator's evidence check fails the stage and
Retry fixes it.

### P2 — Prompt passed as a file PATH instead of content
Symptom: model receives `/…/prompts/phase1.md` as the prompt string,
tries to read it (external path) → rejected/hangs.
Fix: `{promptStdin}` placeholder (runner feeds file content via stdin);
config runner.command uses it. Never pass prompt paths to the agent.

### P3 — Agent references paths outside its working directory
Symptom: "PermissionDenied" / external_directory rejections for the
ticket cache and skills.
Fix: the phase-1 agent writes the ticket cache into
`<workspace>/.sz-dev/SZxxxx/attachment/` (inside its own working
directory); prompts resolve skills via `skillDirFor()` (workspace-seeded
copy first). Rule: **prompts contain only
workspace-relative/absolute-inside-workspace paths.**

### P4 — Replay-seeded `skills/` counted as a change
Symptom: phase 2 fails "Changes are outside cql/: skills/…" — sz-replay
injects `skills/` + `cql/test/` into the baseline tree as untracked.
Fix: `git.ts ignoredByCheck` treats `skills/` like `.sz-dev/` (runtime,
never a ticket change).

### P5 — Generated `test-reports/` poison the change surface
Symptom: `sz-replay verify` fails "change surface differs" / "patch
mismatch" — the acceptance runner's reports land in the tree root and in
changed-paths.txt (agent habit) and in the git index (agent ran
`git add`).
Fix: before verify, orchestrator archives `test-reports/` (both root and
cql/test) into the run dir, sanitizes changed-paths.txt, and removes
stray index entries (`git rm --cached`). Archive, don't just delete —
reports are phase-3 evidence.

### P6 — Stale gate-2 patch after fix rounds
Symptom: phase 4 verify fails "code changed after review" although the
phase-2 agent claimed completion.
Root cause: agents re-use or forget to regenerate
`checkpoints/SZxxxx_gate2.patch` after fix loops.
Fix: orchestrator snapshots the reviewed tree itself at gate-2 time
(replay: `sz-replay diff` bytes; standard: `writePatch`, plus a trusted
copy in the run dir). Later drift is caught by the phase-3
before/after snapshot check and, for drift predating a phase-3 resume,
by phase 4's byte-compare (standard) / `sz-replay verify` (replay).
To recover a run that already drifted:
rewind via rework to phase 2 (viewer Reject), or — when the reviewed
state is known-good — restore the intended code, regenerate the snapshot
mechanically, then resume.

### P7 — Implementation drift between phases (code quality, not pipeline)
Symptom: packaged code ≠ the real historical fix (extra `cond` around
`field-to-string` that changes rep-handling semantics).
Root cause: a phase-3 fix loop edited code after gate 2, and the rework
instruction said "redo phase 2 against the current tree", blessing the
drift.
Fix + lesson: rework comments must demand restoration to the REVIEWED
state (or an explicit re-derivation), not ratify whatever the tree
contains. Final SZ22052 package was verified byte-equal (mod one agent
comment line) to the historical fix; the replay-mode rule "never read the
fix commit" is for the agent — the human may adjudicate correctness
against it, as happened here.

### P8 — `sz-replay package` path parse
Symptom: "printed no package path" although packaging succeeded.
Root cause: the path line is `package: <path>` on **stderr** (not
"Packaged:" on stdout).
Fix: parse both streams for `/package: (\S+)/`.

### P9 — Viewer cannot bind a non-loopback host
Symptom: "ui.host must be 127.0.0.1…" with ui.host = 10.2.2.34.
Fix: restriction removed (any configured host allowed); loopback remains
the default.

### P10 — Retry/Create "does nothing" for old run records
Symptom: run records written by the pre-integration pipeline carry stage
names (`analyze`…) that no longer exist; resume threw and nothing visibly
happened.
Fix: stale records (unknown stage or missing szdev mirror) are detected
and the run starts fresh ("stale run record; starting fresh").

### P11 — Live log empty / jumps
Symptom & fix: (a) review stage has no log → fall back to the newest
stage that has one; (b) auto-scroll fought the user (content refresh
snapped back before the scroll event registered) → wheel-intent: any
upward wheel stops following; only scroll-to-bottom or the Follow button
resumes; (c) BEL/control-char spam from a hung engine call floods the log
→ ANSI/control chars stripped client-side; the agent's shell timeout
kills the hung command and the agent self-recovers (it reads the saved
full output from opencode's tool-output dir).

### P12 — Agent wiped its own state directory
Symptom: SZ30349 phase 3 ran 2.5h and its `.sz-dev/SZ30349/` vanished
(phase1-2 evidence lost; phase-3 resume impossible).
Root cause: while full permissions were enabled, the agent experimented
with `git clean` / sz-replay internals and removed the untracked state
dir. (Stop/Reset did NOT do it.)
Lesson: (a) state-dir deletion by an agent = start the SZ over —
`reset` + fresh run; the evidence gates make re-running cheap; (b)
write the "state dir is untouchable / cleanup limited to test-reports/"
rule into the pack's automation.md so gate-2 review catches it as P1.

### P13 — Agent exits non-zero after finishing the work
Symptom: stage fails with a garbage error message (tail of stderr,
sometimes plain `ls` output with ANSI codes) while all evidence files
exist.
Root cause: some agents exit non-zero when their last tool call failed
(e.g. a rejected command) even though the phase deliverables are
complete.
Fix: resume (`run`/Retry) — the evidence check passes and the pipeline
continues. Also check the actual files before diagnosing: the error
banner can be noise.
ANSI/garbage cleanup — implemented 2026-10-07: every stage error is run
through `clip` (redact + 500-char tail) before it is shown or stored —
`src/redact.ts` strips ANSI CSI sequences, cookies, tokens, private keys
and URL credentials, and the orchestrator's failure path re-applies
`redact` as defense in depth so a secret never reaches `state.json` even
if a future StageError skips `clip` (covered by test/pipeline).

### P14 — sz-workspace refuses a polluted standard-workspace path
Symptom: "…/ccsrc exists but is not a ccsrc checkout — refusing to
touch it."
Root cause: a previous run left only `.sz-dev/` inside the expected
workspace directory.
Fix: verify the directory is worthless, then move it aside
(`ccsrc.stale-<timestamp>`) and rerun. Never let the tool delete it.

### P15 — Stale delivery packages in ~/sz cause wrong comparisons
Symptom: "the package doesn't match the SZ" — multiple timestamped
tars from different rounds coexist in ~/sz, and shell globs
(`SZ22052_*.tar.gz`) pick the oldest.
Fix: archive superseded packages into `~/sz/stale-<SZ>-packages/` as
part of closing out a re-run; always compare against the exact newest
file name printed by the pipeline.

### P16 — Replay anchor picked from a harness commit's body mention
Symptom: the SZ22052 re-run of 2026-10-06 blocked in Phase 1 with
"BLOCKING — E5: declared pre-fix baseline already contains this SZ's
fix": the orchestrator designated the ai-flow harness commit
`85e503655c` as the fix commit, so the baseline was its parent — which
still contains the real 2020 fix `60f3c65a77` (the run's static +
dynamic baseline-integrity check caught it and escalated).
Root cause: the fix-commit heuristic ("newest commit whose message
mentions SZ<id>") treats any message mention as the fix. Harness
commits legitimately reference SZ ids in their bodies ("updates from
the SZ22052 replay sessions") and, being newest, shadow the real fix.
Earlier rounds worked only because the true fix was then the newest
mention — self-pollution the moment any newer mention lands.
Fix (2026-10-06): `findFixCommit` (src/szdev.ts) and sz-workspace
ensure's anchor selection now require a SUBJECT mention (check-in
convention) plus at least one touched file outside the harness trees
(`ai-flow/`, `skills/`), oldest first — the first landing of the SZ's
change. The MODE verdict (`subject_hit` in sz-workspace emit) already
guarded the body-mention case; the anchor selection now matches it.
Covered by test/units ("findFixCommit picks the first landed content
commit, never a harness mention"); verified against the live repo:
SZ22052/30349/34445/34595 all resolve to their true landed fixes.
Lesson: the Phase-1 baseline-integrity check stays the backstop — when
it disproves the declared baseline the run must still stop and
escalate E5 with the rendered re-init/waiver/abandon options; the
anchor rule only reduces how often that happens.

---

## 5. Environment prerequisites (one-time)

1. `ai-flow.config.json` at the repo root: `runner.command` with
   `{cwd}` and `{promptStdin}` (or `{promptFile}`); `runner.modelFlag`
   (default `-m`) or a `{model}` token; `runner.modelsCommand` and
   `runner.statusCommand` (both optional, agent-specific); `szdev.skillDir`
   (default `skills/sz-dev`); `ui.host/port`.
2. whatever the configured agent needs to run headlessly (for opencode: a
   permission whitelist — see P1; for others: the equivalent non-interactive
   configuration).
3. any viewer-status prerequisites of the configured agent (for opencode: the
   sqlite3 CLI on PATH so `runner.statusCommand` can read its session db).
4. sz-workspace user config `~/.config/sz-dev/config`
   (`SZ_CC_SRC_URL` with PAT) for workspace cloning; registry at
   `~/.sz-dev-workspaces/`.
5. Build once: `cd ai-flow && npm install && npm run build`;
   run tests: `npm test`.

---

## 6. Verification checklist (per release of the integration)

1. `npm test` — all green (0 failed in the TAP summary).
2. `npm run build` — tsc + vite clean.
3. CLI smoke: `run` a known replay SZ with a scratch ticket; watch
   - workspace prints `passed (replay)` and the replay tree exists;
   - each phase's prompt file contains the workflow path and only
     in-workspace paths;
   - `sz-progress show` advances phases; gates 1-3 pass on evidence;
   - `~/sz/SZxxxx_<ts>.tar.gz` appears and its content equals the
     intended diff (diff against the real fix commit if adjudicating).
4. Failure drills: kill the agent mid-phase → run marks failed → Retry
   resumes; Viewer Stop → failed "Stopped by user" → Retry resumes →
   Delete clears everything; Reject at gate 4 → rewind + comment
   injection; an E1 in phase 1 → clarification pause → answer resumes.
5. Viewer: live log follows the running stage; tabs persist across
   polls; deliverables (incl. TC wiki from ~/sz) listed with working
   copy buttons; status bar shows model/tokens of the live session.

---

## 7. Known limitations / future work

- Mid-run message injection (like a chat) is not supported by design:
  agents are per-phase headless sessions; human input lands at stage
  boundaries (rework comments, escalation answers). Interactive
  sessions would require the agent's interactive/serve mode and lose the
  auditability.
- The status bar has no context-window percentage — needs the model's
  real context limit (not present in opencode config).
- Only the cql module adapter exists; new modules need an adapter file
  + capability table (see `ai-flow/AGENTS.md`).
- "Never write back to the ticket system" (no `add_comment` via the
  softzilla MCP) is enforced by PROMPT only. The mechanical overreach
  guards (`assertNoAgentOverreach`) cover HEAD movement and MCP config-file
  changes, not MCP tool CALLS: if the agent invokes `add_comment`, nothing
  in the pipeline detects it. The prompts name the forbidden tool
  explicitly, and the softzilla connection itself is operator-managed —
  scoping its credentials read-only would be the mechanical backstop.
  Recommendation (operator-side, out of repo scope): configure the
  softzilla server the agent uses with a read-only credential/profile so
  the only reachable tools are the read family (`bug_info`,
  `bug_comments`, `bugs_quicksearch`, `summarize_bug_prompt`, and the
  info resources) while `add_comment` is refused at the server (403). The
  pipeline's phase-1 ticket fetch needs nothing beyond that read family;
  the human who must answer the ticket does so from the ticket system
  itself, never from ai-flow.
- Consider recording gate-2 patch staleness warnings in the phase-3
  prompt, and auto-archiving `~/sz` superseded packages after each
  phase-4.
