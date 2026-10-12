---
name: "cql"
description: "Legacy CliniComp CQL (Clinical Query Language) system guide for the cql/ directory: invoke when developing, building, installing, testing or debugging anything under cql/ — CQL Lisp scripts (.scm), the cql binary entry scripts (scripts/cql, cqllog, cqldump, cqlmenu/CQL, webcql, showbed, UNA_LOGIN), HL7 engine and per-site HL7 configs (hl7/hl7common, hl7.<site>/config*), GDB long-term-dump query apps (cql/gdb), or patient archive/unarchive workflows. Also covers AI-driven unattended develop+test loops: the 5-layer `cql/test/` (`cql/test/preflight.sh` env entry, `cql/test/check.sh` + `cql/test/cases/` deterministic sensors, `cql/test/progress/` recovery, `cql/test/evals/` grading, `cql/test/profile.json` structured config), plus runbook, verified runtime environment and built-in reality checks. Load it before writing, modifying or testing any cql/ code."
---

# CQL (Clinical Query Language) Workflows

> This file is a **router**: pick your direction in Section 0, then read only what you need so unrelated detail stays out of context.
> CQL is CliniComp International's legacy Common Lisp (SIOD dialect) system — still maintained (copyright headers run to 2026).
> All paths are relative to the `ccsrc` repository root.
> Code references are **file path + stable symbol names** (components, functions, constants) — never line numbers.

## 0. Pick your direction first

| What you are doing | Read |
|---|---|
| 🔍 What CQL is / where things live | Sections 1–2 below |
| 🧑‍💻 Writing / modifying report or menu Lisp scripts | Section 3 (language) + workflow A in Section 5 |
| 🌐 New HL7 site / module / trigger / field mapping | [references/hl7-site-config.md](references/hl7-site-config.md) |
| 🔨 Building / installing (make, `setup_cql_hl7`) | Section 4 + [references/runtime-environment.md](references/runtime-environment.md) §6 |
| 📦 GDB (long-term dump) queries / ODBC export | workflow D in Section 5 |
| 🗄️ Patient archive / unarchive | workflow E in Section 5 |
| 🧪 Ad-hoc CQL from the shell | workflow B in Section 5 |
| ▶️ "Can this host run it?" / "Run the suite after a change" | [cql/test/README.md](../../../cql/test/README.md) → `cql/test/preflight.sh` + `cql/test/check.sh` |
| ▶️ Running anything for real (env, flags, cis, `load-path`) | [references/runtime-environment.md](references/runtime-environment.md) |
| 🤖 Driving the loop unattended (AI dev + test) | [references/ai-runbook.md](references/ai-runbook.md) + Section 8 |
| ✅ Writing / running automated tests | [references/automated-testing.md](references/automated-testing.md) + [cql/test/cases/](../../../cql/test/cases) |
| ⚠️ "Unbound variable" / built-in not behaving as documented | [references/builtins-reality.md](references/builtins-reality.md) |
| ⚠️ Conventions & known traps before editing | Sections 6–7 |

## 1. What the system is

`cql/` = the **Clinical Query Language**: a Common Lisp (SIOD) interpreter plus a suite of
shell scripts that provide:

1. **Interactive patient-data query** — the `cql` binary REPL. Per-patient data is a keyed
   flat-file database opened with `db-open`; queries use `db-def`/`db-step`. Command set
   (`PATIENT`/`LOOKFOR`/`DISPLAY`/`BEGIN`/`END`/...) lives in `cql/lisp/cql.scm` (`command-list`).
2. **Report scripts** — a numbered menu (`cql/lisp/menu.scm`, `choices` list) loads `.scm`
   report applications (ICU / MBH / ED / system-admin reports), each optionally gated by
   `staffid-check-perms <app> "E" $CCSYS_STAFFID`.
3. **HL7 message processing** — shared engine in `cql/lisp/hl7/hl7common/` plus ~78 customer
   site configs in `cql/lisp/hl7.<site>/` (64 have a default `config/` module; the rest are
   named-module only, e.g. `hl7.dss` → `config.bcma` / `config.dsspharm` / ...); installed to
   `$CCRUN/cql/hl7/` by `cql/lisp/setup_cql_hl7` (a few sites, e.g. `hl7.scc`, carry their own
   Makefile that rsyncs the module instead); see
   [references/hl7-site-config.md](references/hl7-site-config.md).
