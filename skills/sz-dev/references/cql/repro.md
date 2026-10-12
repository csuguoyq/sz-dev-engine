# Bug reproduction for CQL SZs (repro capability)

How to prove an SZ's defect exists before fixing it, and prove the fix removes
it — the red/green loop. All recipes here are **verified on a real host**
(ccifbch, 2026-09-23) unless marked otherwise.

## Why reproduce first

A bug-fix SZ is not "understood" until its symptom can be produced on demand.
The reproduction case is machine-checkable evidence:

- runs **FAIL** (with the reported symptom) on pre-fix code,
- runs **PASS** on post-fix code.

The same case becomes the seed of the Phase 3 acceptance test, which prevents
"test case repeats the implementation's mistake".

## Three reproduction levels (prefer the lowest that shows the defect)

| Level | How | Needs DB write | Typical SZs |
|---|---|---|---|
| 1. Pure function | call the function in `cql -b` batch with crafted input, `-n` | no | SZ34604 (birthdate < 1970), SZ25394 (unknown vdata type) |
| 2. Engine level | load the site script + engine libs in batch, call the classification/processing entry function directly with a hand-built parsed message | no | SZ30349 (state leak, two messages), SZ34739, SZ34401 |
| 3. Full pipeline | real HL7 injection into a test host -> DB write -> snapshot diff | yes (rsync backup/restore) | SZ34595 (report stored on wrong patient) |

Levels 1-2 are read-only (`-n`) and safe to run unattended. Level 3 requires
the acceptance runner safety gates (`cql/test/acceptance/`) (backup/teardown) and a prepared test host.

## Level 2 recipe (verified): load a site config script standalone

Goal: call an entry function such as `get-order-type` (in
`cql/lisp/hl7.dss/config.txorders/hl7dsstxorders.scm`) with a parsed message
s-expression, without the HL7 daemon.

Load chain, in this order (each step exists because the previous attempt
failed with `unbound variable` / `file not found`):

1. Define before loading anything:
   - `HL7BASEDIR` = `(getenv "CCRUN")`
   - `hl7-config-dir` = `hl7-config-path` = the config dir under test
   - `hl7-dir-path` = `"/hl7/hl7common"`
   - a local `prepend-path` that conses onto `load-path` (it is normally
     defined in `hl7common/hl7.scm`, which must NOT be loaded wholesale —
     it ends with `(quit)`)
2. Prepend to `load-path`: the config dir under test, `$CCRUN/cql/hl7/hl7common`,
   `$CCRUN/cql/hl7`.
3. Load: `util.scm` -> `hl7msg.scm` (defines `field-to-string`) ->
   `hl7local.scm` (defines `hl7-adt-id` etc.) -> `adt.cf` -> `hl7adt.scm` ->
   `hl7oru.scm` -> the script under test.
4. Some site variables may be unbound (`type-use-first-nte-only` in
   hl7dsstxorders.scm); guard with `symbol-bound?` before loading.

Verified driver: `tools/state-leak-two-message-repro.scm` in this directory (renders a two-message state-leak check at symptom level — deliberately carries no SZ-specific fix mechanism).

### Building parsed messages by hand

Parsed HL7 messages are plain lists of segments; `(assv "ODS" msg)` returns
the segment list. SIOD `nth` is **0-based** and **nil-safe** (`(nth 1 nil)`
returns `()`). Example — an ODS whose segment element 3 contains "99FHT" at
element 6:

```lisp
(list "ODS" () () (list "99FHT" () () () () () "99FHT"))
```

**Field markers are Scheme symbols, not strings.** In production
parser output the HL7 field tags are `com` / `rep` / `sub` (symbols);
a hand-built list must use the quoted symbol (`'com`), never the
string `"com"`. `field-to-string` (`hl7common/hl7msg.scm`) matches
markers with `assq` — symbol identity — so a string marker silently
takes the space-join fallback, which joins the **whole list, marker
included**: `(list "com" () "40% fio2")` resolves to
`"com  40% fio2"` (marker text, double space) with no error — the
driver runs "correctly" and asserts a shape production never sees.
Print-check with `%S`: a symbol renders unquoted, a string quoted.
(Production *tag-check code* must still accept both symbol and
string tags — see `domain/facts.md`; that rule is about inspecting
tags, not about building driver input.)

