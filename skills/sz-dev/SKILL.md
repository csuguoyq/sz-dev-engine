---
name: sz-dev
description: Automation framework for SoftZilla SZ tickets on any ccsrc module — softzilla-MCP read, module-pack capabilities (routing / repro / check / build / accept), AI-implemented and AI-tested, RN/TC/CN/IN reverse-generated; the human audits once at the end. Use for any SZ or FRD/RN/TC/CN/IN requirement work ("/sz-dev SZxxxx"). Resumes from .sz-dev/SZxxxx/progress.md; escalates only when requirement or environment cannot be established from evidence.
---

# SZ Dev Skill

The AI executes the whole SZ lifecycle — read the ticket, review
history and code, implement, test, generate RN/TC/CN/IN — the human
audits once at the end. Framework is module-agnostic: at each
capability query point (`check` / `repro` / `routing` / `accept` /
`build` / `deliverables` / `review-checklist`, defined in
`contracts.md`) it consults the SZ's module pack (see Glossary).
Never pick a pack from the chat wording —
pick after reading the SZ (Phase 1).

## Glossary

| Term | Meaning |
|---|---|
| module pack | Capability + domain knowledge under `references/<module>/` (CQL is the reference pack). Capability present → AI executes that step; absent → **manual track**. |
| standard mode | Default flow: implement on the current code, fix not yet in git history. |
| replay mode | The SZ's fix commit is already in local git history: same four phases run on the pre-fix baseline (`fix-commit^`) in an isolated tree, with the ticket-pasted code and the landed fix out of bounds. See `workflows/replay-mode.md`. |
| manual track | AI renders the artifacts (commands, steps, documents); a human executes them. Used when the pack lacks a capability or no test host is designated. |
| orchestrated mode | Default executor: phases run as sub-agents inside one conversation. See `workflows/orchestrated-mode.md`. |
| light path | Small-SZ optimization: the whole flow in one conversation, no sub-agents, reduced ceremony (never reduced evidence). |
| evidence packet | The set of on-disk files a gate requires before `sz-progress` marks it `passed`. |
| escalation (E1-E7) | A question the AI cannot answer from evidence, parked in `progress.md` as `awaiting`. The only sanctioned human touches before the final checkpoint. |

# Hard rules (all phases; crossing one = stop and ask, never work around)

1. **The SZ ticket is READ-ONLY.** softzilla MCP is used for reads
   only — no `add_comment`, no state change, no attachments, no
   writes of any form.
2. **Implementation reference = local `git log` and history SZs'
   diffs.** Prefer local `git log` over GitLab MR fetch. The current
   SZ's own C-3PO "Checked in" list, its MR, and
   `fetch_gitlab_content` on it are status signals only — never the
   implementation to copy; confirm scope with the human.
3. **No `git commit` / amend / push.** Work stays in the working
   tree; `git clone` and patch snapshots under
   `.sz-dev/SZxxxx/checkpoints/` are allowed (`git add -N`
   intent-to-add is the snapshot primitive — it stages no content).
   Phase 2 ends with a file list + suggested commit message; the
   human commits.
   - *Sole exception:* `tools/sz-workspace mr`. After the human
     approves at GATE 4, `mr --approved` commits the delivery files
     on the per-SZ workspace's `sz/SZxxxx` branch and pushes to
     create the MR. Only there, only on the standard per-SZ
     workspace (the developer checkout never pushes), and only after
     the tool's proposal step was answered with `--approved`.
4. **Deliverables are local markdown; a human submits.** The agent
   never writes to the ticket system. Creating an MR uses the same
   two-stage contract: the tool first renders the proposal (source
   branch, target, title, file count) and exits 1; only an explicit
   human approval (`mr --approved` with the agreed title/target)
   executes it.
5. **Only modify files required by the requirement.** Sanctioned
   exception: module-pack write-backs per contracts.md rule 8 —
   pack files under the workspace's `skills/sz-dev/` copy,
   symptom-level only (no SZ numbers). The MR proposal lists every
   file it would commit, so the auditor sees them next to the code.
6. **All generated content is written in English** — review docs,
   deliverables, and chat replies alike.
