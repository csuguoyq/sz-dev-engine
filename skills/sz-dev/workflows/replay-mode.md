# Replay mode (SZ already in the repository)

**Trigger**: the SZ's fix commit is already in local git history —
Phase 0 decides (`MODE=replay` from `sz-workspace ensure`), Phase 1
Step 3 confirms the exact commit. Record the decision in
`phase1-requirement.md`. Direct replay, no extra confirmation, when the
fix commit is found locally AND the ticket has passed check-in in
either field: `state: Approval` or `status` at/past
`CheckInFinished`. Earlier combinations still require the human
confirmation. Fixed/Closed without a local fix commit stays a normal
run — replay needs the commit, not the status field.

## One principle: the flow IS the normal flow

Phases 1-4 run exactly as written in their workflow files — same
steps, gates, artifacts, single final checkpoint. Exactly two deltas
apply — to every phase, step, and sub-agent:

### Delta 1 — baseline is `fix-commit^`, not latest code

- All work happens in the replay tree: `sz-replay init <SZxxxx>
  <fix-commit>` (standard workspaces replay in place at
  `{user}_sz{n}_aireplay/ccsrc` — the `ccsrc` path segment keeps
  getsrcroot-bound builds working; `SZ_REPLAY_HARNESS_SRC` names the
  current-harness source for the skills/ + `cql/test/` injection when
  the registry holds no other checkout). Prints `REPLAY_DIR` /
  `SZ_DEV_DIR` / `BASELINE_COMMIT` / `FIX_COMMIT` / `COPIED`. The tree
  keeps `.git`: prior-art `git log`/`git show` on OTHER SZs runs in
  place; baseline bytes are `git show <BASELINE_COMMIT>:<path>`; the
  snapshot primitive (`sz-workspace snapshot`) and per-step patches
  work unchanged — injected dirs are skip-worktree, excluded from
  `sz-replay diff`. Every later session `cd`s to `REPLAY_DIR` and
  exports `SZ_DEV_DIR`.
- **Commit disambiguation** (fix vs backport; stat-only — never the
  hunks, that is reading the answer): (1) parents — a merge whose
  message matches is not the fix; the file list answers "source files,
  not a merge?"; (2) **branch domain wins** — prefer the commit on the
  branch the workspace derives from (`ensure`'s detection follows the
  same rule); (3) C-3PO cross-reference when two candidates both look
  real; record which signal decided.
- **Build recipes that need the source root**: `Make/getsrcroot`
  resolves only a ccsrc-named cwd (symlinks do not help —
  `Cwd::cwd` canonicalizes); use a hard-linked ccsrc-named copy
  `cp -al $REPLAY_DIR /project/<parent>/ccsrc-replay-<SZ>`, build
  outputs to the version dir, never edit sources through the copy.
  Zero-compile changes are unaffected. Tooling that still cannot run
  (baseline predates the harness, git-bound tools): record the
  concrete limit and degrade that one check — never skip silently.

### Delta 2 — the answer is out of bounds

Four sources are contamination; no phase, step, or sub-agent may read
them. Quote the exclusions into every sub-agent prompt:

1. **Code pasted on this SZ's ticket** — code blocks/diffs in the
   thread, attachment diffs, TC expected outputs, this SZ's own
   RN/CN/IN texts. Reading the SZ (requirement text, RCA, change
   context, repro steps, input messages) is unchanged; pasted code is
   skipped wherever it would surface. Input-message attachments are
   sanctioned repro fixtures — pass their IDs to `sz-replay audit` as
   evidence sources, never as `--forbid` tokens; `--forbid` takes the
   fix SHA(s) and the pasted-code attachment IDs only.
2. **This SZ's fix commit(s)** — never `git show`/open/read the diff,
   files at that commit, or the MR, from any source. `--stat` /
   name-status only, for disambiguation. Disambiguation rule above.
   **Artifact convention**: the literal SHAs live only in
   `progress.md` notes, `phase1-requirement.md`, the ticket caches,
   and sub-agent prompts — durable run artifacts (plan, review,
   handoff, deliverables) refer to them as "the fix commit" /
   "the backport candidate". `sz-replay audit --forbid` treats those
   literals as contamination anywhere else, so quoting them in a
   plan or review manufactures a scrub round every replay.
3. **Module-pack files named after or derived from this SZ** —
   mechanize with `sz-replay exclusions <SZxxxx>` BEFORE the switch
   (names only — a content grep would print the fix mechanism into
   context); every printed file is out of bounds for the whole run,
   even to grep. Record the capability degradation table (file →
   capability → compensation) in `sz-progress note` immediately (the
   only durable record until the artifact exists) and restate it in
   the `## Replay mode` section.
   - **Write-back convention (prevents source 3)**: pack findings are
     symptom-level — no SZ number in headings; other SZs may be cited
     as worked examples, never the validating SZ; a shared pack file
     can encode the fix location without any number, so routing and
     review re-derive every load-bearing fact from the baseline tree
     and treat pack facts as corroboration (`architecture-cache.md`
     included in the grep; keep its write-backs generalized).
   - **Grep is necessary, not sufficient** — the re-derivation rule
     above is the real guard.