Classify with the same function production uses (`get-order-type`), and
assert on both the return value and the module-global state
(`is-tube-feeding?`) that the fix is supposed to reset.

### Two-message pattern (state leaks)

If the bug is a stale global between messages (the most common CQL inbound
bug class — SZ30349, SD409646), one message is never enough. Send:

1. the "dirty" message that sets the state,
2. a plain message that must not be affected,

and assert the state **after message 2**. On pre-fix code it leaks; on fixed
code it is reset.

### Isolating versions

Never use the current working tree as "green" — later SZs may have touched
the same file. Extract exact versions from git:

```sh
git show <fix-commit>^:<path> > /tmp/repro-old/<file>
git show <fix-commit>:<path>  > /tmp/repro-new/<file>
diff /tmp/repro-old/<file> /tmp/repro-new/<file>   # must show ONLY the fix
```

Then run the same driver against both config dirs via `REPRO_CONFIG`.

## Where the input material comes from

1. The SZ comments (softzilla MCP, `bug_comments`) — reporters often attach
   the exact triggering messages and the replay command line (SZ30349:
   attachment 97764 `judiODSTF.scm`, plus the `cat ... | .dosu cql -i...`
   command). Attachment ids are `attachment.cgi?id=<n>` links; fetch via web
   reader — the softzilla MCP has no attachment download tool.
2. Prior same-family SZs' fixtures (`cql/test/acceptance/fixtures/<SZ>/`).
3. Boundary conditions implied by the symptom (blank patid, dates before
   1970, `&` in fields, extra subcomponents).

## Driver-runtime traps (validated on ccifbch-class hosts, 2026-09-24, SZ22052)

Learned while running a Level 2 driver; apply to every driver:

- **Invoke the engine ONLY through `tools/cql-run`** (`bash
  "$SKILL_DIR/tools/cql-run" --env CCRUN=/fbch -- -b -n ...`) — the
  wrapper makes the caps below structural: timeout + file-size ulimit
  on every call, stdin staged and refused when any line exceeds the
  line-editor limit, `$CCRUN` presence enforced. Bypassing it is a
  red line: an un-capped engine call is a documented /tmp-filling
  host-disruption incident class, not a style preference.
- **Caps are mandatory, not optional** — `timeout 60` and `ulimit -f`
  wrap EVERY engine invocation. Two failure modes silently fill the
  disk otherwise: (a) an engine error that lands in the `cqlError>`
  prompt spins at ~100% CPU echoing the piped stdin data (observed
  at 18GB in 60s, /tmp to 100%); (b) the stdin line editor emits
  BEL (0x07) forever when a line is longer than ~900-2500 chars or
  the input is multi-line nested (observed at 609MB before the
  timeout). Keep stdin to short lines (prelude + `(load "<abs>")`
  only) and load everything else from files.
- **Large quoted literals never go inline** — defining multi-KB
  message trees as top-level `-e` forms spins the engine at 100% CPU
  printing `()` echo (GBs in a minute); the same defines loaded from
  a separate file via `(load ...)` run instantly.
- **`-i` cannot load files outside `$CCRUN`** — any absolute or relative
  path outside the runtime root fails with `file not found`. Pipe the
  driver through stdin instead, from the config dir's runtime location:
  `cd $CCSYSDIR/cql && cat driver.scm | $CCRUN/bin/cql -b -n`.
  Exception: `load` with a fully **absolute path** works even outside
  `$CCRUN` on current engine builds — driving baseline files from a
  replay/source tree relies on it (`(load "/project/.../file.scm")`
  verifies with a LOAD-OK print). Keep the stdin discipline above
  either way.
