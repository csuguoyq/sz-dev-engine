# Template: HL7-layer repro driver checklist + case-set pattern

Generic staging checklist for engine-level HL7 drivers (`cql -b -n` style,
Scripts-layer SZs) and the standard case-set shape for Phase 3. Symptom-level
only — no SZ numbers; fill the specifics from the current run's ticket and
baseline tree.

## Driver staging checklist (walk it BEFORE the first run — each item here is a
## failure mode that has cost a full debugging round in a past run)

1. **Config root defined before any site script loads.** Drivers that
   `(load ...)` a site-config script need the same globals the real loader
   (starthl7 framework) provides — typically `hl7-config-dir` (and
   `HL7BASEDIR` as env, via the `cql-run` discipline). A missing define is
   the #1 first-run failure.
2. **Handler prologue globals.** The handler may read switches/guards the
   framework normally binds before the trigger fires (e.g. an
   `is-orma?`-style message-class flag). Grep the handler chain for the
   globals it reads and define each with the guarded-define idiom in the
   driver, or the chain dies on a symbol unrelated to the defect.
3. **Message literal quoting.** The raw HL7 message goes into the driver as
   ONE quoted string (escape internal quotes); a bare S-expression-looking
   message is the #2 first-run failure.
4. **Load the CURRENT tree's file, not the installed copy.** The driver must
   `(load ...)` the script from the working tree path so red/green reflects
   the run's edits (same rule in acceptance: tested code == reviewed code).
5. **Engine discipline**: always through the `cql-run` wrapper (CCRUN root,
   `-b -n`, stdin discipline, timeout + output cap); scratch dirs for any
   write path; teardown verified.
6. **Deterministic fixture prints.** Print the load-bearing fields (parsed
   segment values, flag states) BEFORE the assertion output, so a green run
   proves the fixture actually exercised the intended path — a green run on
   an accidentally emptied message is a false pass.
7. **Red/green pairing.** Keep the defect-only driver and the control driver
   (single message, no boundary crossing) side by side: the control must be
   byte-identical pre/post fix; the discriminator flips red→green.

## Case-set pattern for HL7-layer SZs (Phase 3; author once as the TC wiki)

- **TC-01 red-green discriminator** — the ticket's own scenario (verbatim
  input from the ticket, quote-wrapped), asserted on the exact pre-fix
  wrong / post-fix right observable.
- **TC-02 solo control** — the failing message type alone, pre-fix green;
  post-fix must stay byte-identical (no collateral behavior change).
- **TC-03 regression on the affected family** — the legitimate case the
  defect's code path exists for (e.g. the real flag-setting message still
  sets everything it set before).
- **TC-04 same-family consumers** — every symbol the changed code writes or
  clears has its other readers exercised once (prior-art SZs name them;
  `git log --grep` on the file finds the family).
- **TC-05 site-gate case** — the config switch(es) guarding the path, off
  and on, if any; off = documented pre-existing behavior.
- **TC-06 static gates** — the pack's lint/selftest commands, captured.
- **Manual track** — cases needing a live daemon + DB + UI have no
  read-only path: render a precise human script, never execute; label NOT
  EXECUTED in the wiki and TC deliverable.