4. **Severity scoring** — APACHE II (`cql/lisp/apacheII.scm`), SAPS II (`cql/lisp/sapsII.scm`),
   MPM II (`cql/lisp/mpmII.scm`), GCS (`cql/lisp/GCS.scm`, `Glasgow-Coma-Score`),
   `severity.scm` / `severity_auto.scm` / `severity_user.scm` / `severity_util.scm`.
5. **Archive & GDB** — offline patient storage and long-term dumps ("gdb") with query apps:
   `cql/archive/`, `cql/gdb/`, `cql/lisp/archive.scm` (`arch-open`/`arch-find`), `cql/lisp/unarch.scm`.
6. **Supporting facilities** — MySQL from CQL (`cql/lisp/mysql.scm`, `mysql-*` built-ins),
   PostScript reports/plots (`ps-*`, `plot-graph`; `cql/lisp/plot.scm`, `plotm.scm`),
   DAS network monitor data (`cql/lisp/das.scm`, `das-readmon`), notes (`cql/lisp/note_util.scm`),
   diet/meds (`cql/lisp/diet.scm`, `meds.scm`, `findfluid.scm`).

## 2. Directory overview (responsibilities)

```
cql/
├── lisp/                      # Common Lisp sources (the bulk of the tree)
│   ├── *.scm                  # core + report apps (cql.scm, menu.scm, init.scm, siod.scm, dbutil.scm, ...)
│   ├── cql.hlp                # AUTHORITATIVE language/built-in reference (strict s-expression format)
│   ├── Makefile               # installs core .scm to $(CCRUN)/cql (explicit SCRTn list)
│   ├── hl7/hl7common/         # shared HL7 engine (~40 .scm: hl7.scm, hl7adt.scm, hl7oru.scm, ack.scm, ...)
│   ├── hl7.<site>/            # per-customer HL7 configs (config/ = default module, config.<module>/ = extras)
│   ├── hl7_template/          # message templates (radiology, pathology, PDF reports)
│   ├── refnote/               # referral/consult note generation (assessment2consult.scm)
│   └── setup_cql_hl7          # HL7 site/module installer (shell; must run as user cis)
├── scripts/                   # shell entry points (cql, cqllog, cqldump, cqlmenu/CQL, webcql, showbed, ...)
├── gdb/                       # GDB (long-term dump) query apps + ODBC export (gui_*.scm, buildcurrentgdb.scm, odbc*.scm)
├── archive/                   # archive-dir check/copy (checkarchdir.scm, checkarchdir_comm.scm, copyarchdir.scm)
├── siodptx/                   # siod.c — C source of the `cql` binary (PTX platform build)
└── siodsgi/                   # SGI platform build (siod.c + ccicpa.c, ccihold.c, glbs.c, init.c)
```

Key core files in `cql/lisp/` (top level):

| File | Role (stable symbols) |
|---|---|
| `init.scm` | auto-loaded at cql start: sets `sitename`, loads `siod.scm` + `dbutil.scm` |
| `cql.scm` | interactive program: `cql`, `read-do-loop`, `process-command`, `command-list` |
| `menu.scm` | numbered application menu: `choices` (list of `(title .scm permission-app)`), `menu` |
| `siod.scm` / `dbutil.scm` | interpreter glue / DB utilities |
| `util.scm` / `types.scm` / `edits.scm` / `deldef.scm` / `longtime.scm` | shared helpers |
| `config.scm` | environment/unit/bed config (`config-environment`, `config-beds-in-unit`) |
| `plot.scm` / `plotm.scm` | PostScript graphs (`plot-graph`, `make-xy-data`) |
| `das.scm` / `dasunit.scm` | DAS monitor data (`das-readmon`); driven by `scripts/showbed` |
| `diet.scm` / `meds.scm` / `findfluid.scm` / `medsuif.scm` | diet / meds utilities |
| `mysql.scm` | `mysql-*` built-ins |
| `note_util.scm` | `note-*` / `db-note-*` built-ins |
| `unarch.scm` | unarchive flow (entered via `scripts/UNA_LOGIN`) |
| `archive.scm` | `arch-open` / `arch-close` / `arch-find` built-ins |
| `dumpdb.scm` | `asciify-*` dump helpers |
| `GCS.scm`, `apacheII.scm`, `sapsII.scm`, `mpmII.scm`, `severity*.scm` | severity scoring |
| `GdrCqlInterface.sh` | GDR query via `ccsqlplus`, returns CQL-readable s-expressions |
| `setup_cql_hl7` | HL7 site/module installer |

