# CQL SZ layer routing table

> Consumer: `skills/sz-dev` Phase 1 (routing step). Source rules: `automation.md` §2.2. References use file paths + stable symbol names only — no line numbers.

## Routing rules

Route by the SZ's `Change Context` field + the paths hit by the diff (when the two conflict, the diff wins):

| diff hit | Layer | Read first | Automated actions |
|---|---|---|---|
| `cql/lisp/**.scm` (including `cql/lisp/hl7/**`, `cql/lisp/refnote/**`) — **Create** | **Scripts** | `domain/scripts-layer.md` | New .scm → continue the `SCRTn` sequence in `cql/lisp/Makefile` (same for subdirectories) → `make install`; the IN draft generates the `make install` line for the corresponding directory; zero compilation |
| `cql/lisp/**.scm` (including `cql/lisp/hl7/**`, `cql/lisp/refnote/**`) — **Modify** | **Scripts** | `domain/scripts-layer.md` | No Makefile change (the file is already sequenced); `make install` only; the IN draft generates the `make install` line |
| `cql/lisp/hl7.<site>/**` (site-config subtrees, e.g. `hl7.wrr/config.wrr/`, `hl7.dss/config.txorders/`) | **Scripts (site config)** | `domain/scripts-layer.md` | Install + daemon restart: `setup_cql_hl7 -t <site> -m <module> [-f]` (run from the dir holding BOTH `hl7/` and `hl7.<site>/` — the source tree's `cql/lisp/`; it copies `hl7.<site>/config.<module>/` into `$CCRUN/cql/hl7/config.<module>/`, prompts unless `-f`, and regenerates the site starter) then `RESTART_HL7`; no Makefile/`SCRTn` work — these subtrees carry no Makefile (never draft a `make install` line for them: none exists and it would be a no-op); the IN draft generates the install + restart lines |
| top-level `util/**` (`util/ycql`, `util/HL7Outbound` — outside `cql/`) | **Scripts (util, unclassified fallback)** | `domain/scripts-layer.md` + the nearest Makefile | Classify manually: runList templates install as data (`$CCSYSDIR`); `util/HL7Outbound` daemon-control scripts continue that Makefile's `SCRTn` sequence and install as executables (0750); app enablement also needs the `runList.cf` entry AND a `trigger.apps` entry in `$CCSYSDIR/trigger.rcf` (`START_HOPD` exits 6 on an app missing from `trigger.apps`) |
| `cql/util/**` (HL7 daemons, `SCRTn` continuation, runList templates) | **Scripts (util)** | `domain/scripts-layer.md` | Daemon/script changes install to `$CCRUN`/`$CCSYSDIR`; a continuation of an `SCRTn` sequence follows the Create row; runList templates install as data; the IN draft generates the corresponding `cp`/install lines |
| `cql/scripts/**` | **Scripts (shell)** | `domain/scripts-layer.md` | Modify shell wrappers/ops scripts; the IN draft generates `.dosu cp` lines to the corresponding `$CCRUN`/`$CCSYSDIR` paths |
| `cclib/cqlA/**.c` | **Lib** | `domain/interpreter-lib.md` | The primitive trio completed in one diff: (1) the C implementation (write primitives must copy `cclib/cqlA/cciadt.c`'s `if (disable_storage) err(...)` check); (2) register with `init_subr("my-foo", tc_subr_N, ...)` in `cclib/cqlA/cci.c`'s `init_ccisubrs()`; (3) add a "signature list + description string" help entry in `cql/lisp/cql.hlp`. Then rebuild cqlA + relink `cql/siodsgi`; template: `templates/c-primitive-trio.md` |
| `cql/gdb/**`, `gdbscripts/**` | **GDB** | `domain/gdb-stack.md` | Only generate ops scripts + TC scripts (mmap read-only snapshots; no unit-test surface); never treat gdb as a debugger |
| `cql/siodsgi/**` (only) | **Interpreter** | `domain/interpreter-lib.md` | Very rare; relink after changing main()/glue — treat as Lib-layer build |
| anything unclassified | — | — | Classify manually by reading the nearest Makefile / install path, and record the classification + reasoning in `phase1-requirement.md` — never leave the row unrouted |

Mixed diffs (Scripts + Lib hit at once) follow each layer separately; merge the deliverables. Create vs Modify matters: a **modification** of an existing `.scm` never touches the Makefile, only **creation** continues the `SCRTn` sequence.

## Layer → generation template (`templates/`)

| Scenario | Template | Parameterization points |
|---|---|---|
| HL7 inbound handling (the vast majority of Scripts SZs) | `hl7-inbound-handler.scm` | the `starthl7.<site>.scm` framework, handler structure in `cql/lisp/hl7/hl7common/` (e.g. `hl7oru.scm`), field mapping table |
| Query/report script | `query-report.scm` | the five-step data access pattern `db-open → db-def → db-step → db-undef → db-close` (template `cql/lisp/dumpdb.scm`): db-open target, db-def fields, output format |
| New C primitive | `c-primitive-trio.md` | C implementation + `cci.c` registration + `cql.hlp` entry, all three generated in one diff |

## Layer → test shape (per-SZ case YAML, delivered outside the repo; runner: see `cql/test/acceptance/README.md`)

| Layer | Case shape | Example |
|---|---|---|
| Scripts (HL7) | installed host: `cat <msg>.scm \| .dosu cql.<SZ> -i starthl7.<config>.scm` + ACK/cqldump/log assertions. On a source/replay tree (no `starthl7.<config>.scm` exists — the install step generates it; and loading `hl7.scm` wholesale enters `hl7-main`'s read loop): stage the install layout and drive batch mode — split the roots (`CCRUN=<runtime>` for engine data, `HL7BASEDIR`/`hl7-config-dir` at the staged script copy), `(load "<abs>/hl7.scm")`, then feed message s-expressions on stdin; see `repro.md` Level-2 recipe + driver-runtime traps | `cases/SZ17562.yaml`, `cases/SZ27614.yaml` |
| Scripts (migration/ops scripts) | run the script itself + assert on the produced file contents | `cases/SZ31689.yaml` |
| Lib | first change the druglist precondition with `ycql ... update druglist ...`, then HL7 injection | `cases/SZ27614.yaml` (`get-fluids-by-ien` picks the first non-obsolete entry) |
| GDB | read-only smoke (`cql -n -i`) + a manual ops script | no YAML-ized precedent; execute manually per the TC script |

## Site config (hl7) — load chain, staging, find-pat and message tables

**Site load chain**: a site handler does not load alone —
`cql/lisp/hl7/hl7common/hl7.scm` loads `hl7formatutil.scm` and
`hl7format.scm`, and the latter resolves through the load path to the
**site's own copy** (every `cql/lisp/hl7.<site>/config.<module>/`
carries its `hl7format.scm` with the site `format-*` functions). A
smoke or
staged fixture that loads `msgdata.cf` alone silently nils every
`format-*` field (eval-of-unbound is swallowed, exit 0) — mirror the
production chain or the assertions read false-negative. The interface's
own load head may also reach the CQL root (`(load "util.scm")` →
`adtutil.scm`): a staged config root must stage `util.scm` +
`adtutil.scm` too, plus the runtime `cql-staffids.cf` the source tree
does not carry. Staged run trees must be cis-writable (a+rwX — the
engine opens `HL7LOGFILE` under the staging logs dir at startup).

For HL7 inbound SZs the FRD text may name a find-pat function that the
handler does not actually call. **Verify by reading the trigger's call
chain** (e.g. `hl7-oru` → `hl7-local-find-wrr-pat`), not the FRD's
function name. Known example: the `config.wrr` ORU handler calls
`hl7-local-find-wrr-pat` defined in `hl7.wrr/config.wrr/hl7oru_wrr.scm`,
NOT `local-find-pat` in `hl7.wrr/config.wrr/hl7local.scm` (which the
handler does not call).

Message field extraction: a site's PV1/PID/etc. fields may need a new
entry in the **site's** message lookup tables. For wrr:
`cql/lisp/hl7.wrr/config.wrr/msgdata.cf` carries BOTH
`msg-lookup-table` (the handler's default table, `get-msg-value msg
msg-lookup-table ...`) and `note-msg-lookup-table` (a second table,
`get-msg-value msg note-msg-lookup-table ...`). Check the handler's
actual table before adding a key; a key may already exist in the other
table (e.g. `rad-visit-num` → PV1-19.1 in `note-msg-lookup-table`
pre-dates the wrr patid change).

**`trigger.cf` syntax lists have no in-repo consumer**: `trigger-syntax`
is defined in `hl7common/types.scm` but never called — `find-trigger`
matches type + event only. A trigger entry's segment list is read, if
at all, by the out-of-repo interface layer (e.g. the MLIP middleware).
Reviewing "make segment optional" config changes therefore splits:
in-repo behavior is unaffected by the list, interface-layer alignment
is field-validation territory (install + restart), and the review
records exactly that split.

## Mandatory post-routing actions (in order)

1. Prior-art search: start from `sz-history.md` (enumerated 2018+, pack-referenced families marked) then softzilla MCP `bugs_quicksearch` (query = SZ title keywords; quicksearch syntax see `quicksearch_syntax_resource`) + `git log --grep=SZxxxxx` for sibling few-shots. Replay runs: when the pack-exclusion grep hit `sz-history.md` for this SZ (replay-mode Delta 2 source 3), skip that file entirely and substitute workspace `git log` + MCP as the prior-art source, recording the degradation.
2. Draft the code from the templates.
3. Run the five static gates of `tools/cql_lint.py`; only an all-green result proceeds to build/test.
4. Deliverable drafts: RN (title + diff summary), TC (reverse-generated from YAML), IN (derive `make install`/`RESTART_HL7`/`RESTART_ADTD` per layer), CN (empty template).
