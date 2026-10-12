# CQL Automated Testing

Companion to [../SKILL.md](../SKILL.md) and [runtime-environment.md](runtime-environment.md).
How to **express, run and report** automated tests for `cql/` — designed so that an AI agent
(or CI) can run the whole suite unattended and produce a `test-reports/` artefact.

The suite lives outside the installed tree (nothing under `cql/` gets a new top-level directory
without owner sign-off — see SKILL.md §6.5). Runner + cases are plain files, no new build target:
the runner only ever *reads* `$CCRUN` and *writes* into `test-reports/`.

## 1. Execution model

One test case = one `cql` process, fed on stdin, asserted on **exit code + stdout**:

```sh
run_sexp() {  # $1 = sexp, $2 = "cis"|"any"
  local sexp="$1" as="$2"
  if [ "$as" = cis ]; then
    printf '%s\n' "$sexp" | .dosu "$CCBINDIR/cql" -b -n
  else
    printf '%s\n' "$sexp" | "$CCBINDIR/cql" -b -n
  fi
}
```

- `-b` gives `exitOnError=1` → unbound variable / bad arg / parse error ⇒ **exit 1**.
- `-n` blocks `db-start-write` ⇒ a test can never corrupt patient data.
- Never load `cql.scm` in batch: it calls `window-size`, which fails with
  `error in ioctl call; errobj=errno` when stdin is not a tty.
- Never load a `starthl7*.scm` wholesale in batch: `hl7.scm` ends with `(hl7-main)`, an
  infinite `(read)` loop.

## 2. Case format

A case is a directory (or a single file with a header) carrying:

| Field | Meaning |
|---|---|
| `id` | stable id, e.g. `pure-gcs-01` |
| `group` | `pure` \| `db` \| `menu` \| `hl7` |
| `as` | `any` (default) or `cis` |
| `prelude` | sexp run before the body — default `(load "init.scm")` |
| `body` | the sexp under test; **must end with an explicit `(printf ...)`** |
| `expect-substr` | one or more substrings that must appear in stdout |
| `expect-exit` | default `0` |

Keep the body a single `printf` so the assertion is a substring match — CQL has no assert
built-in, and stdout from `printf` is stable (unlike REPL echo, which prints `()` per form).

## 3. Suites and seed cases (all verified on `fbch34`)

### Group `pure` — no DB, runs as any user, fastest to green

| id | body | expect |
|---|---|---|
| `pure-arith-01` | `(printf "%S" (+ 1 2))` | `3`, exit 0 |
| `pure-gcs-01` | prelude `(load "<ccsrc>/cql/lisp/GCS.scm")`; `(printf "%S" (compute-score 4 5 6))` | `gcs=15` |
| `pure-gcs-02` | `(printf "%S" (compute-score 0 5 6))` | `gcs=()` (out-of-range ⇒ nil) |
| `pure-saps-01` | prelude `(load "hl7/util.scm")(load "severity_util.scm")(load "sapsII.scm")`; `(printf "%S" (score-age-saps 45))` | `age=7` |
| `pure-saps-02` | `(printf "%S" (score-age-saps "75"))` | `age=16` |
| `pure-init-01` | `(load "init.scm")(printf "%S" sitename)` | `sitename=cci` |
| `pure-apache-01` | apacheII.scm prelude; `(printf "%S" (and (symbol-bound? 'apache-II) t))` | `apache=t age-score=t` |

Load-order rule for the severity family (verified): `apacheII.scm` / `sapsII.scm` / `mpmII.scm`
call `make-major-it-list`, which is defined in **`severity_util.scm`**, and that in turn needs
`siod.scm` / `util.scm` / `dbutil.scm`. Bare `(load "util.scm")` fails because `util.scm`
installs to `$CCRUN/cql/hl7`. Working prelude:

```scheme
(load "init.scm")
(set! load-path (cons (strcat (getenv "CCRUN") "/cql/hl7") load-path))  ; util.scm loads "adtutil.scm" relatively
(load (strcat (getenv "CCRUN") "/cql/hl7/util.scm"))
(load (strcat (getenv "CCRUN") "/cql/severity_util.scm"))    ; defines make-major-it-list
(load (strcat (getenv "CCRUN") "/cql/apacheII.scm"))         ; or sapsII.scm / mpmII.scm
```

