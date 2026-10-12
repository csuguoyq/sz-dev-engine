# CQL Runtime Environment & Execution Model

Companion to [../SKILL.md](../SKILL.md). Everything here was **executed and verified** on the
reference host — it is the "how do I actually run CQL" layer that the SKILL router points at.
All paths below use the verified values; substitute `$CCRUN` etc. on another host.

References are file path + stable symbol names — never line numbers.

## 1. Verified environment (reference host)

| Item | Value | How to confirm |
|---|---|---|
| host | `fbch34` | `hostname` |
| `$CCRUN` | `/fbch` | installed Lisp lives in `$CCRUN/cql` |
| `$CCSYSDIR` | `/fbch/fbch/run` | `main()` does `chdir(ccsysdir())` |
| `$CCBINDIR` | `/fbch/bin` | the `cql` binary: `/fbch/bin/cql` |
| current user | `liudan` (uid 1031, gid `cis`) | `id` |
| cis escalation | `.dosu <cmd>` works **passwordless** | `.dosu true` |
| installed Lisp | 183 files in `/fbch/cql` | `ls /fbch/cql` |
| installed HL7 | `/fbch/cql/hl7/hl7common` + `/fbch/cql/hl7/config.laborder` + `starthl7*.scm` | `ls /fbch/cql/hl7` |
| logs | `/fbch/log/` (`hl7log*`, `archlog`, `.dosulog`, ...) | `ls /fbch/log` |

**Always re-verify with `echo $CCRUN $CCSYSDIR $CCBINDIR` before running anything** — these come
from `/etc/.profile` and differ per host.

## 2. The `cql` binary: flags that matter for automation

Parsed by `siod_process_cla()` (`cclib/cqlA/siodR.c`); `main()` is in `cql/siodptx/siod.c`.

| flag | Meaning | Automation note |
|---|---|---|
| `-b` | batch: `mesgLevel=MBATCH` **and** `exitOnError=1` | always use for tests |
| `-e` | exit at EOF | pair with `-b` for piped input |
| `-i<file>` | load `<file>` as the init script | the way to run a report/test file |
| `-n` | `disable_storage=1` → **blocks all DB writes** | use it for every read-only test |
| `-m` | `disable_storage=2` (stronger) | rarely needed |
| `-S` | CQL super user | only for write tooling; never in tests |
| `-h<n>` | heap size in cells (e.g. `-h1100000` in `scripts/showbed`) | needed for big scans |
| `-d` / `-r` | debug / regular message level | use `-d` when a failure is silent |

**Exit code semantics (verified):** success → `0`; unbound variable, bad arg, parse error → `1`.
A runner can therefore assert on exit status alone, and additionally on stdout substrings.

**`-n` write protection is real:** `(db-start-write dbtd)` under `-n` fails with
`CheckArg4StartWrite: permission to store data denied.` → read-only tests are safe by construction.

## 3. `load-path` and the canonical batch prelude

`load-path` is `(<cwd at process launch> <$CCRUN>/cql)` — verified by printing `load-path`.
So a bare `(load "init.scm")` resolves to `$CCRUN/cql/init.scm` from anywhere, but **files that
install elsewhere do not resolve bare** (see traps below).

`cql/lisp/init.scm` sets `sitename` and loads `siod.scm` + `dbutil.scm`. It is **not** reliably
pre-loaded, so every batch script must start with it:

```scheme
(load "init.scm")     ; sitename + siod.scm (list/string helpers) + dbutil.scm (patient/dbi accessors)
```

Newline-free one-liner form used by the repo's own scripts (`cql/scripts/cqllog`, `cqldump`):

```sh
echo '(begin (load "init.scm") <body> "Bye.")' | $CCBINDIR/cql -b -n
```

## 4. Verified end-to-end recipe (copy this shape)

Run **as cis** whenever patient DBs are touched:

```sh
.dosu /fbch/bin/cql -b -n <<'EOF'
(load "init.scm")
(set! p (patient-by-mrn "DDog"))
(printf "id=%S mrn=%S name=%S unit=%S bed=%S\n"
        (pat-id p) (pat-mrn p) (pat-name p) (pat-unit p) (pat-bed p))
(set! dbtd (db-open (make-dbname p)))
(set! dbh  (db-def dbtd 0 never (list t nil) (list (name-to-it "Patient Last Name"))))
(set! d    (db-step dbh))
(printf "key=%S data=%S\n" (get-key d) (get-data d))
(db-undef dbh) (db-close dbtd)
EOF
```

Verified output (host `fbch34`, patient `DDog`):

```
id=1645486329 mrn="DDog" name="DDog, DDog DDog" unit="6CENTER" bed="6236"
key=1557197545 data="DDog"
```

Other verified facts:

- `never` = `2147483647`.
- `db-open` accepts a dbpath (`"vol9/p1645486329"`) **or** `(make-dbname p)` →
  `/fbch/fbch/run/vol9/p1645486329`.