## 3. The CQL language & core built-ins

- CQL Lisp is a Scheme-like SIOD dialect. **The authoritative reference is
  `cql/lisp/cql.hlp`** — every built-in with its exact signature and description. Do not guess
  signatures; read the `.hlp` entry first.
- Built-in groups (all documented in `cql.hlp`):
  - **Database**: `db-open` `db-close` `db-def` `db-undef` `db-step` `db-step-key` `db-newd`
    `db-start-write` `db-end-write` `db-admit-key` `db-set-admit-key` `db-adt-history`
    `db-dump` `db-log-info` `db-dbtd-info`
  - **Items (IT numbers)**: `name-to-it` `fullname-to-it` `it-to-item` `item-name`
    `item-fullname` `item-unitstring` `item-type` `print-items` `fancy-to-it` `fancy-to-item`
  - **Patient**: `patient-by-mrn` `patient-by-id` `patient-by-unit-bed` `patient-by-name`
    `patient-by-doctor` `patients-by-mrn` `patient-next` `patient-rewind` `for-all-patients`
    `pat-id` `pat-mrn` `pat-name` `pat-unit` `pat-bed` `pat-doctor` `make-dbname`
    `dump-patient-info`
  - **ADT**: `adt-admit` `adt-discharge` `adt-transfer` `adt-edit-data` `adt-add-patient`
    `adt-rem-patient` `adt-error-string`
  - **Archive**: `arch-open` `arch-close` `arch-find` `arch-get`
  - **GDB**: `gdb-open` `gdb-def` `gdb-step` `gdb-data-def` `gdb-data-step` `gdb-patient-def`
    `gdb-patient-by-mrn` `gdb-patient-by-name` `gdb-adt-def` `gdb-staff-def` `gdb-note-def`
    `gdb-rewind` `gdb-undef` `gdb-get-item-list` `gdb-get-template-list`
  - **Notes**: `note-get-data` `note-get-tag` `note-get-item-data` `note-free-data`
    `note-get-default-text` `get-template-info` `db-note-start` `db-note-put-string` `db-note-store`
  - **Hold**: `hold-def` `hold-step` `hold-rewind` `hold-readmit` `hold-undef`
  - **MySQL**: `mysql-show-all` `mysql-show-databases` `mysql-show-tables` `mysql-show-columns`
    `mysql-record-open` `mysql-record-next` `mysql-record-print` `mysql-record-close`
  - **Time**: `time-now` `time-to-string` `time-to-longstring` `time-to-formatted-string`
    `readtime` `never`
  - **Statistics**: `total` `mean` `median` `mode` `variance` `std-dev` `covariance` `correlation`
  - **PostScript/plot**: `ps-open` `ps-close` `ps-newpage` `ps-printf` `ps-moveto` `ps-set-font`
    `plot-graph` `make-xy-data`
  - **System**: `getenv` `system` `system-read` `window-size` `printer-status` `printer-routes`
    `error` `quit` `gc`
  - **dbi accessors**: `get-key` `get-data` `get-major-it` `get-minor-it` `get-log-id`
    `log-time` `log-name` `log-init`
- Global variables: `sitename` `pat` `starttime` `stoptime` `it-list` `load-path` `prompt`
  `debug` `errobj` `format` `nullstring` `D-ignore-case` `disch` — plus constants
  `nil`, `t`, `never`.
- Load resolution: `load` searches `load-path`; installed scripts live under `$CCRUN/cql/`
  (e.g. `cql.scm` loads `(string-append (getenv "CCRUN") "/cql/siod.scm")`).
- Interactive command set (`cql.scm` `command-list`): `PATIENT`, `LOOKFOR`, `DISPLAY`, `BEGIN`,
  `END`, `REVERSE`, `CRITERIA`, `ALL`, `TOGGLE`, `PAGING`, `EDITS`, `COLUMNS`, `ROWS`, `HELP`,
  `QUIT`. Commands are prefix-completed; ambiguous matches print the options.

