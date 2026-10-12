# Scripts layer — cql/lisp (Scheme) + cql/scripts (shell)

> Facts in `domain/facts.md` apply. Zero compilation; `make install`
> is the whole build.

## cql/lisp — directory shape

2120 files = 532 .scm + 79 `hl7.<site>` site directories (~1500 .cf)
+ `hl7/hl7common/` (common engine, installs to `$CCRUN/cql/hl7`)
+ `hl7_template/`.

## Install mechanism (read before adding files)

- `Makefile`: `SCRTTYPE := SCM`, files listed one by one as
  `SCRT1..SCRT45`; **new entries continue from `SCRT46`**. Rules come
  from `Make/make_scrt.mk`: mode 0640, version-stamp header appended
  (`;` comment).
- Install target defaults to `$CCRUN/cql`; override per file with
  `$(SCRTn).INSTALLDIR` (existing examples: util.scm/adtutil.scm →
  `$CCRUN/cql/hl7`).
- **`.template` convention**: entries with
  `$(SCRTn).TRGT := $(SCRTn).template` (menu.scm, diet-config.scm,
  exitcare.scm) install as `*.template` and never overwrite a
  customized live file. Changing the menu also requires syncing the
  live `$CCRUN/cql/menu.scm`.
- `GdrCqlInterface.sh` declares shell type via `$(SCRTn).TYPE := SH`.
- Install: `cd cql/lisp && make install` (scripts only, no binaries).

## Five script skeletons (classify a new script first)

| Skeleton | Sample | Pattern |
|---|---|---|
| Interactive shell | `cql.scm` | `command-list` table + `read-do-loop` + `process-command` prefix completion + `eval` dispatch |
| Menu | `menu.scm` | `choices` table (title/script/perms) → `staffid-check-perms` → `(load sub-script)` |
| Batch | `dumpdb.scm` (minimal sample) | `(load "init.scm")` → `(getenv ...)` params → functions → tail execution → `(quit)` |
| Library | `dbutil.scm`, `meds.scm` | only load + define, no side-effect tail |
| Forwarder | `archive.scm`, `linkmrn.scm` | one-line `(system "external program")` |

## Binding conventions

- **Five-step** (fact 4): `db-open (make-dbname p)` →
  `db-def dbtd start stop mode its` → `db-step` loop → `db-undef` →
  `db-close`. Use the accessors from `dbutil.scm` (`get-key`=caddr,
  `pat-id`=car, `pat-unit`=5th, ...) — never hand-write `nth`.
- **Global-store queries** use `gdb-*`
  (`gdb-open $CCSYSDIR/gdb/ActivePatients`), read-only.
- **Config override, three ways**: `(if (not (symbol-bound? 'var))
  (define var default))` + site .cf loaded after; standalone config
  script + startup validation (diet pattern: error→quit /
  warning→continue); `(res-get-string/res-get-bool ... "ccResources")`.
- **Parameters**: environment variables (`getenv "DBPATH"`,
  `CCSYS_PATID`); outputs via single-element list + `set-car!` (no
  call-by-reference). **Error handling**: nil + `printf` + `(quit)`
  when needed — no exception mechanism. Batch scripts **must end with
  `(quit)`**.
- **Output**: `printf` C-style format strings (`%S` prints an s-expr);
  redirection via `siod.scm` `with-output-to-file`/`printer` and the
  `view` macro.
- **Naming**: globals/functions use hyphens (`find-ungiven-meds-pat`),
  predicates end in `?`.

## Core files

`cql.scm` (interactive shell; `print-table` is the workhorse),
`cql.hlp` (**primitive API manual** — must be synced when primitives
change), `init.scm` (batch entry), `siod.scm` (runtime library:
defmac/mapcar/sort/string utils/redirection macros), `dbutil.scm`
(patient wrappers: `make-dbname`, `for-all-patients`, ten
`patients-by-*` lookups, `D pattern`), `edits.scm` (modification
audit; backend of cqllog), `menu.scm`, `commQuery.scm`, `note_util.scm`.

## Business script domains (where existing behavior lives)

Before modifying a domain, find its dispatcher + site-config pattern —
most domains follow "library `.scm` + site `.cf` override":