- A `dbi` printed raw is `(9605 0 1557197545 "DDog" 0 30 44)` = `(major-it minor-it key data ...)`.
- `name-to-it` examples: `"Eyes Open To"` → `646`, `"Patient Last Name"` → `9605`,
  `"BedName.adm"` → `3591`, `"UnitName.adm"` → `3590`; `"NAME"` / `"patid"` → `nil`
  (bad IT name is the #1 cause of `db-def: IT not a number`).
- Patient record is a plain list whose first six slots are `(pat-id dbpath mrn name unit bed)`;
  trailing slots vary with shm/permission. Use the `pat-*` accessors from `dbutil.scm`,
  never positional `nth` on the tail.
- Enumerating patients: `(set! p (patient-next))` then loop `(patient-next)`; there are dozens of
  test patients on this host (`DDog`, `goodtest`, `gynttt`, `wj01`, `Uctest`, `skytest`, ...).

## 5. Permission model

| Need | How |
|---|---|
| Pure Lisp / arithmetic / string | any user, no flags beyond `-b -n` |
| Read patient DB (`db-open`, `patient-by-*`, `all-report-by-obs-time`) | **must be cis** — otherwise `patadt_read_latest: Ndbopen(...) [Permission denied(13)]` |
| `.dosu` scripts (`scripts/cqllog`, `cqldump-epd`, `webcql`, `UNA_LOGIN`) | `util/misc/.dosu` = `sudo -H -u cis "$0" "$@"`, appends to `$CCRUN/log/.dosulog` |
| `scripts/cqldump`, `setup_cql_hl7`, `GdrCqlInterface.sh` | script-level `whoami` check → must already **be** cis (`.dosu <script>`) |
| Write to `$CCRUN` (make install) | cis / sudo |

Minimal escalation for AI runs: prefix with `.dosu`. Do **not** use `-S`.

### 5a. Sandbox / replica observation (verified 2026-09-22 on `ccifbch34`)

A read-only replica of this host (root fs mounted `ro,nosuid`) cannot run the `db` group at all —
and the reason is deeper than "no `.dosu`":

- `/usr/bin/sudo` there has **no setuid bit** and is not uid-0-owned (`---s--x--x`, owner
  `nobody`), so `sudo` (hence `.dosu` = `sudo -H -u cis`) refuses to start. `ro,nosuid` also
  disables any setuid that a copy might carry.
- As a `cis`-group user, **index-level reads still work** (`patient-by-mrn`, `patient-by-unit-bed`,
  `name-to-it`): the per-patient dirs/files are group-readable (`drwxr-x---` / `-rw-r-----`
  `nobody:cis`).
- **Per-patient `db-open` still fails** (`could not open database` /
  `Ndbopen(vol9/pNNN) [Permission denied(13)]`) — the ccidb layer opens files with write/lock
  mode, which the `ro` root mount (and the group's missing write bit) denies. So even a working
  cis escalation would be blocked on such a replica.

Consequence for the harness on a `ro,nosuid` replica: `preflight.sh` passes with a
`perm:cis-escalation` WARN, and `check.sh` `SKIP(env)`-es exactly the 7 `AS: cis` db cases — the
documented, unmasked outcome. A full `db` run (and the `-n` write-denial assertion in
`db-nowrite-01`, which needs a successful `db-open` first) requires the reference host's writable
environment (`profile.json` → `env.verifiedReferenceHost`).

## 6. Build & install (make + SCRTn)

Every Makefile starts with `CCMAKEINCDIR := $(shell getsrcroot)/Make` + `include make_inc.mk`
and ends with `include make_rules.mk`. `Make/getsrcroot` prints the innermost path containing
`ccsrc`. The `SCRTn` mechanism (`Make/make_scrt_all.mk` → `Make/make_scrt.mk`) re-includes one
rule template per `SCRTn`, so:

- `SCRTn := foo.scm` → built into `$(RESDIR)/foo.scm` (RESDIR = `LINUX_<kernel>`, e.g. `LINUX_5_1_x86_64`)
  with a CCI version stamp prefixed, then installed as `$(SCRTn).TRGT` into `$(SCRTn).INSTALLDIR`.
- Defaults: `.TRGT` ← source name; `.INSTALLDIR` ← global `INSTALLDIR`; `.TYPE` ← global `SCRTTYPE`
  (`SCM` ⇒ `;`-comment stamp, mode `0640`; `SH` ⇒ `#`, mode `0750`).
- `.INSTALLDIR` may list **several** dirs (e.g. `cql/scripts/Makefile` installs `cqlmenu/CQL`
  to both `$(CCBINDIR)/adminutil` and `$(CCBINDIR)`).
- A host gate wraps the rules: if `HOST` ∉ `SYSLIST`, make prints `Not compiling $@ on host $(HOST)`.
  This is why `cql/siodptx` (`SYSLIST := $(PTX)`, `PTX` undefined on Linux) is dormant — build the
  binary on the platform that defines it, and treat the Lisp install as the day-to-day path.

Verified: `make -n` in `cql/lisp` expands cleanly on this host (dry run only; it writes nothing).

Commands:

```sh
make -C cql/lisp            # core .scm  -> $(CCRUN)/cql
make -C cql/lisp/hl7        # HL7 engine -> $(CCRUN)/cql/hl7/hl7common
make -C cql/scripts         # entry scripts -> $(CCBINDIR) / $(CCBINDIR)/adminutil / $(CCRUN)/cql/safebin
make -C cql/gdb             # GDB apps -> $(CCRUN)/cql and $(CCRUN)/gdbcql
make -C cql/archive         # archive tools -> $(CCRUN)/cql
.dosu cql/lisp/setup_cql_hl7 -t <site> [-m <module>|all] [-f] [-p]
```

Install destinations that surprise people:

- `cql/lisp/util.scm` and `cql/lisp/adtutil.scm` install to **`$(CCRUN)/cql/hl7`**, not `$(CCRUN)/cql`
  (explicit `.INSTALLDIR` on their `SCRTn` entries).
- `cql/lisp/menu.scm`, `diet-config.scm`, `exitcare.scm` install with `.TRGT := <name>.template`
  (a site-local template is expected to overwrite them).
- `cql/lisp/GCS.scm` is **not in any SCRT list** → never installed; load it from the source tree
  by absolute path if you need `Glasgow-Coma-Score` / `compute-score`.

## 7. HL7 runtime on this host

`/fbch/cql/hl7` already contains the shared engine and the installed site modules
(`config.laborder`) plus one `starthl7*.scm` per module. A `starthl7*.scm` is tiny:

```scheme
(define hl7-dir-path "/hl7/hl7common")
(define hl7-config-path "/hl7/config")
(define HL7BASEDIR (getenv "CCRUN"))
(load (strcat HL7BASEDIR "/cql/hl7/hl7common/hl7.scm"))
```

`hl7.scm` ends with `(hl7-startup)` `(hl7-main)` `(hl7-cleanup)` — i.e. **loading it starts an
interactive read loop** (`hl7-main` recurses on `(read)`). For automation, load the engine parts
and call `hl7-process` directly instead of loading `starthl7*.scm` wholesale; see
[automated-testing.md](automated-testing.md) §5. Engine internals: `hl7-process`, `find-trigger`,
`do-trigger`, `hl7-ack` / `hl7-ack-error`, `hl7-check`, the `process-t` / `process-d` MSH-11 gate
(see [hl7-site-config.md](hl7-site-config.md) for the site-config anatomy).

Logs: `$CCRUN/log/hl7log` (per module: `hl7log.<module>`), or `/dev/null` when `hl7-testing` is
defined — `hl7.scm`'s `log` echoes to stdout when `hl7-testing` is bound, which is the cheapest way
to see engine output in a test.

## 8. Command inventory (verified / classified)

Safe for non-interactive automation (no `read`, no X11, no tty):

| Command | Shape |
|---|---|
| `cql` | `echo '<sexp>' \| $CCBINDIR/cql -b -n` (`-i<file>` for a script) |
| `cqllog` / `cqllog2` | `cqllog '<dbpath>\|<patid> [IT...]'` → `all-report-by-obs-time` via `.dosu` |
| `cqllog3` | `cqllog3 <dbpath> <IT> <minorIT> <key>` (exactly 4 args) |
| `cqldump` | `cqldump '<dbpath>\|<patid> [IT...]'` → `asciify-patient`; **cis only** |
| `cqllog-epd` / `cqllog2-epd` / `cqldump-epd` | EPD variants via `epdpat-by-dbpath` |
| `showbed` / `showunit` | `showbed [-t] [-w N] [-m N] [-i N] [-p N] unit bed` (hard-codes `cql` from PATH) |
| `enscript` | always pass `-o` (stdout); without it the job really prints |
| `less` / `more` | `LESSSECURE=1` wrappers |

Human / privileged / interactive only — never in an automated loop:

`webcql` (reads CIS user+password), `UNA_LOGIN` (console tty + archive password; its non-tty branch
does `exec sh -c "$*"`, so **never invoke it with arguments**), `cqlmenu/CQL`
(`cql -i$CCRUN/cql/menu.scm -e -n` interactive menu), `linkmrn` (multi-round `read` + `dbwrite -R`
rewrites MRN/UPI), `writeseveritydata` (multi-round `read`, `-S`, and its `-iptseveritydata.scm`
does not exist in the tree), `edit` / `xcalc` (X11), `shell` (`rlogin`), `rmadminutil`
(in-place rewrite of every `ccsys.rcf`), `Merge/ShrinkReceivedUnits` (rewrite
`$CCSYSDIR/RECEIVED_UNITS`).
