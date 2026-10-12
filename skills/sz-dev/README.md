# sz-dev skill

`sz-dev` is an **end-to-end automation framework for SoftZilla SZ
tickets** against any `ccsrc` module. One command — `/sz-dev <SZ
number>` — drives the whole lifecycle: the AI reads the ticket,
understands the requirement, studies history and code, implements the
fix, tests it, and drafts the delivery documents (RN / TC / CN / IN).
The human reviews once at the end, plus answers targeted questions
when the AI genuinely cannot decide something from evidence.

It is written for **two audiences**:

- **Developers** who just want their SZ done: see
  [How to use](#how-to-use) below. You invoke the skill, answer a few
  questions if asked, and audit the result at the final checkpoint.
- **Maintainers / contributors** who want to extend it to new modules
  or understand the machinery: see
  [Key concepts](#key-concepts) and [Layout](#layout).

Billing / Claim tickets additionally consult `references/claim/`
(FRD catalog, domain map, SZ history); CQL tickets consult
`references/cql/` (the reference module pack). Packs are reference
material, not separate skills.

- **Agent entry**: `SKILL.md`
- **Tool reference**: `tools/README.md`
- **Human maintainers**: this README

---

## How to use

### Prerequisites

- **softzilla MCP** (SZ / FRD / prior-art reads; `add_comment`
  forbidden — the ticket is read-only for the agent) and **Figma
  MCP** when designs exist
- bash, git, node; **python3** for the CQL static gates / runner /
  doc generation; `pymupdf` or `pypdf` only when a PDF must be read
  and no `.md` conversion exists
- a ccsrc checkout is **not** a prerequisite: Phase 0
  (`tools/sz-workspace`) reuses the current checkout or creates and
  clones `/project/<user>_sz<n>_ai/ccsrc` (full history)
- module pack capabilities (`check` / `build` / `accept`) run on a
  designated test host; capabilities missing on the current host
  fall back to the manual track

### Starting an SZ

From any directory, invoke the skill by name:

```text
/sz-dev SZ31750
```

Or: "use sz-dev for SZ31750". Phase 0 resolves the workspace first,
then Phase 1 reads the SZ (softzilla MCP) and decides the module
pack from category / title — never from the chat wording alone.

### What happens in each phase

| Phase | AI | Human |
| ---- | -------- | ---- |
| Phase 0 | `tools/sz-workspace ensure` — reuse current checkout or create + clone `/project/<user>_sz<n>_ai/ccsrc` | nothing (scripted) |
| Phase 1 | softzilla-MCP read SZ → pick pack → FRD / history / code → notes + repro case (bug SZs) | answers escalations (see below) |
| Phase 2 | plan → step-by-step implement with pack `check` inner loop → build verify → independent code review → handoff package | only escalations (real decisions, fix rounds exhausted) |
| Phase 3 | assemble case set → machine review → AI-execute via pack `accept` (backup/teardown safety gates) → test report with evidence; failures fixed and re-run | audits at the final checkpoint |
| Phase 4 | deliverables reverse-generated from the reviewed case set → package to `~/sz/` → final checkpoint packet | **final checkpoint**: audit diff + review + test report + deliverables; commit / submit |

Progress lives under `<workspace>/.sz-dev/SZxxxx/`.

### Escalations and clarifications (how the AI asks you)

The AI never guesses. When reading the ticket leaves a blocking
question (ambiguity, repro failure, missing environment fact), it
stops and escalates with a numbered ID (`E1` requirement, `E3`
repro mismatch, `E4`/`E5` environment, ...). Requirement questions
are rendered as **ticket-ready clarification comments** in
`.sz-dev/SZxxxx/deliverables/clarification-comments.md`:

- plain text matching the ticket's house style — no markdown, no
  blockquotes, nothing to strip before pasting; questions listed
  `Q1.`, `Q2.`, ... in ONE main comment; NON-BLOCKING assumptions
  stated in the same list ("we will assume X; correct us if wrong").
- Clarification is **iterative**: when the answers come back, the AI
  re-reads them; any new question opens a follow-up round
  (`Q5`, `Q6`, ... continuing the numbering). The ticket stays
  read-only for the agent — you copy the drafted comments onto the
  SZ yourself.
- **The requirement must be fully clarified before any later phase
  opens**: while a clarification round is open, gate 1 cannot pass
  and no implementation / testing / deliverable work starts.
- **Resuming a stuck run**: when you re-run `/sz-dev <SZ>` after
  answering on the ticket, the AI first re-fetches the ticket
  comments (never trusts the cache for this), digests the answers,
  and continues — or asks the follow-up round.

### Resuming in general

State is on disk; re-running the same command resumes. `progress.md`
records phase / gates / open escalations; the AI jumps to the
recorded phase and never re-runs completed phases or re-asks
answered questions.

### Manual tools (optional)

```bash
SKILL_DIR="$HOME/.zcode/skills/sz-dev"

bash "$SKILL_DIR/tools/sz-workspace" ensure SZ31750   # Phase 0 bootstrap
bash "$SKILL_DIR/tools/sz-workspace" list             # registered workspaces
bash "$SKILL_DIR/tools/sz-preflight" SZ31750        # invocation-start dependency check
bash "$SKILL_DIR/tools/sz-progress" show SZ31750
bash "$SKILL_DIR/tools/sz-progress" init SZ31750
bash "$SKILL_DIR/tools/sz-verify-tree" SZ31750      # no-commit / in-scope check
bash "$SKILL_DIR/tools/sz-gen-deliverable" rn SZ31750 "title"
bash "$SKILL_DIR/tools/sz-replay" status SZ31750      # replay runs only
python3 "$SKILL_DIR/tools/sz-doctor"                # framework health check
```

---

## Key concepts

- **Module pack** (`references/<module>/`): the framework is
  module-agnostic. At fixed query points it asks the SZ's pack a
  question — `routing` (which layer does this touch?), `repro` (can
  we turn it red pre-fix?), `check` (is this change OK so far?),
  `build`, `accept` (safe test execution), `deliverables`,
  `review-checklist`. A capability present → the AI executes it;
  absent → **manual track** (the AI renders the artifact, a human
  executes). The capability table each pack must provide is defined
  in `contracts.md`; the CQL pack is the reference implementation.
- **One human checkpoint**: gates 1–3 are automation milestones
  (evidence packets complete — enforced mechanically by
  `sz-progress`). Only gate 4 is a human audit: you review the diff,
  the review findings, the test report and the deliverables, then
  commit / submit. MR creation is two-stage: the tool proposes
  (`mr`), you approve (`mr --approved`).
- **Escalation, not guessing**: the AI stops only on things the
  evidence cannot answer — a blocked run always shows a single
  `awaiting: <E-id>` and a concrete question. Escalation count
  measures ticket ambiguity, not failure.
- **Replay mode**: if the SZ's fix is already in local git history
  (e.g. training / benchmarking), the same four-phase flow runs
  against the pre-fix baseline (`fix-commit^`) with the landed fix
  and ticket-pasted code out of bounds — so the AI cannot copy the
  answer. See `workflows/replay-mode.md`.
- **Read-only ticket**: the SZ is read via softzilla MCP only.
  Comments, RN drafts, MR proposals — everything outward-facing is
  rendered locally for the human to submit.

### What a run produces

All state for one SZ lives in `<workspace>/.sz-dev/SZxxxx/`:
requirement analysis (`phase1-requirement.md`), implementation plan +
review (`phase2-*.md`), test plan + report with evidence
(`phase3-*.md`), delivery drafts (`deliverables/`), the ticket cache
(`attachment/`), and gate state (`progress.md`). The final-checkpoint
packet presents every artifact as a clickable file card.

---

## Layout

```text
sz-dev/
├── SKILL.md                     entry: hard rules, phases 0-4, checkpoint
│                                discipline, multi-session model, state, tools
├── README.md                    this file
├── contracts.md                 module-pack capability contract
├── .claude-plugin/plugin.json   plugin-marketplace metadata (packaging
│                                only — skill discovery reads SKILL.md)
├── workflows/
│   ├── phase1-requirement.md    preflight + bootstrap → softzilla MCP → history → GATE 1
│   │                            (incl. iterative clarification-comment format)
│   ├── phase2-implementation.md plan → step-by-step impl (check inner loop) → review → handoff
│   ├── phase3-testing.md        case set → machine review → AI execution → report
│   ├── phase4-deliverables.md   RN / TC / CN / IN → package → final checkpoint
│   ├── orchestrated-mode.md     phases as sub-agents in one conversation;
│   │                            small-SZ light path eligibility + session sequence
│   └── replay-mode.md           SZ already in git history: same flow on the pre-fix baseline, answer out of bounds
├── references/
│   ├── cql/                     CQL module pack (reference implementation)
│   └── claim/                   Claim module pack (catalog / history / domain)
└── tools/
    ├── README.md          command-level tool reference (flags, env vars,
    │                      command lists — SKILL.md keeps the one-line table)
    ├── sz-workspace         Phase 0: resolve / create / clone the ccsrc workspace,
    │                        per-SZ working branch (sz/SZxxxx) + two-stage
    │                        human-approved MR (proposal -> --approved)
    ├── sz-preflight         invocation-start dependency check: bash/git,
    │                        skill tools health, softzilla reachability
    │                        (the MCP auth probe stays an agent bug_info call)
    ├── sz-progress          phase / gate / awaiting state machine
    ├── sz-verify-tree       no-commit + in-scope check (HEAD == base,
    │                        working tree == changed-paths.txt) at gates 2/4
    ├── sz-replay            replay plumbing: isolated baseline tree, diff, package,
    │                        exclusions / audit / verify (contamination + trust chain)
    ├── cql-run              mandatory-caps engine wrapper (timeout, output cap,
    │                        stdin discipline) — every engine call in a run goes
    │                        through it
    ├── sz-gen-deliverable   RN / TC / CN / IN skeletons
    ├── selftest             behavior-level tool regression (synthetic env)
    └── sz-doctor            framework health check (tools smoke, pack
                             capability tables, banned tokens, drift)
```

Related history is always discovered live from MCP + `git log`. Packs
are maps (not ground truth).

The authoritative phase map and the run-state layout live in
`SKILL.md` (phases 0-4, `.sz-dev/SZxxxx/` keys) — this README does
not restate them.

---

## Maintainer rules

- **Single source of truth map** — every concept has one owner file;
  the rest are pointers, never restatements: hard rules + escalation
  IDs (E1-E7) → `SKILL.md`; capability contract + review severity
  rubric + write-back rules → `contracts.md`; per-phase steps →
  `workflows/phase<N>-*.md`; executor modes + light-path eligibility →
  `workflows/orchestrated-mode.md` + `workflows/replay-mode.md`; pack
  contents (commands, exit codes, domain facts) →
  `references/<module>/`; tool flags / env vars / command lists →
  `tools/README.md`. Find the owner file before adding a rule.
- **SKILL.md has a hard size guardrail (550 lines, enforced by
  `sz-doctor`)**. Content goes in SKILL.md only if it applies to
  every SZ of every module (hard rules, phase map, state contract);
  module knowledge belongs in `references/<module>/`, phase detail
  in `workflows/`. Hitting the cap means **consolidate before
  adding**: dedupe, promote detail to a workflow/pack file, and
  re-point — never grow past the cap.
- New module knowledge follows `contracts.md` ("Adding a new
  module"); new tools must be smoke-covered by `sz-doctor` /
  `selftest` and named in SKILL.md + this README.
- **Two copies, one source**: the project-side `skills/sz-dev/` is
  the single source of truth; the installed copy
  (`~/.zcode/skills/sz-dev/`) is synced from it (e.g. `rsync -a
  --delete` + `diff -rq` verification). Never hand-edit the
  installed copy.
