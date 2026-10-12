# CQL architecture + test-host cache (validated inventory)

> **Lifecycle**: inventories are expensive; facts are cheap to re-verify.
> This cache is refreshed by a run that actually re-derived or validated
> the facts (write `cache-date` / `valid-until` below, see contracts.md
> rule 8). Within the validity window, Phase 1 routing/code review and
> Phase 3 case design consult it FIRST as starting hints. Two hard
> limits: (a) it is a map, not ground truth — every load-bearing fact
> used in an assertion or a review verdict is still verified against
> the tree/host; (b) in a replay run it is an ordinary pack file — the
> Delta 2 grep applies, and the symptom-level convention below keeps it
> in-bounds. A run that contradicts a cached fact corrects it on the
> spot (that IS a refresh) and notes what changed.

cache-date: 2026-09-27
valid-until: 2026-10-07
refreshed-by: multi-SZ validation campaign (6 replay runs, all facts
executed against the live host within this window)

## Test-host environment (designated CQL test host)

- Host: `ccifbch34` (hostname; RHEL 9 family). The acceptance runner's
  `target:` field uses the short name.
- Runtime root: `/fbch` = `$CCRUN`. Engine binary verified at
  `$CCRUN/bin/cql` (2026-09-27). `$CCSYSDIR` sits beside it; patient
  DB dirs `vol*/p<pid>` under `$CCSYSDIR`.
- Ownership: `$CCSYSDIR` runtime tree and `/ccidata` are `cis:cis 750` —
  dev users (cis group) have read only. ALL DB-touching and restore
  operations go through `.dosu` (= `sudo -u cis`, NOPASSWD). An
  as-invoker backup succeeds; an as-invoker restore partial-fails (rc=23).
- Staged run trees (`/tmp/<sz>-run/...`) must be cis-writable (a+rwX):
  the engine opens `HL7LOGFILE` under the staging logs dir at startup,
  and a read-only staging tree fails the open then errors at cleanup.
- Engine boot data: a staged `CCRUN` with an EMPTY workdir/shm/dbshm file
  segfaults (exit 139); with the file absent it loops
  `load_dbshm_file(): Failed to open` without processing input. Full-flow
  runs therefore split the roots: `CCRUN=/fbch` for engine data,
  `HL7BASEDIR`/`hl7-config-dir` pointing at the staged script copy.
- Engine invocation discipline: `timeout` + `ulimit -f` wrap EVERY call
  (error-prompt spin and stdin BEL loops fill /tmp at GB scale — see
  repro.md driver-runtime traps); env vars are exported explicitly on
  the command line (ambient shell env is not reliably visible to the
  engine from agent shells).

## Code-architecture facts (validated; details live in the pack topic files)

- Site load chain: `cql/lisp/hl7/hl7common/hl7.scm` loads
  `hl7formatutil.scm` + `hl7format.scm`; the latter resolves through the
  load path to the SITE's own copy (every
  `cql/lisp/hl7.<site>/config.<module>/` carries one). Loading
  `msgdata.cf` alone silently nils every `format-*` field. → routing.md
  "Site config — load chain, staging".
- Site-config install: `setup_cql_hl7 -t <site> -m <module> [-f]` run
  from the dir holding BOTH `hl7/` and `hl7.<site>/` (the source tree's
  `cql/lisp/`), then `RESTART_HL7`; `config.*` subtrees carry no
  Makefile. → routing.md site-config row.
- Load-path `cons` order is last-first: cons the GENERIC dir before the
  SITE dir, or the site's tables are silently shadowed. → repro.md traps.
- Engine idioms: `strcmp` returns boolean truth (never `(= (strcmp x y)
  0)`); the engine exits 0 even after message-processing errors
  (`cqlError>` prompt) — assert on msg-in/MSA, never exit code alone;
  `map`/`display`/`write` unbound in plain batch; `print` takes one arg.
  → automation.md "install paths, reachability, engine idioms".
- Handler reject-branch reachability must be proven through the real
  dispatch before a case asserts a branch's ACK text (nil checks after
  other calls, required segments per `segment.cf` reject first).
  → automation.md reachability bullet.
- Fixture MRN selection: site `format-pid` rewrites 9/10-digit values to
  dashed SSN form while `patients-by-mrn` matches exactly — fixture MRNs
  must survive formatting. → automation.md format-pid bullet.
- Runner case shape (backup-only setup; single restore-compound with
  verify-clean folded in; send-last compound; `.dosu` restore; teardown
  reversed YAML order): → `cql/test/acceptance/README.md` teardown
  semantics.

## Known gaps (re-derive on contact; candidates for pack work)

- Multi-record-under-one-MRN test data does not exist on this host —
  "latest record by MRN" behaviors cannot be exercised here.
- Live daemon control (`RESTART_HL7` / `RESTART_HL7MSGSEND`) is a
  production red line — never executed by the AI; IN-verification
  territory for the human.
- The out-of-repo interface layer (MLIP middleware) reads `trigger.cf`
  syntax lists; its acceptance of config changes is field-validation
  territory, unverifiable from this repo.

## HL7 inbound Scripts: per-message classification state (validated 2026-09-28)

- Inbound order interfaces keep per-message classification in
  module-level flag globals set inside the classification entry (e.g.
  the txorders `get-order-type` setting a tubefeeding flag) and never
  reset them — the leak survives until the engine session ends, so
  every later message in the same batch inherits the earlier label
  (reproducible engine-level with the two-message driver; see
  `repro.md` "Two-message pattern"). The reset belongs INSIDE the
  classification entry function, not the daemon handler prologue: the
  entry is the first per-message call on every path, so a reset there
  is covered by Level-2 drivers and any alternate caller, while a
  prologue reset is invisible to them. Flags derived from the same
  state (a flag set downstream from the primary flag, gating INP/TRT
  storage branches) must be reset together — resetting only the
  primary leaves the derived one leaking into storage routing.

## HL7 inbound Scripts: composite field resolution (validated 2026-09-28)

- HL7 inbound handlers that resolve a possibly-composite field to a
  display/data string must use `field-to-string`
  (cql/lisp/hl7/hl7common/hl7msg.scm: delimiter table rep `~` / com `^` /
  sub `&`, recursive combine, nil -> ""). Ad-hoc fallbacks
  (`list-to-string (cdr f) "&"`, manual `(nth 1 f)`) crash or mangle on
  the com shape (embedded empty component lists) — engine error
  `wta to lstrcat` is the signature. Symptom class seen twice before via
  SZ18440 (rep) and SZ21178 (sub) before the general fix.
- Availability fact: BCMA inbound (`cql/lisp/hl7.dss/config.bcma/
  hl7bcma.scm`) can call `field-to-string` without new loads — its load
  chain (`trigger.cf` RAS/O17 -> hl7.scm -> hl7msg.scm) binds it before
  message dispatch; hl7oru.scm in the same chain already calls it.
- Standalone driver note (read-only repro pattern): loading a config
  .scm wholesale in a `-b -n -e` driver fails on live-context globals
  (e.g. hl7adt.scm needs hl7-adt-id); extract the target function
  verbatim from the file and load util.scm + hl7msg.scm instead.
