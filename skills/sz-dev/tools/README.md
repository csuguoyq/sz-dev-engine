# sz-dev tools

Command-level reference for the tools in this directory. SKILL.md's
"Tools" table keeps the one-line purpose per tool; this file owns the
flags, env vars and command lists. Every tool also prints its usage
when invoked with no args (`sz-progress` / `sz-workspace` exit 2 on
usage — `sz-preflight` smoke-checks exactly that).

Invocation: `bash "$SKILL_DIR/tools/<name>" ...` (or directly / via
PATH — the tools carry the execute bit), never a path relative to the
ccsrc working directory. Exception: `sz-doctor` is Python — run it as
`python3 "$SKILL_DIR/tools/sz-doctor"`.

## sz-workspace

Phase 0: resolve / create / clone the ccsrc workspace.

```text
sz-workspace ensure <SZxxxx> [--name <project>] [--url <git-url>]
                    [--branch <name>] [--root <dir>] [--inplace]
sz-workspace check [dir]
sz-workspace snapshot <SZxxxx> [--label <name>]
sz-workspace package <SZxxxx> [--out <dir>]
sz-workspace list [--stale]
sz-workspace remove <SZxxxx>
sz-workspace sync-skill
sz-workspace mr <SZxxxx> --title <t> --target <branch> [--approved]
sz-workspace config          # print the per-user clone-config setup
```

- `snapshot` is the step checkpoint primitive (Phase 2 Step 3):
  intent-to-add exactly the `changed-paths.txt` paths, write the
  cumulative binary diff to `checkpoints/<label>.patch` (auto-label
  `step-NN-pre`), print the rollback recipe. Works in standard and
  replay trees alike.
- `package` builds the delivery tarball for a standard run (replay:
  `sz-replay package`): plan ∩ working-tree diff paths only, Beijing-
  time naming, written to `~/sz/` (or `--out`), contents listed and
  checked for `.sz-dev`/`attachment` leakage; prints `PACKAGE=<path>`.
- `sync-skill` pushes the repository's skills/sz-dev (the tool's own
  copy — the source of truth) to the installed `~/.zcode/skills/sz-dev`
  and to every registered workspace's / replay tree's seeded copy, then
  verifies each target with `diff -rq`. Tracked skill files in
  workspaces are marked skip-worktree (the `sz-replay init` mechanism)
  so the seeded copy never surfaces as a working-tree change. Prints
  `SYNCED=<n>`. Target override: `SZ_SKILL_INSTALL_DIR`; refuses to run
  from the installed copy (that would sync backwards).
- `ensure` prints `MODE=<standard|replay>` + `BRANCH=<baseline
  branch>` + `WORKSPACE=<path>`; MODE is replay when the SZ's fix
  commit already exists in local git history — the commit hint prefers
  the workspace's own branch history (hotfix backports lose), falling
  back to `--all` only for the mode verdict. A candidate counts as the
  fix commit only when the SZ id appears in its SUBJECT (check-in
  convention) — a body mention in an unrelated commit never qualifies,
  so keep SZ numbers out of unrelated commit messages.
- Per-user defaults come from `~/.config/sz-dev/config` (KEY=value
  lines; `SZ_DEV_CONF` overrides the path). Put a personal GitLab PAT
  clone URL there —
  `SZ_CC_SRC_URL=https://<user>:<token>@vembgitlab.clinicomp.com:5443/ai/ccsrc.git`
  (scopes `read_repository` + `write_repository`; `chmod 600`; never
  commit it) — so `ensure` clones without an interactive prompt. When
  a clone fails on auth and the shell IS a TTY, `ensure` captures
  username + PAT once (same file, same lifetime as the token) and
  retries by itself; without a TTY it prints the setup block for the
  user instead (`sz-workspace config` prints the same steps).
- A ccsrc checkout hosting another SZ's `.sz-dev/SZ*` state tree is
  refused unless `--inplace` is passed; the acceptance is persisted
  (`.sz-dev/.shared-inplace`) and later runs are idempotent.
- `mr` is two-stage: without `--approved` it prints the proposal
  (source branch, target, title, and the full file list — paths
  outside `changed-paths.txt` are flagged) and exits 1; with
  `--approved` it commits the delivery files on `sz/SZxxxx` and
  pushes with GitLab push-options to create the MR. Refuses before
  GATE 4 passed, and refuses to push from any non-standard path (the
  developer checkout never pushes).

## sz-preflight