7. **Testing is AI-executed inside the pack's safe harness only.**
   Write-path cases run only through the `accept` safety gates
   (backup / restore / teardown) on a designated test host — never
   production paths or binaries. A previous TCxxxx is never the
   executable plan; this SZ's reviewed case set is. With no test
   host designated, write-path cases do NOT default to the current
   host — they degrade to the manual track (rendered for a human,
   never executed by the AI).
8. **Never mark a test passed without captured evidence, never skip
   the final checkpoint, never report success while a rule was
   crossed.**

# Preflight (invocation start)

At the very start of every invocation — resume or fresh, before
Phase 0 — run the scripted check; exit 1 = hard failure → stop and
hand the FAIL lines to the human:

```text
bash "$SKILL_DIR/tools/sz-preflight" <SZxxxx>
```

Phase 1 of an ai-flow run still runs this check. A later phase of that
same run skips it when the orchestrator prompt says preflight already
passed for this run. Any other invocation, including a resume outside
that run, starts here.

After a PASS, make the semantic probe the script cannot make: a real
cheap softzilla MCP call (`bug_info` on the SZ number). Unavailable /
auth error / timeout → **stop immediately**: report exactly which MCP
and what failed, and end the run for the human to fix — print the
failed check and the fix the human owns, write nothing, run nothing
further; the next invocation starts over at this preflight. Do not
proceed to any other step, do not degrade, do not work around — the
requirement is unreadable without it. (Step-level detail:
`workflows/phase1-requirement.md` Step 0, which owns the checks.)

# Phases

One line each; `workflows/phase<N>-*.md` is the authoritative,
step-level runbook for its phase — read the file when entering the
phase, never work from this map alone. Priority order when guidance
conflicts: hard rules > gate evidence requirements (`sz-progress`) >
capability contract (`contracts.md`) > workflow steps > pack files >
worked examples — never resolve a conflict by silently inventing an
exception.

- **Phase 0** `tools/sz-workspace ensure SZxxxx` → `MODE=<standard|replay>`
  + `WORKSPACE=<path>`, cd there. MODE is decided here, once:
  replay when the SZ's fix commit is already in local git history
  (record it in `progress.md` via `sz-progress note` and go to
  `workflows/replay-mode.md`), standard otherwise.
  **Replay runs:** immediately follow `ensure` with
  `sz-replay init <SZxxxx> <fix-sha>` (ensure prints the SHA) —
  `ensure` relocates the workspace and checks out the baseline but
  does not create the replay registry entry, and every later
  `sz-replay` subcommand fails without it. Idempotency, `--inplace`
  workspace sharing, and contamination rules: `workflows/replay-mode.md`.
- **Phase 1** requirement: softzilla-MCP read SZ + FRD (+ Figma) →
  IDs → prior-art (git log first) → current code → routing (pack;
  consult `architecture-cache.md` first) → [bug SZs] repro red
  pre-fix → requirement review (large SZs) → GATE 1.
- **Phase 2** implementation: large SZ → slices.md, one slice per
  conversation; plan (bug fixes: remediation-strategy table —
  narrowest fix wins, new behavior needs justification or E1) →
  implement with the pack `check` inner loop (self-fix max 2 rounds)
  → build verify → independent review (fresh context; light path:
  same-context self-review; P0/P1 fixed) → file list + suggested
  commit message (no commit) → GATE 2.
- **Phase 3** testing: case set (repro + FRD scenarios +
  same-family; authored once, directly as the TC wiki) → thin plan
  index derived from the wiki → machine review → execute via pack
  `accept`; uncovered → manual track; failures: fix, back to Phase 2
  loop (max 2 rounds) → test-report with evidence → GATE 3.
- **Phase 4** deliverables: RN + TC (default set) + CN / IN on their
  triggers — from the REVIEWED case set → results already in the TC
  wiki (Phase 3 wrote them back once) → package to `~/sz/` (SZ +
  Beijing timestamp) → [FINAL CHECKPOINT] human audits, commits /
  submits → write findings back to pack + refresh architecture-cache
  + consolidate write-back candidates (contracts.md rule 8).

