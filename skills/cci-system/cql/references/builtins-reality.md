# Built-ins: `cql.hlp` vs. reality

Companion to [../SKILL.md](../SKILL.md) §3. `cql/lisp/cql.hlp` is the authoritative *reference*,
but it is **not** a guarantee that a symbol exists in a bare `cql` process. This file records what
was actually observed on the reference host so AI-generated code does not call symbols that are
documented but absent (or present but unloaded).

Rule of thumb: **before using any built-in for the first time, prove it with a one-liner** (below).

## 1. Prove a symbol in two seconds

```sh
echo '(printf "%S\n" (symbol-bound? (quote make-dbname)))' | $CCBINDIR/cql -b -n
echo '(load "init.scm")(printf "%S\n" (symbol-bound? (quote make-dbname)))' | $CCBINDIR/cql -b -n
```

`t` / a closure ⇒ usable; `()` ⇒ unbound (calling it gives `ERROR: unbound variable` + exit 1).

## 2. The big trap: CQL-level helpers are NOT built-ins

These are defined in **`cql/lisp/dbutil.scm`** (and friends), which is loaded by `init.scm`.
In a bare `-b -n` process they are **unbound**:

`get-major-it` `get-minor-it` `get-key` `get-data` `get-log-id` `pat-id` `pat-dbpath` `pat-mrn`
`pat-name` `pat-unit` `pat-bed` `pat-hospno` `pat-doctor` `pat-dodid` `pat-upi` `item-major-it`
`item-name` `item-fullname` `item-unitstring` `item-type` `log-time` `log-name` `log-init`
`concat-database` **`make-dbname`** `asciify-database` **`asciify-patient`** `asciify-epd-patient`
`asciify-dbpath` **`for-all-patients`** `for-all-active-patients` `is-primary-stay?`
`dump-patient-info` `print-items` `print-item-holes` `length-of-stay` `patients-by-*`
`patient-by-patid` `get-admit-key` `get-latest-pat` `note-qname-to-tag` `note-def` `note-del`
`db-get-it-data` `db-get-all-notes` `trim` `rm-commas` `rm-quotes`

From **`cql/lisp/siod.scm`**: `1st`…`15th` (note: **`nth` is a built-in but `1st`…`15th` are not**),
`mapcar` `for-each` `remove` `apply` `quotify` `sort` `qsort` `merge` `remove-duplicates` `explode`
`strcontains` `str-to-list` `list-to-string` `strchr` `str-find-and-replace`
`remove-leading-blanks` `remove-trailing-blanks` `system-read` `replace` `prognify` `cond-convert`
`list?` `select-list` `sorted?`

⇒ **Always start a batch script with `(load "init.scm")`.** Most "unbound variable" failures in
generated code are just a missing prelude.

## 3. Documented in `cql.hlp` but NOT defined in a bare process

Verified via `cql -b -i$CCRUN/cql/testhelp.scm -e` (section *OBJECTS WITH HELP, BUT NOT DEFINED*):

`range-search` `range-search-all` `stored-observed-interval` `stored-observed-interval-all`
`edit-report-by-obs-time` `edit-report-by-clock-time` `qa-delayed-storage`
`all-report-by-clock-time` `all-report-by-obs-time` `asciify-save-db` `asciify-load-db`
`apache-II` `apache-score` `apache-score-first-day` `apache-score-day` `gdb-rewind`
`mysql-show-all` `mysql-show-databases` `mysql-show-tables` `mysql-show-columns`
`mysql-record-print` `MPI`

These are **library functions, not built-ins** — they become defined once you load the owning
library:

| Symbol | Load first |
|---|---|
| `all-report-by-obs-time`, `all-report-by-obs-time2`, `all-report-by-obs-time3`, `asciify-patient` | `edits.scm` (+ `init.scm`) |
| `apache-II`, `apache-score`, `apache-score-day` | `hl7/util.scm` → `severity_util.scm` → `apacheII.scm` |
| `gdb-rewind` | GDB libs (`cql/gdb/gdb_util.scm`) |
| `mysql-show-*` | `mysql.scm` |

`make-dbname` and `for-all-patients` are in `dbutil.scm` (see §2) even though `cql.hlp` presents
them like built-ins.

## 4. Confirmed-working built-ins (no prelude needed)

Probed directly on the reference host:

- **Core:** `+` `-` `*` `/` `printf` `display` `car` `cdr` `cons` `list` `length` `nth` `member?`
  `append` `set!` `define` `let` `while` `if` `cond` `begin` `quote` `eval` `load` `read`
  `string-to-number` `number-to-string` `strlen` `substr` `strcmp` `strcat` `symbol-to-string`
  `symbol-bound?` `file-exists?` `getenv` `quit` `error` `gc`