## 4. Runtime environment, build & install

**Environment variables** (used by scripts and Lisp):

| Variable | Meaning |
|---|---|
| `$CCRUN` | runtime base; installed scripts under `$CCRUN/cql/`, logs under `$CCRUN/log/` |
| `$CCSYSDIR` | system config dir; `ccResources` key/value file (e.g. `VistA.ConnType`, `gdr.gdrclasses`) |
| `$CCBINDIR` | binary install dir; the `cql` binary is invoked as `$CCRUN/bin/cql` |
| `$CCSYS_STAFFID` | current staff id (used by `staffid-check-perms`) |
| `$GDBCURRENT` | name/path of the current GDB dump (read by `cql/gdb/gui_*.scm`) |
| `$HL7BASEDIR` | HL7 base (defaults to `$CCRUN`; set in generated `starthl7*.scm`) |
| `$CQL` | override for the cql binary name (used by `scripts/cqllog`, `scripts/cqldump`) |
| `$NOSOCDATA` | nosocomial data dir (exported by `scripts/cqlmenu/CQL`) |

**Privilege model**: many entry points must run as the **`cis`** user — scripts check
`whoami` (`scripts/cqldump`, `setup_cql_hl7`, `GdrCqlInterface.sh`). `.dosu` is the internal
elevation helper (`scripts/webcql`, `scripts/UNA_LOGIN`). `scripts/webcql` performs CIS
login + a CQL `"E"` permission check through MySQL (`validateuser` / `checkperm`) before
running `$CCBINDIR/adminutil/cqlmenu/CQL`.

**The `cql` binary**: built from `cql/siodptx/siod.c` (make target `PROG` = `cql`,
`INSTALLDIR` = `$(CCBINDIR)`, links ~35 cc libraries: `ccidb`, `dbaccess`, `arch`, `ccSQL`,
`patADT`, `template`, `checkPerms`, ...). `cql/siodsgi/` is the SGI build. Binary-level
behavior means C changes; **most tasks are pure `.scm`/`.cf`** — prefer those.

**Make**: every Makefile includes `$(getsrcroot)/Make/make_inc.mk` + `make_rules.mk`.
Scripts are listed explicitly as `SCRTn := <file>` with optional per-entry `.INSTALLDIR` /
`.TRGT` overrides. Install targets:

| Target dir | Content |
|---|---|
| `$(CCRUN)/cql` | core Lisp (`cql/lisp/Makefile`) + archive scripts + gdb utilities |
| `$(CCRUN)/cql/hl7` | HL7 engine (`cql/lisp/hl7/Makefile`) and site configs (via `setup_cql_hl7`) |
| `$(CCBINDIR)` (+ `$(CCBINDIR)/adminutil`) | shell entry points (`cql/scripts/Makefile`); `cqlmenu/CQL` goes to both |
| `$(CCRUN)/cql/safebin` | restricted wrappers (`edit`, `shell`, `less`, `more`, `xcalc`, `writeseveritydata`, ...) |
| `$(CCRUN)/gdbcql` | GDB GUI apps (`cql/gdb/Makefile`) |

Templated installs: `SCRTn.TRGT` picks a template as the install source (e.g. `menu.scm` ←
`menu.scm.template`, `diet-config.scm`, `exitcare.scm`) for site-specific builds.

**HL7 installation is NOT plain make**: run `cql/lisp/setup_cql_hl7 -t <site> [-m module|all]
[-s srcdir] [-d destdir] [-f] [-p]` **as user `cis`**. It copies `hl7/hl7common` (+ site
`hl7.<site>/hl7common` overrides if present) and `hl7.<site>/config[.module]` into
`$CCRUN/cql/hl7/` and generates `starthl7[.module].scm`. See
[references/hl7-site-config.md](references/hl7-site-config.md).

## 5. Common workflows

### A. New or modified report / menu application

1. Read a similar existing script under `cql/lisp/` first (style + header convention).
2. Write `cql/lisp/<name>.scm` with the standard banner (FILE / DESCRIPTION / AUTHOR /
   Copyright) and dated change-log lines (see Section 6).
