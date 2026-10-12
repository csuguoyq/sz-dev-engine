# Phase 1: Requirement

Goal: fully understand the requirement, the related history, and the
current implementation, and surface every unclear point to the human.
Runs as its own conversation or a Phase-1 sub-agent — steps and outputs
are identical. Tools: `bash "$SKILL_DIR/tools/<name>"` (never a
ccsrc-relative path).

## Steps at a glance

| # | Step | Gate-relevant output |
|---|---|---|
| 0 | Preflight (scripted checks, workspace, MCP probe) | workspace cd, `progress.md` init + `meta base` |
| 1 | Read the SZ (read-only) → cache verbatim | `attachment/ticket-body.md` + `ticket-comments.md` |
| 1.5 | Select module pack + execution track | `meta track`, `note module pack:` |
| 2 | Read FRD + designs (scope: full vs light) | acceptance criteria list |
| 3 | Related history (bounded; replay trigger) | prior-art notes; fix commit → replay |
| 3.5 | Routing (architecture-cache first) | layer + co-change list |
| 4 | Review related code (bound the change set) | RCA evidence in the artifact |
| 4.5 | Repro (bug SZs only; lowest level first) | `repro: red\|n/a\|manual` + `driver data:` |
| 5 | Clarification questions | BLOCKING → E1; drafts in deliverables/ |
| 5.5 | Requirement review (large SZs; fresh context) | `## Requirement review` section |
| 6 | GATE 1 + handoff | gate 1 passed, handoff block |

Generate the artifact outline with
`sz-gen-deliverable phase1 SZxxxx` — its headings are the required
shape (Phase 2, the reviewer and gate 1 navigate by them). Each answer
in the artifact carries its evidence: an RCA claim names file +
function + the exact expression; a prior-art claim names the SZ +
pattern; a scope exclusion names who decided it where. Write for a
reader who has not seen the ticket — paste verbatim what is
load-bearing.

## Step 0 — Preflight (in order; each hard item stops the run on failure)

1. `sz-preflight SZxxxx` (scripted deps; exit 1 → stop).
2. `sz-workspace ensure SZxxxx` → read `WORKSPACE=<path>` + `MODE=`,
   `cd` there. Shared checkouts: `--inplace` once, persisted.
3. Fresh run: `sz-progress init <SZxxxx>` → `sz-progress set <SZxxxx>
   phase 1` → `sz-progress set <SZxxxx> meta mode <orchestrated|file>` →
   `sz-progress set <SZxxxx> meta base "$(git rev-parse HEAD)"`
   (the no-commit anchor `sz-verify-tree` asserts later). The SZ id is
   the FIRST argument of every `sz-progress` subcommand — never appended
   at the end (`set phase 1 <SZxxxx>` is an invalid-SZ error). Resume:
   never re-init; run `sz-verify-tree` first (FAIL = stop), then apply
   the resume-with-open-escalation rule (SKILL.md).
4. softzilla MCP probe: a real `bug_info` — auth error/timeout → stop
   for the human (E5 territory; never work around). Figma MCP: soft.
5. Record operator constraints: `sz-progress constraint`.

Failure taxonomy: unresolvable environment (workspace failed, MCP down,
FRD unreadable with no text source) → **E5**; unclear baseline (branch /
FRD version) → **E4**. Missing test host / missing capability: never an
escalation — write-path cases and that capability degrade to the manual
track; record in the artifact. Replay note: `MODE=replay` (or a fix
commit found in step 3) → read `workflows/replay-mode.md` now; its
Delta 1/2 supersede git working-tree primitives and bound the sources.

## Step 1 — Read the SZ (read-only)

`bug_info` + `bug_comments`; cache verbatim via the Write tool to the
canonical names (`attachment/ticket-body.md`, `ticket-comments.md`) —
gate 1 requires them on disk; every later consumer reads the cache,
never re-calls the MCP. Check the cache before every fetch (attachment
cache rules: SKILL.md). `bug_info` has no category/change-context/body —
mine those from the thread (FinalReview banner); decide bug-type from
`type` + title, never E2 for a missing field. Status Fixed/Closed with
commits + RN → flag to the human and confirm scope (hard rule 2).
Extract related SZ/FRD/TC IDs + URLs for step 3; no bulk fetching.
Huge threads: `summarize_bug_prompt` instead of paging.

## Step 1.5 — Module pack + track

Pick from step-1 evidence only, strongest first: category/sub-category →
title + change context + cited FRD P/Ns (grep candidate packs'
`frd-catalog.md`) → product names. Record pack + signals; conflicts →
**E2** (do not open any pack until resolved). Then derive `meta track`
mechanically: `auto` iff the pack implements `accept`; `manual` when it
does not or no pack matched. Other manual capabilities (build, …) are
notes, not the track.