4. **Status signals as change-surface hints** — this SZ's C-3PO
   "Checked in" file list, MR file list, or any landed-fix file name /
   file count must not inform routing, plan placement, or the change
   surface (hard rule 2 makes them status signals; in replay they are
   also answer leaks). Derive routing and placement purely from the
   baseline tree + requirement text; a validation run whose plan
   cites "the landed change's file" has already lost the re-derivation
   property even if it never opened a diff.

The **size-lookback** (gate 4 packet, `sz-replay` stats): alongside
`CHANGES-SZxxxx.patch`, present `git show --stat <fix-commit>` line
counts next to this run's diff counts (stat only, no hunks — allowed
by source 2's carve-out). A run whose diff is an order larger than the
landed fix is not wrong by that fact, but the human must see it —
divergence is legitimate, unexamined divergence is not.

## The switch (mid-Phase-1 mechanics)

1. Confirm per the status rules.
2. `sz-replay init <SZxxxx> <fix-commit>`, `cd` to `REPLAY_DIR`,
   export `SZ_DEV_DIR`. This step is mandatory even when `sz-workspace
   ensure` already relocated the workspace and checked out the baseline
   (ensure prints `checked out pre-fix baseline ...` and looks complete):
   init is what creates the registry entry `.path`/`.meta` that
   `sz-replay verify / audit / diff / package / finish` all read — skip
   it and every downstream trust check dies with "no replay entry".
   Init is idempotent in the single-workspace layout (tree already at
   the baseline): it re-marks skip-worktree, re-injects `skills/` (set
   `SZ_REPLAY_HARNESS_SRC` to the developer checkout so the CURRENT
   pack lands in the tree, not a sibling workspace's stale one) and
   never touches existing `.sz-dev/` state.
3. Move the state: `mv <workspace>/.sz-dev/SZxxxx
   <REPLAY_DIR>/.sz-dev/SZxxxx` (everything so far is requirement-side,
   in-bounds). Re-anchor: `sz-progress set <SZxxxx> meta base "$(git -C
   $REPLAY_DIR rev-parse HEAD)"` (the tool notes the change loudly).
4. Record in `progress.md` notes + next handoff: replay mode, the four
   env values, the four exclusions, degradation table.
5. Resume the interrupted Phase 1 step in the tree (routing, code
   review on the baseline, red repro — all work unchanged).

## When replay init is infeasible

No local checkout carries the fix / disk forbids extraction / the
baseline tree cannot host the run → do NOT silently continue as a
normal run: record the concrete blocker in the artifact, escalate
**E5**; only with the human's explicit waiver continue as a documented
deviation — every post-fix-rendered artifact notes `rendered against
post-fix code — replay baseline unavailable`, stated at the top of the
final report.

## Cleanup and delivery

- Trust checks before finishing: `sz-replay audit <SZxxxx> --forbid
  <backport-sha> --forbid <attachment-id>...` (forbidden tokens
  confined to progress.md / phase1-requirement.md / the raw ticket
  caches — anywhere else is the answer leaking) and `sz-replay verify
  <SZxxxx>` (change surface == changed-paths.txt; cumulative diff ==
  the reviewed gate-2 patch). Both must pass for the gate-4 packet.
- Honest cleanup: `rsync -a $REPLAY_DIR/.sz-dev/SZxxxx
  <workspace>/.sz-dev/` then `sz-replay finish <SZxxxx> --copied-to
  <workspace>/.sz-dev` (verifies byte-identical, clears, deletes the
  tree; `--force` skips the check — the dishonest path; non-guard file
  types — drivers, evidence, case YAMLs — are never checked by either
  form, so the copy-out must cover them by design). The workspace
  symlink dies with the tree; copy out anything that must outlive the
  audit — or rely on the Step 3.5 state archive. Audit packet paths:
  ALWAYS absolute paths under the run's engineering directory (the
  sz-workspace-resolved workspace), never paths relative to whatever
  directory a session happened to start in — sz-dev may be invoked
  from anywhere and the registry resolves the engineering dir; a
  foreign session root must never gain symlinks to it.
- Gate-4 package: `sz-replay package <SZxxxx> <paths>...` (the tested
  code; `--fix-commit` = the suffix-marked audit intermediate, never
  the delivery). Copy the full diff into
  `deliverables/CHANGES-SZxxxx.patch`.

A replay diff that differs from the (never-read) historical fix is not
a failure — there is no comparison. The run is judged by the same
review, tests, and final checkpoint as any normal run; only the
size-lookback above makes the divergence visible.