Invocation-start dependency check: bash / git, the skill's own tools
(`sz-progress` / `sz-workspace` usage health), softzilla network
reachability. Exit 0 = hard checks green; exit 1 = stop the run and
hand the FAIL lines to the human. Network reachability does NOT prove
MCP auth — the agent's real `bug_info` probe (Phase 1 Step 0 item 3)
still decides that. Env: `SZ_SOFTZILLA_URL` (endpoint override),
`SZ_DEV_SKILL_DIR` (skill-dir override; auto-resolved otherwise).

## sz-progress

Phase / gate / awaiting state machine (state root: `$SZ_DEV_DIR` →
nearest `.sz-dev/` at or above the cwd → the sz-workspace registry).

```text
sz-progress init <SZxxxx>
sz-progress show <SZxxxx>
sz-progress set  <SZxxxx> phase <1-4|aborted> [--force]
sz-progress set  <SZxxxx> gate <1-4> <pending|passed|rejected> [--force]
sz-progress set  <SZxxxx> meta <mode|track|slice|base|package> <value>
sz-progress awaiting <SZxxxx> <E1-E7|clear>
sz-progress constraint <SZxxxx> <text...>
sz-progress note <SZxxxx> <text...>
sz-progress bump <SZxxxx>          # fix-round counter (per phase)
```

Gate evidence enforced mechanically: gate 1 needs
`phase1-requirement.md` with the `repro:` token, the raw ticket
caches, and (for `repro: red`) a `driver data:` provenance line;
gate 2 needs `phase2-plan*.md` + `phase2-review.md`; gate 3 needs
`phase3-test-plan.md` + `phase3-test-report.md`; gate 4 needs
`deliverables/CHANGES-SZxxxx.patch`, a non-empty `phase4-handoff.md`,
`RN*.md` + `TC*.md` under `deliverables/`, and a `package` meta key
whose file still exists. Forward phase/gate movement is refused while
an escalation is open; gates cannot be skipped; `--force` overrides
with a recorded note.

## sz-verify-tree

Mechanical no-commit / in-scope verification for a standard run:
HEAD == the recorded `base`, and the working-tree change set ==
`changed-paths.txt` (strays fail; `.sz-dev/.shared-inplace` downgrades
them to warnings; planned-but-untouched paths warn). Exit 0 clean |
1 findings | 2 state error. `--workdir` overrides the workspace root;
`--gate4` adds the mechanical packet checks (CHANGES patch file set ==
plan, delivery package listing == plan, handoff + RN/TC deliverables
on disk). Replay runs refuse here — use `sz-replay verify` +
`sz-replay audit`.

## sz-replay

Replay plumbing (`workflows/replay-mode.md` is the runbook):

```text
sz-replay init <SZxxxx> <fix-commit>    # isolated baseline tree (fix-commit^);
                                        # reusing an existing tree resets any
                                        # tracked files an earlier run left
                                        # dirty back to the baseline (keeps
                                        # .sz-dev run state)
sz-replay status <SZxxxx>
sz-replay diff <SZxxxx> [--names]       # working tree vs baseline
sz-replay package <SZxxxx> [--fix-commit] <paths>...
sz-replay exclusions <SZxxxx> [--save <file>]
sz-replay audit <SZxxxx> [--forbid <token>]...  # ids declared on
                                        # phase1 'driver data:' lines are
                                        # auto-exempted (in-bounds inputs)
sz-replay verify <SZxxxx>               # tested code == reviewed code
sz-replay finish <SZxxxx> [--copied-to <dir>] [--force]
```

## cql-run

The ONLY sanctioned engine invocation: enforces timeout
(`--timeout <s>`), output cap (`CQL_MAX_OUT_MB`), stdin discipline
and `$CCRUN` presence (`CCRUN_BIN` overrides the binary for tests).
Every engine call in a run goes through it.

## sz-gen-deliverable

Nine artifact skeletons — deliverables (rn/tc/cn/in) and phase
artifacts (phase1 / plan / review / testplan / report); stdout, or
write straight to disk with `-o <path>` (refuses to overwrite a file
that is not an unfilled skeleton):

```text
sz-gen-deliverable rn|tc|cn|in <SZxxxx> "<title>" [-o <file>]
sz-gen-deliverable phase1|plan|review|testplan|report <SZxxxx> [-o <file>]
```

## sz-doctor

Framework health check (tools smoke, pack capability tables, refs,
contract, hygiene, drift, state keys, arch cache, user config).
Python — run as `python3 "$SKILL_DIR/tools/sz-doctor"`, not bash.

## selftest

Behavior-level tool regression in a synthetic env (fake engines,
throwaway git repo + registry — no engine, no DB, no network): cql-run
happy/fail paths, sz-replay init/diff/verify/audit/exclusions/finish,
sz-preflight self-location, sz-verify-tree clean/stray/HEAD-drift.
Run after changing any tool.
