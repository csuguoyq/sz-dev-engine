# sz-dev framework / module-pack contract

This file defines what a module pack under `references/<module>/` must
provide so the sz-dev framework can drive a SZ automatically. The framework
(`../../SKILL.md` + `workflows/`) is module-agnostic: at each query point it
looks up the capability in the pack of the SZ's module. If a capability is
absent, that step degrades to the manual track (human executes, AI renders
the artifacts).

## Capability contract

A pack declares capabilities in its `README.md` using this table
shape — columns: Capability (framework question) | Phase | File(s),
one row per capability, `manual track` as the File(s) entry when the
pack does not implement it (the CQL pack is the reference
implementation; the framework-side view of the same contract is the
table below):

| Capability | Framework query point | Question answered |
|---|---|---|
| `check` | Phase 2, after every step | "Is this change OK so far?" — fast, read-only, deterministic; exit code + report |
| `repro` | Phase 1 (bug-type SZs) | "Can the defect be produced pre-fix and removed post-fix?" — red/green case |
| `routing` | Phase 1 | "Which layer/component did this SZ touch, and what mandatory co-changes follow?" |
| `accept` | Phase 3 | "Full acceptance + same-family regression" — write-path allowed, must have safety gates (backup/restore/teardown) |
| `build` | Phase 2 end | "Does it compile/install on the target host, into a versioned dir?" |
| `deliverables` | Phase 4 | "Generate TC/RN/IN/CN drafts from the case set + diff" |
| `review-checklist` | Phase 2.5 | "What must a reviewer check beyond lint?" — module red lines + historic bug classes |

Capability files answer the question for the machine: entry commands, exit
codes, report paths. Prose background is secondary.

## Framework rules that reference the contract

Priority order when guidance conflicts: SKILL.md hard rules > gate
evidence requirements (`sz-progress`) > these rules > workflow steps >
pack files > worked examples. Never resolve a conflict by silently
inventing an exception.

0. **Context budget** (see `workflows/orchestrated-mode.md`
   "Context budget protocol"): raw,
   high-volume inputs (ticket comments, quicksearch results,
   attachments, large files) are read only inside sub-agents and
   distilled to `.sz-dev/SZxxxx/` artifacts; the orchestrator
   consumes distilled artifacts only. Packs should keep their files
   grep-able — one question per file, stable headings.
1. **Inner loop (Phase 2)**: run `check` after every implementation step;
   on failure self-fix, max 2 rounds, then escalate.
2. **Repro gate (Phase 1)**: for bug-type SZs the repro conclusion is
   mandatory gate-1 evidence, in one of three states: `repro: red`
   (the case ran red on pre-fix code — the strong path),
   `repro: n/a` (feature SZ), or `repro: manual` (the pack's repro is
   manual track — the case is rendered for a human, not executed; only
   an *executed* repro failure or symptom mismatch escalates E3).
3. **Review (Phase 2.5)**: an independent-context reviewer reads
   (requirement summary + diff + `review-checklist`) and classifies
   findings with the severity rubric below. P0/P1 findings must be
   fixed and re-reviewed before the checkpoint; findings live in
   `.sz-dev/SZxxxx/phase2-review.md` — a **two-part file, one
   layout**: `## Self-review` (the implementer's own pass, written
   at the end of implementation) then `## Independent review`
   (appended by the fresh-context reviewer: findings with severity +
   evidence, replay-exclusion compliance check, verdict
   `pass | pass-with-P2 | rework-needed`, and `re-review required:
   yes/no`). Gate 2 passes only once the Independent review section
   exists with no outstanding P0/P1 — except on the light path
   (`orchestrated-mode.md`), where the fresh-context waiver applies
   and the Self-review section alone satisfies the gate, headed
   `light-path self-review (independent review degraded)`; a P0/P1
   found there is fixed and re-checked in the same context, or the
   run exits the light path. Ownership: the **reviewer**
   saves the reviewed cumulative diff as
   `checkpoints/SZxxxx_gate2.patch`; the **orchestrator** (or the
   next session) sets `gate 2 passed` via `sz-progress` after the
   reviewer returns — the implementer never sets gate 2. When the
   pack exists but its review-checklist file is unavailable
   (replay-excluded, unreadable), the reviewer reviews from the
   severity rubric + SKILL.md hard rules + first principles and
   records the degradation — never skips silently.
