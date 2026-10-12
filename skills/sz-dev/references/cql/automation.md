# CQL review checklist + test-safety facts (the `review-checklist` capability)

> Consumer: sz-dev Phase 2.5 (independent review) and Phase 3 (case design).
> Design/historical rationale lives in git history; this file keeps only what
> a reviewer or case author must act on. References cite file path + symbol
> name only — no line numbers.

## Safety red lines (every case, every driver)

- **Every write-path case backs up and restores the patient ccidb**;
  the runner enforces it, and a teardown failure alarms instead of
  staying silent. Restore (and any engine-owned file manipulation) goes
  through `.dosu` — see `architecture-cache.md` for the ownership model.
- **Read-only first**: anything not needing a DB write runs under `-n`.
- **Binary isolation**: the build under test installs to a
  version-suffixed binary; the production `cql` is never touched.
- **Staged environments mirror the production load chain** — see
  `architecture-cache.md` ("Code-architecture facts") and routing.md's
  site-config section; a fixture that loads half the chain produces
  silently-nil assertions.
- **Engine calls only through `tools/cql-run`** (caps + stdin
  discipline are structural there); the trap inventory is in
  `repro.md` "Driver-runtime traps".

## Review checklist (beyond static gates)

- **find-pat that can return nil**: every handler that resolves a
  patient record via a find-pat function must have its trigger's
  not-found branch checked for a graceful no-store (reject/ACK, no
  write, no crash). Review the trigger's cond/let bindings, not just
  the find-pat body.
- **Rejection message content**: when a reject/ACK message embeds a
  lookup value (MRN, patid, order id), verify the value is non-null at
  that branch — a nil in the reject text is a silent defect the ACK
  text check will not catch.
- **Minimal change (message-table keys)**: before adding a new
  message-lookup key, check BOTH the site's `msg-lookup-table` AND
  `note-msg-lookup-table` in the site's `msgdata.cf` for an existing
  key mapping the same segment/field; verify the key the handler's
  `get-msg-value` call chain actually reads — key names mislead in
  both directions.
- **Install-path review for Makefile/SCRT co-changes**: `SCRTn`
  sequence continues sibling numbering; `make_scrt.mk`'s
  `install.$(SCRT)` is FORCE-rebuilt after the Makefile's `all::` RM;
  `SCM`-type targets install 0640, default-type 0750; `INSTALLDIR`
  adjacency to sibling SCRT triplets; referenced daemon/app templates
  must exist; a new `runList.cf` entry additionally needs a
  `trigger.apps` entry in `$CCSYSDIR/trigger.rcf` (`START_HOPD` exits
  6 on a missing app — record the verify grep in the CN).
- **Reachability of handler reject branches**: prove a branch is
  reachable through the real dispatch before a case asserts its ACK
  text (nil checks after other calls, required segments rejected by
  `hl7-check` first); unreachable branches get baseline-equivalence
  assertions instead and never count as covered.
- **Engine `strcmp` returns boolean truth** (`t`/`nil`), not a C int —
  `(= (strcmp x y) 0)` silently never matches; equality uses the
  truthy form `(if (strcmp x y) ...)`. Check new string comparisons
  for the wrong idiom (every not-equal case "passes" via the default).
- **Engine exits 0 even after message-processing errors** (the
  `cqlError>` prompt swallows them) — cases assert on the message-in
  grep and the parsed MSA ack (or captured output file), never on the
  exit code alone.
- **Fixture MRN selection vs `format-pid`**: 9/10-digit PID-19 values
  are rewritten to dashed SSN form while `patients-by-mrn` matches
  exactly — fixture MRNs must survive formatting; the skip/unknown
  acks echo the resolved value and are the self-diagnosing tool.
- **Replay exclusions** (`workflows/replay-mode.md`): in a replay run
  NO phase, step, or sub-agent — reviewer included — may read this
  SZ's landed fix commit or the code pasted on its ticket. The
  reviewer judges only the four acceptance criteria; there is no
  comparison against the historical fix.
- **Driver-data provenance**: for any hand-built parsed-message
  driver, verify the input data against the ticket/attachment cache —
  verbatim transplant or an explicit code-var -> index ->
  ticket-element mapping table (`driver data:` line in
  `phase1-requirement.md`). Normalize quote notation (`'(...)`) vs the
  attachment's explicit outer paren before byte-comparing. A
  self-consistent driver validates its own premises; this check is
  the only in-flow defense against invented requirements.
