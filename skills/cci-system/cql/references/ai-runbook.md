# AI Agent Runbook — develop + test in `cql/` without a human at the keyboard

Companion to [../SKILL.md](../SKILL.md). This is the **standard single loop** an AI session runs
when asked to change or verify anything under `cql/`. Each step has an explicit input, action and
exit criterion, so the agent can self-check instead of asking.

Prerequisites before step 1: [runtime-environment.md](runtime-environment.md) (env, flags,
permissions) and [builtins-reality.md](builtins-reality.md) (never call an unproven symbol).
Test mechanics: [automated-testing.md](automated-testing.md).

## The loop

```
0 ORIENT → 1 UNDERSTAND → 2 PLAN(range lock) → 3 CODE → 4 INSTALL
        → 5 TEST → 6 SELF-FIX (≤3 rounds) → 7 REPORT → 8 WRITE-BACK
```

---

### Step 0 — ORIENT (never skip)

- Read [../SKILL.md](../SKILL.md) §0 to pick the direction; read only the sections it routes to.
- Resolve the runtime: `echo $CCRUN $CCSYSDIR $CCBINDIR; hostname; ls $CCRUN/cql | wc -l`.
- Confirm escalation: `.dosu true` (needed for every DB-touching step).
- Smoke: `echo '(printf "%S" (+ 1 2))' | $CCBINDIR/cql -b -n` ⇒ `3`.

**Exit:** env values known, cis escalation status known, binary runs. If any of these fail, stop
and report an environment block (do not "work around" by editing installed files).

### Step 1 — UNDERSTAND

- Find the module: `cql/lisp/*.scm` (core & reports), `cql/lisp/hl7/hl7common/` (shared engine),
  `cql/lisp/hl7.<site>/` (customer config), `cql/scripts/` (entry points), `cql/gdb/`, `cql/archive/`.
- Read **one comparable existing file** and copy its banner + change-log style.
- For anything HL7-shaped, read [hl7-site-config.md](hl7-site-config.md) before touching a file.

**Exit:** you can name the exact files and symbols you will change.

### Step 2 — PLAN (range lock)

Write down the change set explicitly. For the canonical "new report app" this is exactly four
files — anything beyond needs a human:

1. `cql/lisp/<name>.scm` (new)
2. `cql/lisp/menu.scm` — one `(list "<Title>" "<name>.scm" <PERM-or-nil>)` into `choices`
3. `cql/lisp/cql.hlp` — help entry, strict alternating list/string form
4. `cql/lisp/Makefile` — a **new, unused** `SCRTn` number (the list is explicit; gaps are historical)

Also decide the test cases now (at least one `pure` or `db` case) and their expected strings.

**Exit:** a 4-item change list + ≥1 case with expected output. No "while I'm here" edits.

### Step 3 — CODE

- Standard banner (`;;; FILE:` / `;;; DESCRIPTION:` / `;;; AUTHOR:` / Copyright) + a dated
  change-log line matching the file's existing style.
- Start the file's batch path with `(load "init.scm")`; never call `readline` / `menu` /
  `window-size` in code that must run under `-b`.
- Expose a callable entry `(define (run-<name> pat) …)` and keep output in `printf`, so the test
  asserts on stdout.
- Prove every non-obvious built-in first (builtins-reality §1).
- Site-specific behaviour stays in the site dir — never generalise one customer's mapping into
  `hl7/hl7common`.
- Do not edit `*.OLD`, `*.template`, `*.test`, `*.work`, `*.before`, dated scratch files (history).

**Exit:** file lints by eye, no unproven symbols, entry point callable in batch.

### Step 4 — INSTALL

```sh
make -C cql/lisp                      # core .scm -> $CCRUN/cql   (dry-run first: make -n)
make -C cql/lisp/hl7                  # only if you changed the shared engine
.dosu cql/lisp/setup_cql_hl7 -t <site> [-m <module>|all]   # HL7 sites only
```

- Verify the artefact landed: `ls -l $CCRUN/cql/<name>.scm` — a file with **no `SCRTn` entry is
  silently not installed**; that is the most common "my change did nothing" cause.
- Rollback: installed files carry a `.OLD` sibling; restore from it, don't re-edit in `$CCRUN`.

**Exit:** the new/changed file exists under `$CCRUN` with a fresh timestamp.

### Step 5 — TEST