3. Register it in `cql/lisp/Makefile` as a new `SCRTn := <name>.scm` — the list is explicit;
   an unlisted file is NOT installed.
4. If it must be reachable from the menu, add
   `(list "<Title>" "<name>.scm" "<PERM-APP>")` to the `choices` list in `cql/lisp/menu.scm`
   (third element `nil` = no permission gate; otherwise checked via
   `staffid-check-perms <PERM-APP> "E" $CCSYS_STAFFID`).
5. If the script defines user-facing commands, add help entries to `cql/lisp/cql.hlp`
   (strict `(<sym> <args>...) "description"` format; malformed entries break `help`).
6. `make` install, then test via menu or `cql -b -i<name>.scm`.

### B. Ad-hoc CQL from the shell

The established pattern is piping a CQL expression into the binary (see `scripts/cqllog`,
`scripts/cqldump`, `scripts/showbed`):

```sh
echo '(begin <set!s> (<fn> (patient-by-patid 123)) "Bye.")' | cql -b -i<lib>.scm -e
```

Common flags: `-b` batch, `-i<file>` initial-load file, `-e` exit at EOF, `-n` no shell
(`scripts/cql`), `-h<...>` (DAS options, see `scripts/showbed`).

Ready-made entry points:

| Script | Does |
|---|---|
| `scripts/cql` | raw interpreter: `exec $CCRUN/bin/cql -n "$@"` |
| `scripts/cqllog <dbpath>\|<patid> [IT...]` | `all-report-by-obs-time` report (uses `.dosu`) |
| `scripts/cqldump <dbpath>\|<patid> [IT...]` | `asciify-patient` dump (**cis only**) |
| `scripts/showbed [-t] [-w w] [-m mins] [-i mins] [-p prec] unit bed` | DAS monitor data via `das.scm` |
| `scripts/cqlmenu/CQL` | interactive menu (`cql -i$CCRUN/cql/menu.scm -e -n` with stty setup) |
| `scripts/webcql` | CIS-authenticated entry to the adminutil menu |
| `scripts/UNA_LOGIN` | console-only unarchive login → `.dosu $CCRUN/bin/cql -b -iunarch.scm -e` |

### C. New HL7 site / module / trigger / field mapping

Read [references/hl7-site-config.md](references/hl7-site-config.md) and follow it. Summary:
clone a similar `hl7.<site>/`, rewrite the per-site files (`hl7local.scm`, `unitbed_map.cf`,
`msgdata.cf`, `segment.cf`, `adt.cf`/`oru.cf`, `hl7format.scm`, `trigger.cf`), then install
with `setup_cql_hl7` as `cis`.

### D. GDB (long-term dump) query / ODBC export

- A GDB is a long-term dump of patient data; the current dump is in `$GDBCURRENT`
  (read as `(getenv "GDBCURRENT")` in the GUI apps).
- GUI query apps: `cql/gdb/gui_*.scm` (installed to `$(CCRUN)/gdbcql`), e.g.
  `gui_Simple_Queries` — pattern: `load "gui_define.scm"`, `gdb-open`, an `init-function-list`
  of `(funcname ...)` actions, GUI output via `send-starta-mark` / `output-print` /
  `send-enda-mark` / `send-quit_command`.
- Dump maintenance: `buildcurrentgdb.scm`, `buildlastmongdb.scm`, `getoldgdb.scm`,
  `movegdb.scm`, `ccarch.scm`, `dumpallcpa.scm`, `gdb_table_dump.scm`,
  `checkcurrentgdb.scm`, `checkgdbarhdir.scm`.
- ODBC export: `odbc.scm`, `odbc2.scm`, `odbc_util.scm`.
- Language built-ins: see the `gdb-*` group in Section 3 (all in `cql.hlp`).
- Register new GUI apps in `cql/gdb/Makefile` with `.INSTALLDIR := $(GDBCQLDIR)`.

### E. Patient archive / unarchive

- **Archive**: built-ins `arch-open` / `arch-close` / `arch-find` (`cql/lisp/archive.scm`);
  archive-dir tools `cql/archive/checkarchdir.scm`, `checkarchdir_comm.scm`,
  `copyarchdir.scm` (installed to `$(CCRUN)/cql`); log at `$CCRUN/log/archlog`.