## Step 2 — FRD and designs

Light read (SZ + the step 3-4 code areas) when the SZ carries a
complete RCA/change table or one obvious use case; full read otherwise.
Pack applies → the FRD family's LATEST catalog version is authoritative;
a pack-declared Phase-1 mandatory read happens even on the light path.
Fetch cited FRDs (References table); Figma when present; note
acceptance criteria for every use case. Record what was read and skipped.

## Step 3 — Related history (bounded, not the whole module)

Fetch cited related SZs (cap ~5 bodies; grep-title the rest), check the
cache first. Previous TC/RN: at most one closely related as background —
never the executable plan. For the current SZ and each kept one:
`git log --all --oneline --grep` + `--name-only`. This SZ's own hits =
status signal; a fix commit → replay mode (never open its diff; run
`sz-replay exclusions` — excluded files are out of bounds even to grep,
and their capabilities degrade per the replay table). Pack
`sz-history.md` (when not excluded): grep only.

## Step 3.5 — Routing

Pack `architecture-cache.md` first (cheapest inventory; within
`valid-until` its facts are starting hints — past it, re-derive what
the run needs; refresh happens at Phase 4 closeout). Pack `routing`
capability → layer + mandatory co-changes; absent → `routing: manual`,
derive the layer from the file hits.

## Step 4 — Related code

Bound the change set (no baked-in path list): FRD use cases → prior-art
commits' files → current working-tree files there → symbol/filename
search for FRD names → pack code map as a hint (never ground truth).
Confirm by reading; parallel read-only sub-agents allowed (conclusions,
not raw files; verify load-bearing ones). Note conventions + utilities
to reuse.

## Step 4.5 — Repro (bug SZs only)

Conclusion is mandatory gate-1 evidence, exact tokens (prose variants
are rejected by `sz-progress`): `repro: red` (executed pre-fix — the
strong path), `repro: n/a` (feature), `repro: manual` (rendered for a
human; never counted as executed). Execute only through the pack's
`repro` capability, lowest level first; write levels only through its
declared safety gates on the designated host. The repro case is stored
with the notes; Phase 3 promotes it. Executed repro failure or symptom
mismatch = the understanding is wrong → **E3** with evidence. An
executed red additionally requires a `driver data:` provenance line
(`ticket-verbatim` preferred | `fixture <path>` | `hand-built +
mapping` with a code-var→index→ticket-element table) — a hand-typed
self-consistent driver validates its own premises and has doubled fixes
before.

## Step 5 — Clarifications

Minimum checklist: exact permissions; new storage/DBI; behavior to
mirror; Figma-missing details; edge cases; deliverable scope. Split:
**BLOCKING** (guessing otherwise) → **E1** + `awaiting`; **NON-BLOCKING**
→ conservative recorded default, never gate-holding. A default is
derived from evidence (ticket wording, on-ticket reporter feedback,
the code's existing idiom on the same path) — never from
change-minimization instinct: "the ticket does not ask for it" is not
evidence against a change the requirement's own migration makes
visible. Every question is
also rendered ticket-ready (plain text, house style, one main comment,
`Q1.`-numbered, NON-BLOCKING ones state the assumed default) into
`.sz-dev/SZxxxx/deliverables/clarification-comments.md` — the human pastes them; the
ticket stays read-only. Iterative: answers landing re-open evaluation —
new questions continue the numbering in a follow-up round and re-open
E1; the requirement must be FULLY clarified before any later phase
opens.

## Step 5.5 — Requirement review (mandatory when large or BLOCKING
questions existed; the light path records its skip)

A fresh context reads ONLY the artifact + cached raw sources and
checks: (1) claim traceability — every acceptance criterion exists
verbatim in the cache (not found = P0, an invented requirement); (2)
coverage — every use case maps to ≥1 decidable criterion; (3)
ambiguity — any sentence Phase 2 could read two ways resolves from
cache evidence or becomes E1 now. Findings append under `##
Requirement review` with severity + evidence; P0/P1 fixed before gate 1.

## Step 6 — GATE 1

`sz-progress set <SZxxxx> gate 1 passed` — the tool enforces the packet:
`phase1-requirement.md` with the exact `repro:` token, both canonical
ticket caches, and (for red) the `driver data:` line. An open E1 blocks
it instead. Then append the handoff block and stop; Phase 2 runs in a
fresh conversation/context. **Light path**: right after gate 1, run
the six-condition eligibility check (`orchestrated-mode.md`) — all
hold → record the note and continue into Phase 2 in this same
conversation; any miss → the default executor (next session /
sub-agent). No implementation before gate 1 either way.