Executor mode files — read before entering the mode:
`workflows/orchestrated-mode.md` (the default executor, incl. the
six-condition light-path eligibility check) and
`workflows/replay-mode.md`.

# Escalations and deterministic fallbacks

The AI escalates if and only if it cannot establish the
**requirement** or the **environment** from evidence; it never
guesses:

- E1 requirement: blocking behavior / permission / boundary
  questions left after reading SZ + FRD + history + code, or a
  design decision the FRD does not answer
- E2 requirement: module-pack selection ambiguous
- E3 requirement: repro failure or symptom mismatch (understanding
  unproven)
- E4 environment: unclear baseline (branch / authoritative FRD
  version)
- E5 environment: requirement unreadable (workspace bootstrap
  failed, softzilla MCP down, FRD unreadable with no text source)
- E6 red line: about to cross a hard rule (any phase)
- E7 budget: self-fix rounds exhausted (2) — continuing would be
  guessing

Some situations are deterministic and never escalate — the rule
decides, recorded in `phase1-requirement.md`:

- fix commit found ⇒ replay mode
- test host unspecified ⇒ write-path cases degrade to the manual
  track (never the current host by default)
- pack `accept` capability missing ⇒ manual track (Phase 1.5
  records `track: manual`; other manual capabilities — e.g.
  `build` — are recorded as notes, not the track)

An escalation sets `awaiting: <E-id>` in `progress.md` (via
`sz-progress awaiting <SZxxxx> <E-id>`); `sz-progress` refuses
forward `set phase` / `set gate passed` while an escalation is open
(resume re-presents that question only; `--force` overrides with a
note). The escalation count of a run measures ticket ambiguity, not
failure.

# Checkpoint discipline

One fixed human checkpoint (end of Phase 4) replaces mid-flow
gates.

- **Gates 1-3 are automation milestones.** `passed` = the phase's
  evidence packet is complete — no human needed. `sz-progress`
  enforces this mechanically: evidence files on disk per gate, gates
  cannot be skipped, open escalations block forward movement,
  `--force` overrides with a recorded note.
- **Gates 2 and 4 also require a clean `tools/sz-verify-tree` run**:
  HEAD still at the recorded `base`, working-tree change set ==
  `changed-paths.txt`. `--gate4` adds the packet checks (CHANGES
  patch, package, deliverables).
- **Workflow files handle the rest:** where a step needs an answer
  the evidence cannot give, it escalates — it never waits
  ceremonially.
- **`rejected` = rework per feedback.** Gate 4 stays `pending` until
  the human audits and commits / submits. A `track: manual` run's
  gates distinguish "AI executed" from "rendered for a human".

# Multi-session model

One phase per conversation; `.sz-dev/SZxxxx/` is the only state
passed between sessions. The default executor is orchestrated mode
(see Glossary; `workflows/orchestrated-mode.md`), recorded via
`sz-progress set <SZxxxx> meta mode orchestrated`.

A small SZ takes the **light path** instead: the whole flow — gate 1
through gate 4 — in one conversation with no sub-agents and reduced
ceremony. Gates and evidence packets are unchanged — what shrinks is
re-renderings and review ceremony, never evidence. The six
eligibility conditions are a hard pre-check
defined in `workflows/orchestrated-mode.md` ("Small-SZ light path");
any miss → orchestrated.

Fall back to file-based multi-session (one phase per conversation;
the human starts the next) when sub-agent dispatch is unavailable or
fails. Borderline goes down, not up.

## ai-flow orchestrated mode