- **Unarchive**: console-only `scripts/UNA_LOGIN` → `.dosu $CCRUN/bin/cql -b -iunarch.scm -e`;
  menu apps `manarchpt.scm` (Manual Single Patient Archive, `ADMIN`), `ccbackup.scm`
  (Patient Archive Backup, `CQL_ARCHIVE`), `Unarchive.scm` (`CQL_UNARCHIVE`).

## 6. Conventions when modifying `cql/` files

1. **File header**: keep/extend the standard banner
   (`;;; FILE: ...` / `;;; DESCRIPTION: ...` / `;;; AUTHOR: ...` /
   `;;; Copyright (C) <years> by CliniComp International`) and add a dated change-log line,
   e.g. `;; 15 jun 06 - lient - allow executing MySQL statement through CQL [SZ3845]`.
   Use the file's existing style.
2. **Code references in docs**: file path + stable symbol names only — **no line numbers**
   (they drift on any edit).
3. **Keep site-local behavior in the site dir.** Don't copy one customer's mapping into
   shared `hl7/hl7common` unless the change is genuinely general.
4. **Makefile lists are explicit.** Any new `.scm` that must be installed needs a new
   `SCRTn` entry in the matching Makefile (`cql/lisp`, `cql/lisp/hl7`, `cql/gdb`, `cql/archive`,
   `cql/scripts`).
5. **Don't create new top-level dirs under `cql/`** without need — install targets are
   fixed in the Makefiles.
6. **Historical artifacts stay put.** Dated/backup scratch files that live in the tree
   (e.g. `oru.cf.051404troys`, `unitbed_map.cf.SD206819`, `*.template`, `*.test`, `*.work`,
   `*.before`) are history: do not edit, do not clean up.
7. **`cql.hlp` is machine-parsed**: strict alternating list/string s-expression format. A
   malformed entry breaks `help`; run `(test-help)` to list objects with/without help.

## 7. Known traps

- **`hl7/` vs `hl7.<site>/`** — the shared engine vs customer configs. A site dir is NOT a
  variant of the shared one; `hl7/hl7common` is installed once, site files per site.
- **`config` vs `config.<module>`** — `config` is the site's *default* module; `config.<module>`
  (e.g. `config.pharm`, `config.lab`, `config.dsspharm`, `config.vista`) is an *additional*
  module installed alongside (each gets its own `starthl7.<module>.scm` and `hl7log.<module>`).
- **`trigger.cf` segment syntax**: `("ADT" "A01" hl7-a01 "hl7adt.scm" (list "MSH" "EVN" "PID"
  [ { "NK1" } ] "PV1" ...))` — bare segment = required, `[ X ]` = optional, `{ X }` = repeat
  group (optionals may nest). The segment list drives `hl7-check` validation; tightening it
  rejects messages that previously processed.
- **Processing-id gate**: in `hl7-process` (`cql/lisp/hl7/hl7common/hl7.scm`), MSH-11
  `"T"`/`"D"` messages ack `"NOT PROCESSED; TEST MODE"` / `"NOT PROCESSED; DEBUG MODE"`
  unless the site defines `process-t` / `process-d` as `"t"` — a message "not processing" is
  often just a processing-id, not a failure.
- **`get-patient` default is `patient-by-mrn`** (site `hl7local.scm`). Some sites override it
  to match by another identifier — read the site's `hl7local.scm` before assuming.
- **`sitename` is `cci` in `init.scm`** — site behavior comes from the installed config
  files, not from `sitename`.
- **`cis`-only scripts**: `scripts/cqldump`, `setup_cql_hl7`, `GdrCqlInterface.sh` check
  `whoami`; `.dosu`-based flows (`cqllog`, `webcql`, `UNA_LOGIN`) fail for other users.
- **`init.scm` is not reliably pre-loaded.** `dbutil.scm` helpers (`make-dbname`, `pat-id`,
  `pat-mrn`, `get-key`, `get-data`, `for-all-patients`, `asciify-patient`) are unbound until you
  `(load "init.scm")`. Almost every "unbound variable" in batch code is this. See
  [references/builtins-reality.md](references/builtins-reality.md).
- **`load-path` is `(<launch cwd> $CCRUN/cql)`** — bare `load` of a file that installs elsewhere
  fails. Notably `util.scm` / `adtutil.scm` install to `$CCRUN/cql/hl7`
  (explicit `.INSTALLDIR` on their `SCRTn` entries), so `(load "util.scm")` fails from `$CCRUN/cql`.
