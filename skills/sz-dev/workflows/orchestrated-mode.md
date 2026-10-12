# Orchestrated mode

The default executor (SKILL.md "Multi-session model"): the run happens
**inside one conversation** — the main session becomes an orchestrator
and each phase runs as a fresh sub-agent. The `.sz-dev/SZxxxx/` file
contract is unchanged — orchestrated mode and file-based multi-session
are two executors of the same state format, and the human can switch
between them at any session boundary.

## Division of labor

- First action of an orchestrated run:
  `bash "$SKILL_DIR/tools/sz-progress" set SZxxxx meta mode orchestrated`
  — this records which executor owns `progress.md`, so a resume knows
  it is in orchestrated mode rather than file-based.
- The orchestrator (main session) only dispatches, gates, and keeps
  state. **It never implements, reviews its own work, or runs test
  steps itself** — phase work belongs to sub-agents.
- Each phase sub-agent is a fresh context. Its prompt is assembled
  from exactly three parts:
  1. the phase's workflow file (`workflows/phase<N>-*.md`)
  2. the handoff files it must read first (from the handoff block)
  3. the hard rules of SKILL.md (read-only SZ, no commits, scope
     limits) — quoted, not referenced. Pasted material per prompt is
     capped at ~200 lines; anything larger is passed as a file path
     for the sub-agent to read.
- Fix rounds (lint failures, test failures) are separate sub-agents:
  each round gets only the plan + the failure evidence, max **2
  rounds** — the same cap as the file-based loop (contracts.md rule
  1); the counter is incremented with `sz-progress bump <SZxxxx>` after each
  round, so it survives an orchestrator crash (not just in-memory),
  and it resets at each phase transition (the cap is per phase).
- **Replay runs** (`workflows/replay-mode.md`) dispatch exactly like
  normal ones — no special roles. Each sub-agent prompt additionally
  quotes the two replay exclusions (never this SZ's ticket-pasted
  code, never its landed fix commit), and phase sub-agents run with
  cwd in `REPLAY_DIR` and `SZ_DEV_DIR` set (values from
  `sz-replay init`).