4. **Test-case machine review (Phase 3.2)**: before execution — (a) for
   FRD-derived and repro-derived cases: FRD point / defect symptom ↔
   scenario coverage is one-to-one; regression cases (diff-derived,
   same-family) are exempt from the one-to-one rule but must be labeled
   `regression` with their source; no orphan cases among sources 1-2;
   (b) every assertion is machine-decidable (exit code / output diff /
   ACK text); (c) write-path cases carry backup + restore + teardown.
5. **Test-case human audit**: the machine review (rule 4) gates execution —
   no test runs before the case set exists and passes it; the human
   **audits** the case set at the final checkpoint, after execution,
   together with the report. There is no pre-execution human approval gate.
6. **Regression (Phase 3.3)**: run the current SZ's cases plus regression
   candidates for the same family — derived from the diff's files and
   symbols plus the pack's domain knowledge (which layers a touch
   typically breaks); the chosen scope is recorded in `phase1-requirement.md`.
7. **Deliverables (Phase 4)**: generated by `deliverables` from the reviewed
   case set; the reviewed cases ARE the TC — no second authoring.
8. **Write-back (Phase 4 end)**: new templates, new traps, new repro
   recipes discovered during the SZ are added to the pack (not to
   AGENTS.md, not to chat). Locations, explicitly:
   - **Pack edits** go to the workspace clone's
     `skills/sz-dev/references/<module>/` files. On the standard
     per-SZ workspace they ride the delivery MR (`mr` stages them
     with everything else and lists every file in its proposal); on
     a reused checkout they stay working-tree changes the human
     carries over. This is the sanctioned exception to SKILL.md hard
     rule 5 — symptom-level only: no SZ number in headings, and
     never the validating SZ's own number or mechanism (the replay
     write-back convention below).
   - **Per-SZ candidates** that are not yet pack-worthy accumulate
     in the run's `.sz-dev/SZxxxx/deliverables/write-back-candidates.md`
     (inside the state tree, so they never enter the delivery
     package): one bullet per candidate — `<pack> <file to touch>:
     <insight>` — plus a one-line evidence note.
   - **architecture-cache.md** (per pack): any host- or
     architecture-level fact the run validated or re-derived updates
     it (bump `cache-date` / `valid-until`; correct contradicted
     facts on the spot — the correction IS the refresh).
   - **Consolidation (threshold)**: at closeout, if the candidates
     file holds **3+ entries sharing one theme** and no pack topic
     file covers that theme, consolidate them now into the owning
     pack file (symptom-level) and delete them from the candidates
     file — a candidates file that only ever grows is deferred work,
     not knowledge. A replay run keeps the exclusion rule in force
     while consolidating: nothing citing the validating SZ's number
     or mechanism enters the pack.

## Review severity rubric (Phase 2.5)

| Level | Definition | Handling |
|---|---|---|
| P0 | Data loss or corruption; a red line crossed (production path/binary, unrestored patient data, ticket written); the FRD's core use case wrong | Must fix and re-review before the checkpoint; escalate immediately |
| P1 | FRD deviation in a non-core path; regression risk; missing co-change (e.g. `cql.hlp`, `cci.c` registration, `SCRTn`); non-portable fixture; **strategy-wide fix** — the diff introduces observable behavior the defect's removal does not require (new ACK segments, new artifacts, new writes), or a narrower remediation strategy was available and not argued against in the plan's strategy table | Must fix and re-review before the checkpoint |
| P2 | Robustness, style, maintainability, missing boundary evidence | Record in `phase2-review.md` / handoff; fix only if cheap and in scope |
| P3 | Nit, preference | Ignore |

## Human involvement

- One fixed checkpoint per SZ (gate 4): final review of diff + review
  report + test report + deliverables; the human performs commit /
  MR / ticket submission. MR creation is two-stage: the tool proposes
  (`mr`), the human approves (`mr --approved`).
- Escalations (E1-E7) and the deterministic, never-escalated defaults
  are defined in SKILL.md ("Escalations" and "Deterministic") — that
  section is canonical; this file does not restate them.
- Everything else is AI-executed (autonomy level L2: AI acts, human audits).

## Adding a new module

1. Create `references/<module>/README.md` with the capability table:
   all 7 rows must be declared; a capability the pack does not
   implement gets `manual track` as its File(s) entry (this is what
   `sz-doctor` checks — an omitted row is a contract violation, not
   a degradation).
2. Fill capabilities incrementally; each one should be verified on a real
   host before its entry claims "verified".
3. Keep module knowledge inside the pack. `AGENTS.md` gets one line in the
   skill table, nothing more.