- **`GCS.scm` has no `SCRTn` entry** in `cql/lisp/Makefile` → it is never installed; load it from
  the source tree by absolute path.
- **Don't load `cql.scm` in batch** — it calls `window-size`, which fails with
  `error in ioctl call` when stdin is not a tty.
- **Don't load a `starthl7*.scm` wholesale in batch** — `hl7.scm` ends with `(hl7-main)`, an
  infinite `(read)` loop; load the engine pieces and call `hl7-process` instead.
- **`cql.hlp` ≠ available built-ins.** `make-dbname`, `for-all-patients`, `all-report-by-obs-time`,
  `apache-II`, `gdb-rewind`, `mysql-show-*` are documented but only exist after loading the owning
  library; run `cql -b -i$CCRUN/cql/testhelp.scm -e` for the real diff.
- **A `dbi` is a plain list** `(major-it minor-it key data …)`; `get-key` / `get-data` come from
  `dbutil.scm`, not the interpreter.
- **`db-def` fails with `IT not a number`** whenever `name-to-it` returned `nil` (wrong item name) —
  check the IT name before suspecting the query.
- **`-n` blocks writes** (`db-start-write` → `permission to store data denied`) — use it so tests
  cannot corrupt patient data. Exit code is `0` on success, `1` on any error under `-b`.
- **HL7 version is 2.1** (`hl7-version-id` in `ack.scm`).
- **Make needs the CC build environment** (the `make_inc.mk`/`make_rules.mk` includes come
  from `getsrcroot`, outside this tree) — same as the other ccsrc modules.

## 8. AI-driven development & automated testing

This module is expected to be worked on by an **AI agent executing the whole loop unattended**.
Following harness-engineering practice, the harness is five layers, and the two script
entries are the only things an agent needs to invoke:

```sh
cql/test/preflight.sh          # layer 2 — is this host ready?
cql/test/check.sh [group ...]  # layer 3 — deterministic feedback
```

| Layer | Where |
|---|---|
| 1 Rules (repo is system of record) | [SKILL.md](SKILL.md) router + [references/](references) + [cql/test/profile.json](../../../cql/test/profile.json) |
| 2 Execution environment | [cql/test/preflight.sh](../../../cql/test/preflight.sh) |
| 3 Feedback loop (sensors) | [cql/test/check.sh](../../../cql/test/check.sh) + [cql/test/cases/](../../../cql/test/cases) → `test-reports/cql-*.md` |
| 4 Recovery | [cql/test/progress/task-template.md](../../../cql/test/progress/task-template.md) + checkpoint commit |
| 5 Evaluation | [cql/test/evals/tasks.md](../../../cql/test/evals/tasks.md) + `cql/test/evals/grade.sh` |

Detail the harness itself does not carry:

| Need | Reference |
|---|---|
| The five-layer map, case format, gates, pitfalls | [cql/test/README.md](../../../cql/test/README.md) |
| The single loop (orient → understand → plan → code → install → test → self-fix → report → write-back), gates, failure→fix table | [references/ai-runbook.md](references/ai-runbook.md) |
| Runtime reality: env vars, `cql` flags, permission model, `load-path`, install layout, command inventory | [references/runtime-environment.md](references/runtime-environment.md) |
| `cql.hlp` vs. what is actually defined; library load-order recipes | [references/builtins-reality.md](references/builtins-reality.md) |
| Case-format contract, seed cases with verified expected values, report skeleton | [references/automated-testing.md](references/automated-testing.md) |

Non-negotiables for any automated run:

1. **Read-only by construction** — tests always pass `-n` (blocks `db-start-write`); never `-S`.
2. **DB-touching cases run as cis** (`.dosu`); pure-computation cases run as anyone.
3. **Every batch script starts with `(load "init.scm")`.**
4. **Assert on exit code + stdout substrings** — `0` = success, `1` = any error under `-b`.
5. **Every new report ships with a case**, and its entry point must be callable in batch (no
   `readline`, no `menu`, no `window-size`).
6. **New findings are written back into `skills/cci-system/cql/`**, never into `AGENTS.md` or chat.