`ai-flow/` can drive this workflow headlessly. Its stages map 1:1
onto the phases here, and `sz-progress` stays the single source of
truth (ai-flow's `state.json` is only a render mirror):

| ai-flow stage | sz-dev meaning | gate handling |
|---|---|---|
| `workspace` | Phase 0: `sz-workspace ensure` (+ `sz-replay init` when `MODE=replay`) | — |
| `phase1` | Phase 1 (requirement, pack pick, routing, repro) | gate 1 passed automatically once the evidence files exist |
| `phase2` | Phase 2 (plan, implement, pack check, self/independent review) | gate 2 passed automatically |
| `phase3` | Phase 3 (case set, machine review, accept execution, report) | gate 3 passed automatically |
| `phase4` | Phase 4 (deliverables + delivery tarball) | — |
| `review` | Gate 4 human audit in the ai-flow viewer | approve sets gate 4 passed; reject rewinds to a chosen phase |

(The light path does not change this stage mapping or gate
handling.)

Open escalations (`awaiting: E1-E7`) surface as ai-flow's
`awaiting_review` with the escalation code; the human answers in the
viewer and the answer is injected into the phase prompt (rework).
Phase execution still follows `workflows/phaseN-*.md` verbatim —
ai-flow only dispatches, verifies evidence, and advances
`sz-progress`.

## Session handoff and resume

**Handoff contract** — end every session by appending
`## Handoff to next session` to the phase's output file: (1) files
to read first, (2) its first action, (3) open questions/decisions
(also via `sz-progress note`).

**Session-end output** — the last message of every session is this
fixed template, so the human never has to infer the next step from
prose:

```text
SZxxxx <phase name> done — <one-line result>
Artifacts: <files written under .sz-dev/SZxxxx/>
Next: <Phase N (name)> in a new session — resume with "/sz-dev SZxxxx"
Open: <open escalations / decisions, or "none">
```

**Resume rule** — `progress.md` exists → this invocation is a
resume: read it plus the current phase's workflow file and the last
handoff block; jump to the recorded phase; never re-run completed
phases or re-ask answered questions. Roles that must not share
context run as separate sub-agents (Phase 2's independent review is
always a fresh context).

**Resume with an open escalation** — the resume FIRST re-fetches the
ticket thread (fresh `bug_comments` into the canonical cache) and
checks it for answers: an answer clears or re-scopes the escalation
(a follow-up clarification round may open); absent answers,
re-present the same questions once and stop. Never resume past an
open escalation on cached state alone — the ticket, not the cache,
is the source of truth for whether the human has answered.

# State tracking

Artifacts, deliverables, drivers and ticket caches all live under
`.sz-dev/SZxxxx/` and are written with the file-writing tools
(Write/Edit), never shell redirection — tool writes are what the
client UI tracks, and the GATE 4 packet presents every artifact as a
clickable file card. `<workdir>` = the Phase 0 workspace root.

State tree and the `progress.md` key set (`phase`, `mode`, `track`,
`slice`, `rounds`, `gate1-4`, `awaiting`, `base`, `package`,
`constraints`) are owned by `sz-progress` (`sz-progress show` prints
them; its usage is the schema). `note` lines carry a phase label
like `Ph2:` — never a bare `P2`, which collides with the review
rubric's severity. Structured artifacts (`phase1-requirement.md`,
plan, review, test plan, report) are generated from
`sz-gen-deliverable` skeletons so their shapes stay identical across
runs. A leftover `.sz-agent/SZxxxx/` (earlier draft name) is renamed
once.

# Attachment cache

SZ content is cached in `.sz-dev/SZxxxx/attachment/` as
`<id>_<original-name>` (PDF: `.pdf` + converted `.md` side by side;
copy in anything a converter left under `/tmp/`). The raw requirement
sources of THIS SZ (`bug_info` / `bug_comments` output) keep the
canonical names `ticket-body.md` / `ticket-comments.md` (Phase 1
Step 1; gate 1 requires them). Check the cache before every fetch;
save every successful fetch there. Delete `.sz-dev/SZxxxx/` only
when abandoning the SZ.

# Tools