- **`load "file.scm"` has the same restriction** — a driver cannot
  `load` a helper that lives outside `$CCRUN`; inline the shared env
  block into each driver (or keep helpers under `$CCRUN`, which tests
  must never write to). Absolute paths are the exception (previous
  bullet).
- **Minimal output/comparison primitives** — `display`, `write` and
  `equal?` are NOT bound in the plain batch engine; use `print` for
  output (a trailing `(print "\n")` for newlines) and `eqv?` for
  comparisons (string-content `eqv?` is what the codebase itself uses).
  Also unbound in plain batch: `map`. `print` takes ONE argument (a
  second is read as an output port); `strcat` rejects non-strings.
- **Load chain needs `siod.scm` and, for message inspection,
  `types.scm`** — `siod.scm` defines the `1st`/`2nd`/`3rd` helpers
  used inside `get-msg-value` internals; `hl7common/types.scm`
  defines `seg-id`. A chain of `util.scm` → `hl7msg.scm` alone dies
  at call time with `unbound variable 2nd`.
- **Export env vars explicitly on the engine command line** — ambient
  shell env is not reliably visible to engine invocations from agent
  shells (a run saw `(getenv "CCRUN")` return `()` while `env` in
  the same shell showed `CCRUN=/fbch`), silently changing load-path
  resolution into misleading file-not-found / segfault signatures:
  `CCRUN=... HL7LOGFILE=... timeout 60 $CCRUN/bin/cql -b -n ...`.
- **Bind `hl7-testing` before loading any site script** — `(define
  hl7-testing t)` makes `hl7local.scm` point `hl7-logfile` at
  `/dev/null`; without it the driver writes `$CCRUN/log/hl7log.<site>`.
- **Site chain prepends its own load-path dirs after yours** — print
  `load-path` after the full chain loads to confirm which copy of a
  config script actually loaded (a production copy shadowing your
  working-tree copy silently invalidates the repro). `cons` order is
  last-first: cons the GENERIC dir before the SITE dir, or the site's
  tables are silently shadowed (all table lookups return `()` with no
  error).
- **HL7 field numbers ≠ list indices ≠ local variable names.** The
  ticket says "RXA-6"/"RXA-7" in HL7 field numbering; the code's
  `(nth 6 seg)` / local name `rxa6` map to the parser's list layout,
  not to the ticket's labels. Transplant the ticket's s-expression
  VERBATIM (same elements, same positions) into the driver and derive
  which index each code variable actually reads — never re-type the
  segment from memory. Cross-check the index mapping against a
  prior-art diff touching the same expression (SZ22052's driver got
  this wrong, invented a phantom "RXA-6 may be com" requirement, and
  doubled the fix size; the self-consistent driver and the review both
  passed, so only the human checkpoint caught it). Build segment
  fixtures with constructors (`(n-nulls 15)`-style), never
  hand-counted `()` runs — an off-by-one lands the value one slot
  early and `get-msg-value` returns `()` with no error.

## Post-fix green checks (two-message state-leak drivers)

The worked two-message driver is **pre-fix-safe only**: pre-fix, the
leaked global routes the call into the mislabel branch and masks
what post-fix code would do. Running it against fixed code exercises
a fallback path the daemon never takes (it can even crash on the
synthetic input). The post-fix green check therefore emulates the
daemon prologue — before each message's processing, set the message
class the daemon's dispatch sets (e.g. `g-order-type`), exactly as
`hl7-rde` does — and, when asserting downstream names or labels
(`seg-id`-derived), load `hl7common/types.scm` in the driver. A
green check that "passes" without the prologue is not evidence the
defect is gone; it exercises a different call path.

## Escalation

Reproduce-fails or symptom-mismatch is a Phase 1 escalation to a human, with
the report listing: levels attempted, inputs constructed, actual behavior
observed ("runs correctly" is itself a finding — wrong report or environment
difference).
