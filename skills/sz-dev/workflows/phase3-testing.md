# Phase 3: Testing (AI-executed)

Goal: execute this SZ's reviewed case set on the pack's safe harness;
produce the fixed-format report the human audits at gate 4.
Precondition: gate 2 passed. Hard rules binding this phase: AI-executed
only inside the pack's harness (write-path only through its declared
backup/restore/teardown gates on the designated host); a previous
TCxxxx is background at most; no test runs before the case set passes
machine review.

## Steps at a glance

| # | Step | Mechanism | Output |
|---|---|---|---|
| 1 | Assemble the case set — one authoring pass, directly in the TC wiki rendering (expected-result wording) | project skill `generate-sz-tc` (its stages 1-3 are Phase 1-2's output — reuse, do not redo); `sz-progress set <SZxxxx> phase 3` | `~/sz/TC<SZ>.wiki` + validator pass |
| 1.5 | Derive the thin plan index from the wiki | `sz-gen-deliverable testplan` — one line per case: ID / source label / machine-review verdict / result pointer; never a second authoring | `phase3-test-plan.md` |
| 2 | Machine review (the only pre-execution gate) | coverage / decidability / write-path safety — judged against the wiki's cases via the index | verdict in the plan |
| 3 | Execute (pack `accept`) | designated host; `--dry-run`/smoke first when the pack offers them; read-only first | captured outputs |
| 4 | Record results | `sz-gen-deliverable report` | `phase3-test-report.md` |
| 5 | Failure loop (cap 2 rounds, `sz-progress bump <SZxxxx>`; exit-3-class stop signal → immediate E-escalation, no round consumed) | snapshot → fix → re-check → re-run | updated wiki/report |
| 6 | Close out | full case set re-run for one consistent build; write executed results back into the wiki (once); `sz-progress set <SZxxxx> gate 3 passed` | handoff block, stop |

## Case set (Step 1) — authored once, as the wiki

Write the cases directly as the TC wiki (`~/sz/TC<SZ>.wiki`,
expected-result wording; `generate-sz-tc` + validator pass), then
derive `phase3-test-plan.md` from the wiki as a **thin index** (one
line per case: ID, source label, machine-review verdict, result
pointer). A plan that re-authors case bodies is a defect — gate 3
needs the index plus the wiki, not a duplicate. The TC deliverable in
Phase 4 derives from the same wiki ("derive, never re-author").

Sources in order: (1) the Phase 1 repro case (bug SZs) — promoted;
(2) one scenario per FRD use case / acceptance criterion + confirmed
edge cases; (3) what the actual Phase 2 diff can break — `regression
(diff-derived)`; (4) same-family candidates from the diff's
files/symbols + pack domain knowledge — `regression (same-family)`; the
chosen scope recorded in `phase1-requirement.md`. Sources 1-2 map
one-to-one to FRD points / the defect symptom; 3-4 carry labels +
sources, orphans allowed only there. Pack's case format and its
`accept` row own the schema, runner command, exit codes and the
**stop-on-unsafe signal** (treat it as an immediate stop). Manual-track
parts: FRD points the pack cannot cover — each gets a rendered TC
script for a human; the agent never invents their results.

## Machine review (Step 2) — fix the set until all hold

(a) Coverage: sources 1-2 one-to-one, no orphans/uncovered; 3-4
labeled, none duplicating 1-2. (b) Decidability: every assertion is
machine-decidable (exit code / output diff / ACK text / log grep) —
no "looks right"; and every driver PRINTS its path-gating fixture
fields (the values that select the code path under test) as the first
output lines, so a mis-built fixture shows in the same run instead of
costing a second iteration. (c) Green drivers extract the function
under test from the CURRENT working tree at run time — a staging copy
made before the edit tests the old bytes (observed: one wasted round). (d) Write-path safety: backup + restore + teardown
on every writing case; teardown failure is loud, never silent.

## Execution and evidence (Steps 3-4)

Write the driver once. Builtins come from the pack `architecture-cache.md`
and `facts.md`. Do not grep `cclib` or the installed tree for them. Do not
open earlier delivery tarballs.

No designated host → write-path cases are NOT run locally (manual
track); only read-only modes may run here — this is hard rule 7, not an
escalation. Record per case: command + decisive output (captured to
`.sz-dev/SZxxxx/attachment/`); a `passed` mark without captured
evidence violates the hard rules. Build provenance cited from the
Phase 2 handoff. Teardown verification shown per write-path case. A
manual-track report carrying only not-run entries is legitimate.

## Close out (Step 6)

`sz-progress set <SZxxxx> gate 3 passed` = case set machine-reviewed + evidence-complete
report — an automation milestone; the human audits at gate 4. Append
the handoff block (deliverable hints, residual risks, manual-track
points) to `phase3-test-report.md`, stop. Executed results are
written back into the wiki **here, once** (completed-language
observed results from the report) — Phase 4 only re-runs the
validator and mirrors the file into `deliverables/`, it never
re-renders. When a scenario had to change, update the wiki the same
way — a coverage change is a wiki change, not just a fix.
