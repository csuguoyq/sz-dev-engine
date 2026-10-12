# Interpreter + C primitives — cclib/cqlA + cql/siodsgi

> Facts in `domain/facts.md` apply. Product: `libcqlA.a`
  (`cclib/cqlA/Makefile` `LIB := cqlA`); linked only by `cql/siodsgi`,
  `cql/siodptx`, and `util/ccidb` (autoGenerateObservationRcf).
> After `make`, relink the consumers (`cd cql/siodsgi && make install`).

## cclib/cqlA — file map

**Interpreter core (modified SIOD)**:
`slib.c` (standard Scheme subrs + `init_subrs`; `_lsystem` carries the
safebin restriction), `parser.c` (reader), `eval.c` (`leval`), `gc.c`
(two selectable GCs; heap and `load-path` init), `alloc.c`
(`cons/flocons/strcons/symcons/ptrcons`), `io.c` (`vload`/`real_load`,
walking `load-path`), `siodR.c` (REPL + `siod_process_cla` command
line + welcome banner), `print.c`, `sliba.c` (LISP arrays), `lparse.c`,
`set.c`, `stats.c`, `file.c`, `cql.c` (CCI gc hooks `our_gc_*`),
`ps.c`/`plot.c` (PostScript).

**CCI primitives (`cci` prefix, one file per domain)**:
`cci.c` (**master registry** `init_ccisubrs`, ~250 `init_subr` calls;
also `init_ccistorage`: shared memory / `never` constants / dbtd table
init), `ccidb.c` (`db-*` online store read/write), `gccidb.c` (`gdb-*`
global store, g=globaldb), `gccipatient.c`/`ccipatient.c`
(`patient-*`), `cciadt.c` (`adt-*`), `cciaudit.c`, `cciarch.c`
(`arch-*` archive), `ccinotes.c` (`note-*`), `ccimysql.c` (`mysql-*`,
SZ3845), `ccidatap.c` (vdata decoding `Datap_SetUp`), `cciconfig.c`
(ccResources access), and self-describing others: `ccidas.c`,
`cciitem.c`, `ccitemplate.c`, `ccifancy.c`, `ccigrid.c`, `ccifreq.c`,
`cciorder.c`, `ccistaffid.c`, `ccitime.c`, `cciresource.c`,
`ccinotification.c`, `ccipharmverify.c`, `cciparsemsg.c`, `ccidefs.c`,
`cciexpires.c`, `cciprinter.c`, `cciallergies.c`, `cciReport.c`,
`ccihold.c`, `alone_def.c`, `autoDC.c`, `allergyFTP.c`, `epdPat.c`
(EPD storage), `epo.c`.

## Standard flow: adding a primitive

1. In the domain file (or a new file + `Makefile` SRCS) write
   `LISP my_foo(LISP x)`:
   - Unwrap: `PNAME(x)` string / `FLONM(x)` number / `PTR(x)` pointer
     object / `TYPE(x)` type test.
   - Errors: `err("message", x)`; database errors use `dberrno`
     (`DBE_*` in `include/dbmem.h`) + `cciDbErr`.
   - Return: `flocons(n)` (dbtd etc. small integers) / `strcons(...)` /
     `ptrcons(handle)` / `cons` lists; struct→list pattern:
     `MakegDbiList` in `gccidb.c`.
2. Register in `cci.c` `init_ccisubrs()`:
   `init_subr("my-foo", tc_subr_N, my_foo);` (fixed arity →
   `tc_subr_N`, variadic → `tc_lsubr`).
3. **Write primitives must** start with
   `if (disable_storage) err("... permission to store data denied.", NIL);`
   (copy `cciadt.c`) — otherwise the `-n` read-only safety model breaks
   (fact 2).
4. Add an entry to `cql/lisp/cql.hlp` in the strict
   `(my-foo arg) "description"` format.
5. Rebuild cqlA → relink the cql binary → self-test interactively with
   `(my-foo ...)`.

## Key mechanisms (map for reading the code)

- Dual handles (fact 5): dbtd = number (`flocons`); query handles =
  `tc_ptr` (`ptrcons`/`PTR`, `include/siod.h`). Open-store state lives
  in `dbtd_desc_list[MAX_CQL_DBOPENTABS]` (`how=OPEN_DB/OPEN_GDB`);
  **db-* and gdb-* handles share one table — never mix them**.
- Predicate-carrying step: `ccigDbStepWithPred` in `gccidb.c` calls
  back into `leval` inside the C loop to evaluate a user predicate —
  the canonical C↔Scheme mutual-call sample.
- All command-line/mode flags: `siod_process_cla` in `siodR.c`
  (`-n`/`-m`/`-b`/`-e`/`-d`/`-u`/`-h`/`-i`/`-g`/`-l`/`-S`).
- safebin restriction: in `-n` mode `_lsystem` in `slib.c` and pipe
  opens only allow `$CCRUN/cql/safebin`.

## cql/siodsgi — main() and glue (not the interpreter body)

Only `main()` and a little glue; the interpreter body (parser/eval/gc/
alloc/io/slib/siodR) and all C primitives live in `cclib/cqlA`.
`siodptx/` is the trimmed PTX (Sequent DYNIX) legacy variant (no
init_cpa, no AppLog) — normally untouched.

- `siod.c`: `main()` — startup sequence
  `AppLog::init("cql") → siod_process_cla → siod_print_welcome →
  init_storage → init_ccistorage → init_subrs → init_cpa →
  init_ccisubrs → chdir(ccsysdir()) → siod_repl_driver`. File header
  carries the Paradigm/CCI revision history.
- `init.c`: `init_cpa()` registers this directory's primitives
  (`db-cpa-*`, `hold-*`).
- `ccicpa.c`: clinical-pathway (CPA) query bridge:
  `cciCpaDef/Step/Undef` → `cpaCqlDef/Step/Undef`, results assembled
  into nested Scheme tables.
- `ccihold.c`: archive holding-area bridge:
  `cciHoldDef/Step/Rewind/Undef/Readmit/SendtoHold` → `hold_*`
  (bottom layer `include/Arch/holdCQL.h`).
- `glbs.c`: link-completion stubs (termlib globals, empty
  `ccsysrestart`) — non-functional code.

## Makefile + change flow

`PROG := cql` → installs to `$CCRUN/bin`. SRCS is only 5 .c files;
`CCLIBS` is ~150 libraries (cqlA, cql, ccidb, ycqlbasic, patcntl,
notes96, arch, EPD, ... — **the cql binary embeds both the legacy Lisp
engine and the YCQL base functions**, so Lisp code can call YCQL data
access directly). `D2 := -DUSE_MOTIF`; system
libs `-lexpect -ltcl -lX11 -ltiff -ljpeg` + curl.

**CQL/YCQL shared layer**: `include/ycql/CommCQL.H` is shared by both
stacks (CQL links `ycqlbasic`; the newer YCQL stack lives in
`cclib/ycql`, `util/ycql`, `HOBJS/`). A change to that header (or to
`ycqlbasic`) requires regression on **both** sides. New
reports/query interfaces normally belong in YCQL/HOBJS; CQL remains
irreplaceable for interactive troubleshooting (`cqllog`), GDB ops, and
the ODBC pipe backend (`cql/gdb/odbc.scm` + `links/odbc/odbc.c`).

Change flow: glue/primitive changes start from the registration flow
above; then `cd cclib/cqlA && make` (if the lib changed) →
`cd cql/siodsgi && make install`. New link dependencies go into
`CCLIBS` with the library built first.
