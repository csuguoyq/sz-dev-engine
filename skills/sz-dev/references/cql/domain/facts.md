# CQL must-know facts (grep-friendly)

> These facts hold for every layer. Sources: the former per-directory
> `AGENTS.md` files (now consolidated here) + a 2026-09 static analysis
> of `cql/`, `cclib/cql`, `cclib/cqlA`, `gdbscripts/`, `Make/`.
> Facts are cited by number elsewhere (e.g. `tools/cql_lint.py` gates).

## Positioning

`cql` = SIOD Scheme interpreter binary (CCI-maintained since 1991;
welcome banner `"Welcome to CQL, Clinical Query Language, Version 2.2"`)
+ ~250 C database primitives (`db-open`, `gdb-def`, `patient-by-mrn`,
`adt-*`, ...) + 2100+ `.scm` application scripts. It is the CIS toolbox
for clinical queries, reports, operations, and external interfaces
(ODBC). The newer SQL-style query layer is YCQL (`util/ycql`, HOBJS);
the two coexist.

## The 8 facts (read before any change)

1. **gdb ≠ debugger.** Every `gdb*` here means **global database**: an
   mmap read-only snapshot of the hospital-wide patient store
   (`$CCSYSDIR/gdb/ActivePatients`, `ArchGDB_<month>`), rebuilt on a
   monthly rolling basis.
2. **`-n` = read-only safe mode** (`disable_storage=1`, implemented in
   `cclib/cqlA/siodR.c` `siod_process_cla`): all write primitives are
   rejected; `(system ...)` may only run the `$CCRUN/cql/safebin`
   whitelist. The read-only wrapper script `cql` is installed in
   safebin; the bare binary is `$CCRUN/bin/cql` (unprotected). **Every
   new write primitive must copy the `disable_storage` check from
   `cclib/cqlA/cciadt.c`.**
3. **Path ambiguity.** After startup cql `chdir($CCSYSDIR)` while
   `load-path` contains `$CCRUN/cql` — a relative path may be either a
   data file or a library script. Use absolute prefixes in scripts
   (the `(string-append (getenv "CCRUN") "/cql/...")` style of
   `cql/lisp/cql.scm`). Enforced by a `cql_lint.py` gate.
4. **Data-access five-step** (covers ~90% of scripts):
   `db-open → db-def → db-step loop → db-undef → db-close`;
   write path `db-start-write → db-newd → db-end-write`; the global
   store uses `gdb-*` primitives and is read-only. Minimal complete
   sample: `cql/lisp/dumpdb.scm` (19 lines).
5. **Dual handle system.** dbtd is a number (`flocons`); query handles
   (DBH/GDBH/GDDH/GDNH) are `tc_ptr` pointer objects (`ptrcons`/`PTR`,
   types in `include/siod.h`). dbtd and gdbtd are registered in the
   **same table** (`dbtd_desc_list`) — never mix them.
6. **Source tree ≠ runtime tree.** `make install` puts artifacts into
   `$CCRUN` (bin/cql/gdbcql/...); static libs stay in `cclib/lib<platform>/`
   for linking. Build system: one Makefile per directory, driven by
   `Make/make_inc.mk` + `make_rules.mk`; `getsrcroot` finds the tree root.
7. **This checkout may be a Windows/CI checkout that cannot build or
   run.** Build and test happen on a Linux host (RHEL, `/eerun`
   toolchain, a ccsrc checkout recognizable by `getsrcroot`).
   Detected by a `cql_lint.py` gate.
8. **CCIDB is a black box below this stack.** The single-patient DB
   engine (`Ndbopen`/`_dbdef`, declared in `include/dbmem.h`) ships as
   prebuilt libccidb — not in this repo; the GDB layer (`cclib/cql`)
   is visible source. On-disk format constants: `include/gidx.h`,
   `include/_disk.h`.

## Engine string traps (validated 2026-09-24, SZ22052)

- **`wta to lstrcat` = a nil (`()`) element reached a string primitive.**
  `strcat`/`string-append` accept empty strings fine; it is `()`
  (parsed empty subcomponents) that crashes joins — this is what bit
  `(list-to-string (cdr rxa-7) "&")` on `(com () "40% fio2 on HFNC")`.
  Filter or nil-guard before joining.
- **`field-to-string` (`hl7common/hl7msg.scm`) IS the universal com/rep/sub
  resolver** — it nil-guards and joins with the HL7 delimiters (`com`→"^"),
  so `(com () "40% fio2 on HFNC")` resolves to `"^40% fio2 on HFNC"` without
  error. Prefer it over hand-rolled joins (validated 2026-09-24).
- **Parsed-field tags may be a symbol or a string.** Hand-built
  s-expressions on tickets show bare `com` (symbol); driver-constructed
  lists often carry `"com"` (string). Tag checks must accept both
  (`(or (eqv? (car v) 'com) (eqv? (car v) "com"))`).
- **Numeric-leading text short-circuits dose logic.** `get-del-data`'s
  tail uses `(string-to-number rxa7)`: text whose leading token parses as a number
  (e.g. `"40"`) takes the value-only branch, while `"^40%..."` (leading
  component separator) is text and takes the concat branch, so the delivery
  string is RXA-7 alone, not `strcat rxa6 " " rxa7`. Assert against
  this semantic, not against naive concatenation.

## Common task quick answers (details in the layer files)

- **New query/report script** (most common, zero compilation): create
  the .scm in `cql/lisp/` → continue the `SCRTn` sequence in
  `cql/lisp/Makefile` → `cd cql/lisp && make install`.
- **New C primitive**: write `LISP myfoo(LISP ...)` in `cclib/cqlA/`
  (unwrap `PNAME`/`FLONM`/`PTR`, return `flocons`/`strcons`/`ptrcons`/
  `Make...List`) → register `init_subr("my-foo", tc_subr_N, myfoo)` in
  `cci.c` `init_ccisubrs()` → add a help entry in `cql/lisp/cql.hlp` →
  rebuild cqlA → relink `cql/siodsgi`.
- **Change the interactive shell / menu**: the `command-list` table in
  `cql/lisp/cql.scm` / the `choices` table in `cql/lisp/menu.scm`
  (mind the `.template` install convention vs the live site file).
- **Debugging**: script layer — interactive REPL + `cqllog`/`cqllog3`/
  `cqldump`; C layer — `/usr/bin/gdb` on `$CCRUN/bin/cql` (built -g);
  logs `$CCRUN/log/gdbbuild.log`, `archlog`.

## Authoritative primary sources (beat any secondhand summary)

- `cql/lisp/cql.hlp` — built-in help for every primitive (data source
  of `(help 'sym)`); strict alternating format: signature list +
  description string.
- `cql/siodsgi/siod.c` file header — Paradigm/CCI revision history.
- `include/siod.h` / `include/gidx.h` / `include/_disk.h` /
  `include/dbtd.h` — language types and on-disk data structures.