- **IT / patient (C built-ins):** `name-to-it` `it-to-item` `patient-by-mrn` `patient-by-unit-bed`
  `patient-by-name` `patient-by-id` `patient-by-dbpath2` `patient-next` `patient-rewind`
  `db-open` `db-close` `db-def` `db-undef` `db-step` `db-step-key` `db-start-write` `db-end-write`
  `db-admit-key` `db-path` `adt-admit` `adt-discharge` `adt-transfer` `staffid-check-perms`
  `config-environment` `config-beds-in-unit` `printer-routes` `printer-status`
- **Time:** `time-now` `time-to-string` `time-to-longstring` `time-to-formatted-string`
  `readtime` `never` (`2147483647`)
- **Statistics / PS:** `total` `mean` `median` `ps-open` `ps-close` `ps-printf` `plot-graph`

Anything outside this list: prove it with §1 before relying on it.

## 5. Library load-order recipes (verified)

```scheme
;; baseline — always
(load "init.scm")

;; severity scoring (APACHE II / SAPS II / MPM II)  — verified end-to-end
(load "init.scm")
(set! load-path (cons (strcat (getenv "CCRUN") "/cql/hl7") load-path))
(load (strcat (getenv "CCRUN") "/cql/hl7/util.scm"))         ; util.scm installs to $CCRUN/cql/hl7
(load (strcat (getenv "CCRUN") "/cql/severity_util.scm"))    ; defines make-major-it-list
(load (strcat (getenv "CCRUN") "/cql/apacheII.scm"))         ; or sapsII.scm / mpmII.scm

;; GCS — NOT installed at all (no SCRTn entry); load from the source tree
(load "<repo>/cql/lisp/GCS.scm")    ; Glasgow-Coma-Score, compute-score, value-to-int, neuro-it-list

;; reports / dumps
(load "init.scm")
(load "edits.scm")    ; all-report-by-obs-time*, asciify-patient
(load "dumpdb.scm")   ; asciify-* helpers

;; HL7 engine pieces, WITHOUT starting the engine (hl7.scm ends in the hl7-main
;; read loop). MSH accessors (msh-processing-id, msh-message-type, msh-control-id,
;; ...) and the trigger accessors (trigger-type / trigger-event / trigger-subr)
;; live in types.scm — not in hl7msg.scm.
(load "init.scm")
(set! load-path (cons (strcat (getenv "CCRUN") "/cql/hl7/hl7common") load-path))
(load "types.scm")
(load "hl7msg.scm")   ; only get-msg-value / get-patient-* / field-to-string
(load "ack.scm")      ; hl7-ack / hl7-ack-error / hl7-ack-reject, hl7-version-id
```

Why the severity chain is fragile — two independent failure modes, both observed:

1. `apacheII.scm` / `sapsII.scm` / `mpmII.scm` call `make-major-it-list` at **load time**, and that
   symbol lives in `severity_util.scm`; loading them in the wrong order fails with
   `errobj = make-major-it-list`.
2. `severity_util.scm` loads `siod.scm` / `util.scm` / `dbutil.scm` **by bare name**, and
   `util.scm` is installed under `$CCRUN/cql/hl7` (not on the default `load-path`), so a bare
   `(load "severity_util.scm")` from an arbitrary cwd fails with `errobj = "util.scm"`. And
   `util.scm` itself does a bare `(load "adtutil.scm")` — also in `$CCRUN/cql/hl7` — so an absolute
   path alone is not enough: **`$CCRUN/cql/hl7` must be on `load-path` first.**

Fix (either works, the first is preferred for scripts): prepend `$CCRUN/cql/hl7` to `load-path`, or
`cd $CCRUN/cql/hl7` before launching `cql`.

## 6. `cql.hlp` is machine-parsed — edit it strictly

Format (stated in the file header): a series of **alternating s-expression list and string**, where
the `car` of each list is the help key.

```scheme
(db-open dbname)
	"Opens the database indicated by the unix path string dbname.  Returns a dbtd."
(db-def dbtd bkey ekey mode it-list)
	"Define a database read request on dbtd.  …  Returns a dbh."
```

A malformed entry breaks `help`. After editing, run the integrity check:

```sh
$CCBINDIR/cql -b -i$CCRUN/cql/testhelp.scm -e </dev/null
```

It prints `OBJECTS DEFINED, BUT WITHOUT HELP:` and `OBJECTS WITH HELP, BUT NOT DEFINED:`.
Expect both lists to be non-empty on a live system (they include library functions that are simply
not loaded into the checker) — the check is **"no new entry caused a parse failure and no entry
disappeared"**, not "both lists empty".