```sh
# unit-ish, any user
echo '(load "init.scm")(printf "%S" (compute-score 4 5 6))' | $CCBINDIR/cql -b -n

# DB-touching, must be cis, must be read-only
.dosu $CCBINDIR/cql -b -n <<'EOF'
(load "init.scm")
(load "edits.scm")
(all-report-by-obs-time (patient-by-dbpath2 "vol9/p1645486329"))
EOF

# help integrity after any cql.hlp edit
$CCBINDIR/cql -b -i$CCRUN/cql/testhelp.scm -e </dev/null
```

Run the full suite (groups `pure` → `db` → `menu` → `hl7`) and capture every run's stdout.

**Exit:** per-case PASS/FAIL/SKIP recorded; exit codes captured (0 = ok, 1 = error).

### Step 6 — SELF-FIX (max 3 rounds)

| Symptom | First thing to check |
|---|---|
| `ERROR: unbound variable` | missing `(load "init.scm")` — the symbol is probably a `dbutil.scm` helper (builtins-reality §2) |
| `ERROR: file not found (see errobj)` | `load-path` is `(cwd, $CCRUN/cql)`; the file installs somewhere else (e.g. `util.scm` → `$CCRUN/cql/hl7`) — use an absolute path or `cd` |
| `db-def: IT not a number` | `name-to-it` returned `nil` — wrong item name |
| `Ndbopen(...) [Permission denied(13)]` | not running as cis |
| `error in ioctl call` | something called `window-size` (e.g. loading `cql.scm`) in batch |
| hangs / waits for input | the script reads stdin (a `menu.scm`-style self-executing file, or `starthl7*.scm`'s `hl7-main`) |
| `make` prints `Not compiling $@ on host …` | the Makefile's `SYSLIST` excludes this host (e.g. `cql/siodptx` and `$(PTX)`) |
| HL7 "not processing" | MSH-11 gate — check `process-t` / `process-d`, not the handler |
| change has no effect at runtime | no `SCRTn` entry ⇒ never installed |

After 3 rounds: **stop**, record the failure as an environment block with the exact command and
message, and surface it. Do not keep mutating code hoping it passes.

**Exit:** suite green, or a written blocked-reason with reproduction command.

### Step 7 — REPORT

Write `test-reports/cql-<topic>-<YYYYMMDD>.md` using the skeleton in
[automated-testing.md](automated-testing.md) §4. Include: env values, host from `hostname`, what
was verified vs. blocked, the command log, and **human-intervention count** (number of times the
agent had to ask, or a human had to type something). Zero non-gate interventions is the goal.

### Step 8 — WRITE-BACK (the step that makes this reusable)

Fold new findings into `skills/cci-system/cql/` — the single source of truth:

- new trap / wrong assumption → `SKILL.md` §7 or the matching `references/*.md`
- new verified command, path or env value → `references/runtime-environment.md`
- a built-in that behaves differently than documented → `references/builtins-reality.md`
- a new reusable test case → `references/automated-testing.md` seed tables
- a new site/trigger mapping pattern → `references/hl7-site-config.md`

Never copy runbook bodies into `AGENTS.md` or chat; keep the detail here and link it.

---

## Gates — the only moments a human is expected

| Gate | When | What the human does |
|---|---|---|
| **G1 scope** | after Step 2 | approve the change set (the 4-file lock) |
| **G2 freeze** | end-to-end replay | confirm the replay is reproducible |
| **G3 delivery** | report review | review / accept |

Everything between G1 and G2 the agent must complete alone. Count and report interventions.

## End-to-end replay (the acceptance test for "AI can drive this")

From a clean checkout, the agent runs, unattended:

1. `make -C cql/lisp` (+ `cql/lisp/hl7` if touched) → verify artefacts under `$CCRUN/cql`
2. `.dosu cql/lisp/setup_cql_hl7 -t <site>` → verify `$CCRUN/cql/hl7` + `starthl7*.scm`
3. full suite (all four groups) — record PASS/FAIL per case
4. the new report callable through its batch entry point
5. `test-reports/cql-e2e-<YYYYMMDD>.md`

Repeatable twice with identical results ⇒ the loop is proven.

## Never do these

- Edit files under `$CCRUN` directly (edit source, reinstall).
- Run anything with `-S` (super user) or without `-n` during tests.
- Invoke `UNA_LOGIN` with arguments (its non-tty branch does `exec sh -c "$*"`).
- Treat `SKIP` as `PASS`; a blocked case must name its constraint.
- Delete or tidy historical `*.OLD` / `*.template` / dated scratch files.
- Create a new top-level directory under `cql/` for tests without owner sign-off.