Gate state is recorded with `sz-progress set <SZxxxx> gate <n> passed|rejected`
immediately when a sub-agent returns (see SKILL.md "Checkpoint
discipline") — but only AFTER the phase's mechanical trust checks ran
green in the orchestrator's own shell: gate 2/4 need `sz-verify-tree`
(standard) or `sz-replay verify` + `sz-replay audit` (replay; replay
runs must also have their registry entry — see replay-mode "The
switch"), gate 3 needs the test report + evidence on disk. Setting the
gate first and discovering a failed trust check afterwards means
rewinding a milestone that should never have existed.

## Context budget protocol

Context is expendable; disk is not. `.sz-dev/SZxxxx/` is the single
source of truth, and the orchestrator only dispatches and distills.

1. **Raw, high-volume inputs are read only inside sub-agents.** Ticket comments,
   quicksearch result sets, attachments, and whole-file reads of large
   docs must occur in a reader sub-agent that returns a distilled
   artifact written to `.sz-dev/SZxxxx/` (FRD summary <= 100 lines,
   prior-art list, fixture list). The orchestrator never ingests raw
   ticket bodies — Phase 1 ticket reading is a reader sub-agent.
2. **Tool discipline**: `bugs_quicksearch` always with precise
   quicksearch syntax AND a `limit` — bare queries have returned
   multi-MB result sets. Prefer grep / partial reads over whole-file
   reads. Attachment contents are fetched, saved under
   `.sz-dev/SZxxxx/attachment/`, and only their summary + path stay in
   context.
3. **Distill-and-cache**: any tool output longer than about one screen
   is written to disk first, then distilled; downstream sessions and
   sub-agents load `phase1-requirement.md` / `phase4-handoff.md`, never the raw material.
4. **Forced refresh**: besides the per-phase session boundary, if the
   orchestrator's context is over half consumed mid-phase, it
   distills state to disk (progress + handoff block) and continues via
   fresh sub-agents — never by carrying a heavy history forward.
5. **Timing observability**: every phase sub-agent appends per-step
   wall-clock entries (`<unix-epoch> <step-label> start|end`; MCP,
   engine and sz-* calls included) to `.sz-dev/SZxxxx/timings.log` —
   the evidence any post-run "why did this take so long" analysis
   reads; reconstructed timings are not evidence.

## Small-SZ light path (one conversation, no sub-agents)

A small SZ runs the whole flow — gate 1 through gate 4 — in **one
conversation** with no sub-agents; record `mode file` and
`note Ph1: light path`. Eligibility is a **hard pre-check, all six
must hold** (checked after gate 1, when routing and use cases are
known, recorded in `phase1-requirement.md`): (1) one use case; (2)
one layer per routing; (3) expected change ≤ 2 files; (4) no
new-file creation beyond one, and no Makefile/`SCRTn` co-change;
(5) comment thread readable in one pass (no bulky attachments beyond
the FRD itself); (6) no replay exclusions that will degrade two or
more pack capabilities. Any miss → the default executor
(orchestrated). Borderline goes down, not up.

The light path reduces ceremony, never evidence: every gate keeps
its full `sz-progress` packet and every artifact is still written.

1. **Phases share the context.** Phases 2-4 still read their runbook
   files, but the raw ticket caches are not re-read (the requirement
   is already in context) and the conversation does not stop at phase
   boundaries; handoff blocks are still appended for the gate-4
   packet.
2. **Independent review degrades to a same-context self-review** —
   the only sanctioned waiver of the fresh-context rule (`phase2-implementation.md`
   Step 6). Same rubric, same severity ladder; `phase2-review.md` is
   still written, headed `light-path self-review (independent review
   degraded)`.
3. **The TC wiki is authored once** (`phase3-testing.md` owns the
   shape): the case set is written directly in wiki rendering, and
   `phase3-test-plan.md` is a thin index derived from the wiki —
   never a second authoring.
4. **The deliverable set defaults to RN + TC**; CN/IN only on their
   triggers (`phase4-deliverables.md` Step 2).
5. **The requirement review (Phase 1 Step 5.5) stays skippable** on
   its existing rule — record the skip.

**Mid-run exit**: the SZ outgrowing eligibility at any point (a
second use case appears, the diff exceeds 2 files, the check loop
reaches E7, a review P0/P1 needs a second context) exits the light
path — record `note Ph<n>: light path exited` and continue the
remaining phases under the default executor. Escalations are
identical to the default executor; the light path never guesses.

File-based multi-session (the fallback executor) runs the same
sequence one conversation per step:

```text
S1 (P1): in SZ number            -> phase1-requirement.md, gate 1
S2 (P2): in phase1-requirement.md             -> phase2-plan.md, gate 2, diff, phase2-review.md, phase4-handoff.md
S2b (fix): in plan + evidence    -> fix + updated plan (2-round cap)
S3 (P3): in phase4-handoff.md           -> phase3-test-plan.md, phase3-test-report.md, gate 3
S4 (P4): in handoff + report     -> deliverables/, gate 4
```

## Crash and resume

All durable state lives in `.sz-dev/SZxxxx/`; the orchestrator itself
is stateless. If the main session closes:

1. A new session invoking the skill follows the same resume rule as
   file-based mode: read `progress.md`, branch on the gate state
   (`passed` → dispatch next phase; `pending` → re-present the gate
   from the sub-agent's on-disk output, no re-run needed; `rejected`
   → dispatch rework with the recorded feedback).
2. The only loss is a sub-agent killed mid-flight. Mitigation:
   sub-agents write as they go (notes, plan checkboxes, checkpoint
   patches), and the orchestrator updates phase/gate only **after** a
   sub-agent returns. A new "continue" sub-agent reconciles
   `phase2-plan.md` checkboxes against the working-tree `git diff`, then
   finishes the half-done step.
3. Keep sub-agent task granularity small (a phase may be split into
   plan / implement / self-review sub-agents) — smaller granularity
   means a smaller lost half-step.

## Fallback

If sub-agent dispatch is unavailable or a phase sub-agent fails
repeatedly, fall back to file-based multi-session: write the handoff
block, end the turn, and let the human continue in a fresh session.
Both paths read the same `progress.md`, so no state is converted.
The fallback is also the right choice up front for a very small SZ
where per-phase sub-agent overhead dominates.