| Domain | Representative files | Pattern to know |
|---|---|---|
| Severity scoring | `severity.scm` (dispatcher) + `severity_util.scm`, models `apacheII.scm`/`sapsII.scm`/`mpmII.scm` | loads `$CCSYSDIR/severity.cf` site config, then models per `score-list`; models map variables to item names via `(if (not (symbol-bound? 'ap-name-tempf)) (define ...))` — everything overridable by .cf |
| Medications | `meds.scm` (library) / `medsuif.scm` (interactive) | defined-vs-delivered table diff finds ungiven meds; accumulates in global `ungiven-meds` |
| Diet | `diet.scm` + `diet-config.scm` | config validation split error (print + log + quit) / warning (continue) |
| HL7/ADT | `adt.scm` (admission interface sample), `adtutil.scm`, the 79 `hl7.<site>/` | `adt.scm` reads stdin s-expr stream → `adt-admit` → `db-start-write " 1ADT"` + per-item `db-newd`; site differences live entirely in .cf |
| Archive | `archive.scm`, `unarch.scm`, `longtime.scm` | `unarch.scm` uses `arch-find`/`arch-get` + the 15 `arch-*` accessors; `longtime.scm` self-implements 1910–2038 date math |
| Plotting | `plot.scm` | emits PostScript directly (`ps-*` primitives, `ps-cci-logo`) |
| DB maintenance | `dumpdb.scm`, `sample_idx.scm`, `linkmrn.scm` | env-var params / `Key=Value` stdout; `linkmrn.scm` is a one-line forwarder |
| External SQL | `mysql.scm` | thin wrapper over `mysql-record-open("MPI", stmt, -1)` |

## HL7 subtree (high-risk zone)

`hl7/hl7common/` is the engine shared by **all** sites (hl7.scm,
hl7adt.scm, hl7oru.scm, types.scm, ack.scm); the 79 `hl7.<site>/`
directories hold only site `.cf` configs plus a few `hl7local.scm`/
`hl7format.scm`. **Changing hl7common affects every site** — plan a
multi-site regression.

## Local self-test (Linux host)

```
cql                                  # interactive REPL (-n read-only); iterate with small (load "x.scm")
DBPATH=<dbpath> cql -b -i myreport.scm -e     # batch run (-e exit on error)
(help 'db-def)                       # query cql.hlp
```

## cql/scripts — shell wrappers and ops scripts

All shell scripts, no compiled artifacts. Install groups in
`Makefile` (**new entries continue from `SCRT29`**):

- **Into `$CCRUN/bin`** (SCRT1–8, SCRT25, ...): `cqllog`/`cqllog2`/
  `cqllog3` (patient-data diagnostic dumps: assemble a Scheme
  expression and feed `cql -b -iedits.scm -e`; backend
  `cql/lisp/edits.scm`; cqllog3 is precise to
  `<dbpath> <IT> <minorIT> <key>`), `cqldump` (whole-store ASCII dump),
  `UNA_LOGIN` (unarchive console login; tty restricted to
  `/dev/syscon`; failures logged to `$CCRUN/log/archlog`),
  `showbed`/`showunit` (assemble `(set! ...)` then
  `cql -b -idasunit.scm`), `webcql` (authenticates via ycql
  `validateuser`/`checkperm(...,"CQL","E")` before entering the menu),
  `rmadminutil`.
- **Into `$CCRUN/cql/safebin`** (SCRT10+, `CQLSAFEBINDIR`): the
  **`cql` wrapper script** (`exec $CCRUN/bin/cql -n "$@"` — same name,
  different directory; the safe entry point), `edit` (su cci to run
  cqledit), `shell`, `_unarchive`, `writeseveritydata`, `linkmrn`,
  `Merge/ShrinkReceivedUnits.sh` (installed without .sh; dedup via
  ycql), less/more/enscript/xcalc.
- `cqlmenu/CQL` installs to two places (`$(CCBINDIR)/adminutil` and
  `$(CCBINDIR)`); content:
  `exec $CCRUN/bin/cql -i$CCRUN/cql/menu.scm -e -n`.

Editing notes:

- These scripts almost all follow "shell parses args → assembles a
  Scheme expression / `(set! ...)` → `.dosu $CCRUN/bin/cql -b -i<x>.scm
  -e`". When changing parameters, review both ends (.sh + .scm)
  together.
- Privileged operations go through `.dosu` (privilege wrapper) — never
  bypass it with direct execution.
- The `-epd` suffix variants use EPD storage (`epdpat-by-dbpath`/
  `asciify-epd-patient`, defined in `cql/lisp/dbutil.scm`; C layer
  `cclib/cqlA/epdPat.c`; library `cclib/epd`).
