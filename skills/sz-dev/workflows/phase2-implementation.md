# Phase 2: Implementation

Goal: implement the requirement step by step under the plan; no
commits. Precondition: gate 1 passed. Generate skeletons with
`sz-gen-deliverable plan|review SZxxxx`.

## Steps at a glance

| # | Step | Tool/mechanism | Gate-relevant output |
|---|---|---|---|
| 0 | Size check (slice or not) | `sz-progress set <SZxxxx> meta slice n/m`; one slice per conversation | `slices.md` (large only) |
| 1 | Plan (before any code) | `sz-gen-deliverable plan`; bug fixes fill the **remediation-strategy table** | `phase2-plan[-<slice>].md`; `changed-paths.txt` |
| 2 | Plan completeness | open design question → E1 first | — |
| 3 | Implement per step | snapshot → edit → pack `check` → `[x]` | checkpoint patches |
| 4 | Self-review | `sz-gen-deliverable review` (self part) | `phase2-review.md` |
| 5 | Build verify (pack `build`) | manual track → record provenance | handoff section |
| 6 | Independent review (fresh context; light: self-review) | rubric + strategy-narrowness | independent part + gate-2 patch |
| 6.5 | GATE 2 | `sz-progress set <SZxxxx> gate 2 passed` requires plan+review on disk; run `sz-verify-tree` first | gate 2 |
| 7-8 | Handoff + report | `phase4-handoff.md`, session template | handoff block |

## The rules that bind every step

- **Plan first; the plan file is the single source of step state**
  (`[x]` only after the step's verify passed). Every plan path is
  appended to `changed-paths.txt` (sorted, de-duped) — Phase 4's
  authoritative list; write it even when unsliced. Code files only:
  `.sz-dev/` artifacts are never entries and never intent-to-add'ed
  (the snapshot primitive takes code paths) — a state file on the list
  fails `sz-verify-tree` / `sz-replay verify` with a surface mismatch.
- **Remediation strategy (bug fixes, mandatory)**: the plan's table
  lists ≥2 strategies (repair the affected path / bypass or guard at
  the caller / …), each with blast radius and the observable behavior
  delta vs pre-fix; chosen = narrowest that removes the defect, reason
  stated. Any behavior the fix introduces that did not exist pre-fix
  (new ACK segments, new artifacts, new writes) must be justified here
  or it becomes an E1 — the defect defines the fix, not the generic
  code's design intent. Two standing heuristics narrow the choice
  before strategies are compared:
  - **Identifier migration**: when the requirement switches a path's
    identifier (lookup key X → Y), identifier-bearing observables on
    that same path (reject/ACK text, log lines that name the
    identifier) migrate to the new identifier with it — keeping the
    old identifier there is a behavior choice that needs its own
    justification, not the conservative default.
  - **Exact-record resolution**: when the requirement says the
    identifier names the (one, right) record, prefer the exact/unique
    resolver (id-keyed lookup) over a list-returning search plus
    first-element pick — "first of many" contradicts "the right
    record" unless the ticket rules out duplicates.
  - **Error-path short-circuit**: when the defect is a crash on an
    error/reject path inside a shared/generic helper, prefer a
    site-local override that short-circuits the generic path for this
    chain (the chain's own local config file, where the site's
    customizations live) over supplying the generic path's missing
    pieces. A crash never completed the generic behavior, so the
    short-circuit is the narrowest delta vs pre-fix; guarded
    default-mirroring of the generic symbols restores behavior that
    never existed here — new behavior needing its own justification
    (or E1) — and is the fallback only when the requirement itself
    needs that generic behavior on the error path.
- **Snapshot primitive per step** (never `git add -N .` — it sweeps
  other SZs' untracked files):
  `bash "$SKILL_DIR/tools/sz-workspace" snapshot SZxxxx`
  (intents-to-add exactly the plan paths, writes the cumulative
  `checkpoints/step-NN-pre.patch`; rollback recipe printed by the
  tool). Replay tree works the same (keeps `.git`; injected dirs are
  skip-worktree).
- **Build verify uses the pack cache.** The install command, user, and
  destination redirect come from the pack `architecture-cache.md`
  section "Install / build". Run that command once. If the binary is
  not on `PATH`, stop and record the miss. Do not search the host for it.
- **Pack `check` after every step** (the pack's row names the commands;
  degraded: hand-trace its gates into the plan's gate-trace table —
  never let a check's absence read as a pass). Self-fix loop caps at
  **2 rounds**, counted durably (`sz-progress bump <SZxxxx>`; per-phase); then
  **E7**. Real design decision → **E1** (batch independent small ones).
  Cannot verify in this environment → record what/why next to the step.
- **Slices**: one independently shippable use case each; slice-scoped
  plan + `checkpoints/slice-<n>/`; stop the conversation after planning
  or finishing a slice — never two slices in one thread. Ambiguous
  boundaries → E1 before slicing.

## Step 6 — Independent review (the anti-drift gate)

A **fresh context** (sub-agent when available; otherwise next session;
same-context only as a recorded degradation) reads the requirement
summary + full diff + pack `review-checklist`, verifies summary claims
against the raw caches (an invented claim is a P1) and driver-data
provenance, then judges the four criteria in order — requirement met /
style consistent / minimal change / high quality — plus the
**strategy-narrowness check**: does the fix introduce observable
behavior beyond removing the symptom, and was the plan's strategy
choice actually the narrowest? Severity per `contracts.md` (criterion
1 → P0/P1; 2-3 → P1 unless cosmetic; 4 → P2 unless a real defect).
P0/P1 fixed + re-reviewed before the gate. **Light path**: the
same-context degradation is the sanctioned shape — head the review
file `light-path self-review (independent review degraded)`, keep
the rubric and severity ladder; a P0/P1 that needs a second context
exits the light path instead. There the split collapses with the
context: the same agent saves `checkpoints/SZxxxx_gate2.patch` and
sets gate 2 after `sz-verify-tree` passes — the mechanical checks
still hold. Reviewer prompt budget:
verify chain claims with targeted greps and read the diff + the cited
evidence — do not re-derive unrelated framework facts (fresh context
is never waived outside the light path; the budget only scopes what
it re-derives). The
**reviewer** saves the
reviewed cumulative diff as `checkpoints/SZxxxx_gate2.patch`; the
implementer never sets gate 2.

## Steps 6.5-8 — Gate, handoff, stop

`sz-verify-tree SZxxxx` (exit 0 = no commit, in-scope) → `set gate 2
passed`. Write `phase4-handoff.md` (`sz-gen-deliverable` has no
handoff skeleton — plain sections): `git diff --name-status` + per-file
why, build provenance (command + versioned dir), review pointer,
suggested commit message, not-fully-verifiable steps, deliverables
list with reasons. Append the handoff block, report per the session
template, stop. Unfinished slices → name the next slice's session, do
not start Phase 3. **Light path**: after gate 2 the conversation
continues into Phase 3 in the same context — the handoff block is
still appended (the gate-4 packet reads it), but the session does not
end here.

Replay deltas (already injected tree): `sz-replay diff` stands in for
`git diff` where a patch is needed; `cql_lint.py --repo $REPLAY_DIR`
when git-bound; exclusions bind the reviewer like every step —
`workflows/replay-mode.md` owns the details.
