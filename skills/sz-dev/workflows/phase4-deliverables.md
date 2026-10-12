# Phase 4: Deliverables

Goal: produce the cciConnect deliverables; the human submits them —
the agent never writes to the ticket system. Precondition: gate 3
passed. Most Phase 4 mechanics are scripted: prefer the tools over
hand-rolled commands.

## Steps at a glance

| # | Step | Mechanism | Output |
|---|---|---|---|
| 1 | Regenerate the handoff from the final tree | authoritative set = `changed-paths.txt` ∩ working-tree diff (raw diff is a cross-check only — shared checkouts carry other SZs' changes) | `phase4-handoff.md` |
| 2 | Decide the deliverable set | default **RN + TC**; CN only when the change touches configuration; IN only when install/startup changes — deciding inputs: `changed-paths.txt` + Change Context, sibling SZs' precedent as tie-break (no config / install surface → skip, record the skip) | stated list + `sz-progress set <SZxxxx> phase 4` |
| 3 | Generate documents | pack `deliverables` capability first (reverse-generates from the reviewed case set); else `sz-gen-deliverable rn|tc|cn|in` + fill from the actual work | `deliverables/*.md` |
| 3.5 | Package | standard: `sz-workspace package SZxxxx` (plan∩diff, `.sz-dev` leak check, Beijing-time name, `~/sz/`); replay: `sz-replay package` | tarball + `sz-progress set <SZxxxx> meta package <tarball-path>` |
| 3.6 | Confirm + mirror the TC wiki | executed results were written back into the wiki in Phase 3 (once); verify the wiki carries them, re-run the validator, mirror into `deliverables/TC-SZ<wiki>.wiki` so the packet carries both | `~/sz/TC<SZ>.wiki` + `deliverables/TC-SZ<wiki>.wiki` |
| 4 | GATE 4 — the one human checkpoint | `sz-verify-tree SZxxxx --gate4` (mechanical packet checks) + the audit packet | gate 4 passed only after approval |
| 5 | Close out + write-back | contracts.md rule 8; state archive; candidates consolidation | final report |

## Content rules (Step 3)

- RN: what/why, affected app, files, behavior before/after.
- TC: derived from the executed case set / report — AI-executed cases
  show real commands and observed outputs; manual-track parts labeled
  `NOT EXECUTED — manual track`. Never from a suggested plan alone,
  never from a previous TCxxxx. The wiki (`~/sz/TC<SZ>.wiki`) is the
  authored original; the `.md` derives from it — one source of truth
  in two renderings — derive, never re-author.
- CN/IN: exact steps, executable as written — **execute** every verify
  command and transcribe its actual output (a wrong transcribed count
  fails the checkpoint check). No placeholder in a section that applies.
  When that command matches Phase 2 evidence and the source bytes are
  unchanged, transcribe that evidence. Do not install again.

## Light path

Steps 1-3 may run in one pass with the Phase 2-3 context (no session
boundary — see `orchestrated-mode.md`). Every document is still
written in full: the gate-4 packet does not shrink — what shrinks is
the number of re-renderings (the wiki is authored once, the `.md`
derives) and the review ceremony (Step 2's decision still recorded,
Step 1 still regenerates the handoff from the final tree).

## GATE 4 (Step 4)

Run `bash "$SKILL_DIR/tools/sz-verify-tree" SZxxxx --gate4` (standard)
or `sz-replay verify` + `sz-replay audit --forbid <fix-sha>
<attachment-ids>` (replay): HEAD at `base`, change set in scope, CHANGES
patch file set == plan, package listing == plan, handoff + RN/TC on
disk. What the script cannot judge — and what the packet must present
for the human — is the behavior: present the per-phase inventory as
clickable links (absolute paths, grouped Phase 1-4, the diff as the
first read), plus `deliverables/CHANGES-SZxxxx.patch` (REQUIRED,
generated in 3.5 alongside the package; replay: `sz-replay diff`
output). State-root outside the workspace → a workspace symlink for
access, but the packet links the real path. Then wait.

After approval: `sz-progress set <SZxxxx> gate 4 passed`; human requests changes → re-run
the affected Phase 2/3 work, then **rebuild** the package (a package
built before rework is stale). Replay delivery = the run's own tested
code (`sz-replay package`; `--fix-commit` builds a suffix-marked audit
intermediate, never the delivery).

## Close out (Step 5)

Record deliverables + remaining human actions in `progress.md`. Write
back (contracts.md rule 8): symptom-level facts → the owning pack topic
file (no SZ number in headings; never the validating SZ); host/arch
facts → the pack's `architecture-cache.md` (bump dates, correct
contradictions — the correction IS the refresh); per-SZ findings not
yet pack-worthy → `.sz-dev/SZxxxx/deliverables/write-back-candidates.md`;
3+ entries on one theme → consolidate into the pack now. Also tar the
run's state directory for offline audit (`SZxxxx_szdev-state_<Beijing
time>.tar.gz`; replay: before `sz-replay finish`, or from the copied-out
state), quarantine stale earlier packages of this SZ from `~/sz/`, and
name the single delivery package + state archive in `progress.md`.
Replay cleanup per `workflows/replay-mode.md` (copy out → `finish
--copied-to` → tree deleted).