One line each — purpose + the framework question it answers;
command lists, flags and per-tool env vars live in `tools/README.md`
(and in each tool's no-arg usage):

| Tool | Purpose |
|---|---|
| `sz-workspace` | Phase 0: resolve / create / clone the ccsrc workspace (check / ensure / list / remove / `sync-skill` = push the repo skill copy to the installed + all seeded copies; `mr` = two-stage human-approved MR on `sz/SZxxxx`); reads per-user clone defaults from `~/.config/sz-dev/config` (PAT setup: `sz-workspace config`) |
| `sz-preflight` | invocation-start dependency check: bash / git, skill tools health, softzilla reachability (the MCP auth probe stays an agent `bug_info` call) |
| `sz-progress` | phase / gate / awaiting state machine — the mechanical enforcement behind "Checkpoint discipline" |
| `sz-verify-tree` | no-commit + in-scope check: HEAD == recorded `base`, working-tree change set == `changed-paths.txt` (gates 2 and 4; replay runs use `sz-replay verify` instead) |
| `sz-replay` | replay plumbing: init (baseline tree at `fix-commit^`), diff, finish, package, exclusions / audit / verify (contamination + trust chain) |
| `cql-run` | the ONLY sanctioned engine invocation: timeout + output cap + stdin discipline + `$CCRUN` presence |
| `sz-gen-deliverable` | RN/TC/CN/IN document skeletons |
| `sz-doctor` | framework health check (tools smoke, pack capability tables, refs / contract / hygiene, drift) — Python, run as `python3 "$SKILL_DIR/tools/sz-doctor"` |
| `selftest` | behavior-level tool regression (synthetic env); run after changing any tool |

Invoke as `bash "$SKILL_DIR/tools/<name>" ...` (or directly / via
PATH — the tools carry the execute bit) — never a path relative to
the ccsrc working directory. Every `sz-progress` subcommand takes the
SZ id as its FIRST argument (`sz-progress <verb> <SZxxxx> ...`) —
never appended at the end.

SZ reads use the **softzilla MCP**:
`bug_info` (by SZ number), `bug_comments` /
`summarize_bug_prompt` (FRD details, repro steps, test results live
in comments), `bugs_quicksearch` for prior-art. Caution:
`bugs_quicksearch`'s `limit` parameter is **not honored
server-side** — even a small `limit` can return the full (multi-MB)
match set. Treat local `git log --grep "<SZ number>"` as the primary
prior-art tool; use quicksearch only as a last resort with tight
terms (precise quicksearch syntax: `quicksearch_syntax_resource`).

MCP results can be truncated in transit (`resultBudget`) — when a
truncation notice appears, re-read in parts until the cache copy is
complete; never cache a truncated thread as whole. Attachments have
no MCP download tool: fetch `attachment.cgi?id=<n>` with a web
reader and cache (above); a **403** from the web reader is expected
(the endpoint needs a session) — fall back to `curl -sS <url>` and
record which path worked.

# Module references

Decide the pack AFTER reading the SZ, in this order (record the
choice + signals in `phase1-requirement.md`): 1) category /
sub-category (strongest); 2) title + change context + cited FRD
P/Ns; 3) still unclear → escalate (blocking).

```text
references/cql/      diff hits cql/, cclib/cql, cclib/cqlA,
                     gdbscripts/ — start at references/cql/README.md
references/claim/    Claim/Billing category, or title/context:
                     Billing Tab, claim, guarantor, bill pause,
                     835/remittance, AR, BNR
```

Read only the pack file the current question maps to (the pack's
`README.md` capability table) — never the whole pack; honor any
Phase-1 mandatory read the pack's README declares. Maps lose to the
current FRD and the repository. No matching pack → softzilla MCP +
`git log` only (manual track).

# Dependencies

- bash, git — Linux, or Git for Windows (node is needed only by the
  repo-level skills installer, never by a run)
- ccsrc checkout — auto-provisioned by Phase 0 (`tools/sz-workspace`);
  for prompt-free cloning, FIRST-TIME SETUP: run
  `bash "$SKILL_DIR/tools/sz-workspace config"` and follow its
  steps — put a personal GitLab PAT (scopes `read_repository` +
  `write_repository`) into `~/.config/sz-dev/config` as
  `SZ_CC_SRC_URL`, `chmod 600` it; `sz-doctor` reports when it is
  missing
- softzilla MCP (read SZ; `add_comment` forbidden); web reader for
  attachments; Figma MCP soft (designs when present)
- `python3` (+ `pymupdf`/`pypdf`) only when a PDF has no `.md`
- pack `check` / `build` / `accept` capabilities on a designated
  test host (fallback: manual track — Hard rule 7)

Phase 1 preflight stops hard on a missing softzilla MCP (the SZ is
unreadable without it). Never fail preflight for a missing PDF
library.