Verified on `fbch34`: the above ends with `(symbol-bound? 'apache-II)` ⇒ `t`. The `load-path`
cons is mandatory — `util.scm` does a bare `(load "adtutil.scm")`, and `adtutil.scm` also lives in
`$CCRUN/cql/hl7`.

Pure scoring functions available as unit-test targets:

- `cql/lisp/GCS.scm` — `compute-score` (EOT/BVR/BMR bounds 1-4 / 1-5 / 1-6), `value-to-int`.
- `cql/lisp/sapsII.scm` — `score-age-saps`, `hr-score-saps`, `art-s-score-saps`, `cuff-s-score-saps`,
  `tempc-score-saps`, `tempf-score-saps`, `pao2-fio2-score-saps`, `urin-out-score-saps`,
  `burea-score-saps`, `bun-score-saps`, `bunitro-score-saps`, `wbc-score-saps`, `k-score-saps`,
  `na-score-saps`, `bicarb-score-saps`, `bili-1-score-saps`, `bili-2-score-saps`, `gcs-score-saps`,
  `score-disease-saps`, `score-admission-saps`.
- `cql/lisp/apacheII.scm` — `age-score`, `temp-fahr-score`, `temp-score`, `art-mean-score`,
  `heart-rate-score`, `resp-rate-score`, `A-aDO2-score`, `PaO2-score`, `arterial-pH-score`,
  `serum-Na-score`, `serum-K-score`, `creat-score`, `hematocrit-score`, `white-blood-count-score`,
  `GCS-score`, `serum-HCO3-score`, `acute-renal-failure`, `score-non-op-apache`,
  `score-post-op-apache`.
- `cql/lisp/mpmII.scm` — `score-age-mpm`, `hr-score-mpm0`, `art-s-score-mpm0`, `cuff-s-score-mpm0`,
  `creati-1-score-mpm24`, `creati-2-score-mpm24`, `pressur-score-mpm24`, …
- `cql/lisp/severity_util.scm` — `make-major-it-list`, `get-it` / `get-date` / `get-value` /
  `get-score`, `sum-from-dbi-list`, `compare-two-items`, `str-of-set-len`.

### Group `db` — real patient data, **must run as cis**

| id | body (after `(load "init.scm")`) | expect |
|---|---|---|
| `db-pat-bymrn-01` | `(printf "%S" (pat-mrn (patient-by-mrn "DDog")))` | `mrn="DDog"` |
| `db-pat-bybed-01` | `(printf "%S" (pat-id (patient-by-unit-bed "6CENTER" "6236")))` | `id=1645486329` |
| `db-name-to-it-01` | `(printf "%S" (name-to-it "Eyes Open To"))` | `it=646` |
| `db-name-to-it-02` | `(printf "%S" (name-to-it "NO SUCH ITEM XYZ"))` | `it=()` (missing name ⇒ nil) |
| `db-step-01` | open `(make-dbname (patient-by-mrn "DDog"))`, `db-def` on `Patient Last Name`, one `db-step`, print `(get-key d)` / `(get-data d)` | `key=1557197545` / `data="DDog"` |
| `db-report-01` | `(load "edits.scm")(all-report-by-obs-time (patient-by-dbpath2 "vol9/p1645486329"))` | header `Report for DDog, DDog DDog` |
| `db-nowrite-01` | `(db-start-write (db-open (make-dbname (patient-by-mrn "DDog"))))` under `-n` | exit 1 + `permission to store data denied` — proves the safety flag |

`db-report-01` is the highest-value integration case: it exercises `dbutil` → `db-open` →
`db-def`/`db-step` → report formatting in one shot, and its output is a stable fixed-width table.

### Group `menu` / help integrity — any user

| id | body | expect |
|---|---|---|
| `menu-help-01` | `(help 'db-open)` | `Opens the database` (non-empty help text) |
| `menu-testhelp-01` | `cql -b -i$CCRUN/cql/testhelp.scm -e` | exit 0, contains `OBJECTS DEFINED, BUT WITHOUT HELP:` and `OBJECTS WITH HELP, BUT NOT DEFINED:` |

