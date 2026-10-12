# SZ Dev — repo guide

Operational rules, hard rules, gates, escalations (E1-E7) and the
phase model live in `SKILL.md` — the single source of truth; the
per-phase steps live in `workflows/phase1..4-*.md`. This file keeps
only what those do not cover: how to bootstrap the workspace and how
to find code.

---

## 0. Workspace bootstrap (Phase 0, scripted)

Every invocation starts with:

```text
bash "$SKILL_DIR/tools/sz-workspace" ensure SZxxxx
```

It reuses the current ccsrc checkout, or reuses / creates and clones
`/project/<user>_sz<n>/ccsrc` (full history), and prints
`BRANCH=<baseline branch>` + `WORKSPACE=<path>`. `cd` to the printed
`WORKSPACE=<path>`; all state (`.sz-dev/SZxxxx/`, git, builds) lives
there. `git clone` is allowed — the ban is commit / push.

---

## 1. Finding code (no baked-in path list)

Bound the change set from:

1. The FRD use cases + acceptance criteria (+ Figma when present).
2. Related historical SZs: `git log --all --grep='SZxxxx'` and the
   files those commits touched.
3. The current working-tree files in those areas — read them.
4. Symbol / filename search in the repository for names the FRD uses.
5. If Step 1.5 selected a module pack (Claim → `references/claim/`,
   CQL → `references/cql/`), use its code map as an extra hint.
   Still not ground truth.

Do not assume a file belongs to the requirement from its name alone.
Confirm by reading it.

New requirements may touch areas with no prior SZ. Add those paths
to the Phase 2 plan before modifying them.