Because `menu.scm` self-executes (`(menu)` then `(quit)`), assert on it **statically**: load it
with `load "menu.scm" t` inside a try, or grep the `choices` list. A robust check is a
`grep -c '(list "'` + a check that every non-nil second element is a file present under
`$CCRUN/cql` or `$CCRUN/sharp/run/cql`. Track the known-dangling entries (many `choices` files
such as `dup_rep.scm` / `ccr.scm` are site-supplied and may be absent) as *known gaps*, not
failures — and never "fix" them by editing `menu.scm`.

### Group `hl7` — engine + one installed site

1. **Static/config cases (any user, always run):** parse the site `trigger.cf` and assert the
   `("TYPE" "TRIGGER" subr "loadfile" segments)` shape; assert every `loadfile` exists in
   `$CCRUN/cql/hl7/hl7common` or the site dir; assert `segment.cf` / `msgdata.cf` load as
   s-expressions (`(load "trigger.cf" t)` style).
2. **Engine case (cis):** load the engine chain the way `hl7.scm` does, then call `hl7-process`
   on a hand-built parsed message and assert the ack. Key symbols: `hl7-process`, `find-trigger`,
   `hl7-check`, `hl7-ack` / `hl7-ack-error`, `msh-processing-id`, `process-t` / `process-d`.
   Bind `hl7-testing` first: `hl7.scm`'s `log` then echoes to **stdout**, and `hl7local.scm`
   typically redirects `hl7-logfile` to `/dev/null`.
3. **Processing-id gate case:** feed MSH-11 `T` with `process-t` = `"f"` and assert the ack text
   `NOT PROCESSED; TEST MODE`; then set `process-t` = `"t"` and assert the trigger ran. This is the
   single most valuable HL7 regression case (see SKILL.md §7).

## 4. Runner contract

`run` must be: idempotent, non-interactive, cis-escalating only for the `db`/`hl7` groups, and
producing one Markdown report. Suggested behaviour:

1. Print a header line per case: `RUN <id> (<group>, as=<as>)`.
2. Capture stdout+stderr and exit code; apply `expect-substr` and `expect-exit`.
3. Emit `PASS`/`FAIL`/`SKIP(env)` — `SKIP` only when a precondition is genuinely missing
   (cis escalation unavailable, site module not installed, patient absent). **Never mask a real
   failure as SKIP.**
4. Summarise counts, write `test-reports/cql-<suite>-<YYYYMMDD>.md`.

Report skeleton (matches the existing `test-reports/` convention):

```markdown
# CQL — <suite> (automated run)

- **Date (UTC):** YYYY-MM-DD
- **Host:** `<short-host>` (IP) — from `hostname`, not from docs
- **Runtime:** CCRUN=`…` CCSYSDIR=`…` CCBINDIR=`…`
- **Runner:** `<path>` — groups: pure / db / menu / hl7
- **Guides followed:** `skills/cci-system/cql/SKILL.md` → `references/automated-testing.md`

## Environment

| Item | Value |
|---|---|
| cql binary | … |
| cis escalation | `.dosu` OK / blocked |

## Results

| # | Case | Group | As | Expected | Result |
|---|---|---|---|---|---|
| 1 | pure-gcs-01 | pure | any | `15` | ✅ |

## Conclusion

| Group | Pass / Total |
|---|---|
| pure | n / n |

**Narrative:** what is verified vs. what is blocked (name the concrete constraint).

## New findings (for skill update)

1. …

## Test Verdict: ✅ PASS
- Observed : …
- Expected : …
- Verdict  : ✅ PASS
- Host     : `<short-host>` (IP)
```

## 5. Adding a case for a newly developed report

Every new `.scm` report must ship with at least one case, and the case must be runnable in batch
— that means the report entry point **must not** call `readline` / `menu` / `window-size`. Design
reports as `(define (run-…) …)` plus a `printf`-only driver, so the test can do:

```sh
printf '(load "init.scm")(load "%s/%s.scm")(run-myreport (patient-by-mrn "DDog"))\n' \
  "$CCRUN/cql" myreport | .dosu "$CCBINDIR/cql" -b -n
```

If the report is menu-reachable, add a second static case asserting the new `choices` row exists in
`cql/lisp/menu.scm` and that its `.scm` has a `SCRTn` entry in `cql/lisp/Makefile` (a file with no
SCRT entry is never installed — SKILL.md §6.4).
