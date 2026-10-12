# HL7 Site Configuration Reference

Deep companion to the CQL skill ([../SKILL.md](../SKILL.md)). Covers the HL7 engine
flow and the per-site config file anatomy — read this before adding or modifying a
site, module, trigger, or field mapping under `cql/lisp/hl7/` and `cql/lisp/hl7.<site>/`.

All paths are relative to the `ccsrc` repository root. References are file path +
stable symbol names — never line numbers.

## 1. Layout

```
cql/lisp/
├── hl7/
│   ├── Makefile               # explicit SCRTn list of shared engine files -> $(CCRUN)/cql/hl7
│   └── hl7common/             # SHARED engine (installed once to $CCRUN/cql/hl7/hl7common)
├── hl7.<site>/                # one dir per customer site (~78; 64 with a plain config/ module)
│   ├── config/                # the site's DEFAULT module (absent in named-module-only sites, e.g. hl7.dss)
│   ├── config.<module>/       # additional modules (lab, pharm, dsspharm, txorders, vista, adt, simulator, ...)
│   └── hl7common/             # OPTIONAL site-local engine overrides (installed on top of shared hl7common)
└── hl7_template/              # message templates: radiology, pathology, pdf_report, base64_pdf, microbiology
```

Key shared-engine files in `cql/lisp/hl7/hl7common/` (each listed explicitly as a
`SCRTn` in `cql/lisp/hl7/Makefile` — a new file is NOT installed without a new entry):

| File | Role (stable symbols) |
|---|---|
| `hl7.scm` | engine entry: loads the engine chain, defines `hl7-process`, `find-trigger`, `do-trigger`, `hl7-nil`, `hl7-noop` |
| `hl7msg.scm` | MSH accessors: `msh-message-type`, `msh-trigger-event`, `msh-control-id`, `msh-processing-id`, `msh-sending-application`, ... |
| `check.scm` | `hl7-check` — message structure validation against the trigger segment spec |
| `ack.scm` | acks: `hl7-ack` / `hl7-ack-error` / `hl7-ack-reject`, `%hl7-create-ack`; `hl7-version-id` (2.1), `silent_ack` |
| `config.scm` / `types.scm` / `longtime.scm` | engine config, type helpers, long-time display |
| `hl7common.scm` | engine common code: `log`, `hl7-debug`, `get-pid`, ... |
| `hl7adt.scm` | ADT trigger handlers: `hl7-a01`, `hl7-a02`, `hl7-a03-2`, `hl7-a08`, `hl7-a08-m` |
| `hl7oru.scm` | ORU (observation results) processing: `hl7-oru` |
| `hl7mfn.scm` / `hl7mfnprovider.scm` / `hl7mfnien.scm` | MFN master-file updates |
| `hl7note.scm` / `hl7micro.scm` / `hl7pathology.scm` / `hl7vital.scm` / `hl7pdf.scm` | note / micro / pathology / vital / PDF message families |
| `hl7pharmverify.scm` / `hl7scv.scm` / `hl7hold.scm` / `hl7vxu.scm` | pharm-verify / SCV / hold / VXU families |
| `hl7formatutil.scm` / `hl7localutil.scm` / `hl7labutil.scm` | format + lookup helpers (`get-hl7-msg-data`, segment lookups) |
| `ConvtActivePats.scm` / `ConvtUnarchivePat.scm` / `ConvtDB2Supdf4Oru.scm` | data conversions |
| `hl7dsscommon.scm`, `hl7maclab.scm`, `hl7smhcc.scm`, `hl7svmcbdm.scm`, `hl7cfma.scm`, `hl7cftv.scm`, `hl7cfstat.scm`, `hl7welch.scm`, `hl7ochpharm.scm`, `hl7rde.scm`, `hl7rdepom.scm`, `hl7pcdmsg.scm`, `hl7mdm.scm`, `hl7path.scm` | family/site-specific handlers |

Site-local engine overrides live in `cql/lisp/hl7.<site>/hl7common/` (e.g. `hl7oru.scm`,
`hl7dsspharm.scm`, `hl7vitros.scm`, `hl7simulator.scm`) and are copied over the shared
`hl7common` by the installer.

## 2. Runtime flow

1. The installer generates `starthl7[.module].scm` in `$CCRUN/cql/hl7/`, which sets
   `hl7-dir-path` = `/hl7/hl7common`, `hl7-config-path` = `/hl7[.module config dir]`,
   `HL7BASEDIR` = `$CCRUN`, and loads `$CCRUN/cql/hl7/hl7common/hl7.scm`.
2. `hl7.scm` prepends both paths to `load-path` and loads, in order: `siod.scm`,
   `dbutil.scm`, `config.scm`, `ack.scm`, `check.scm`, `types.scm`, `hl7msg.scm`,
   `msgdata.cf`, `hl7common.scm`, `longtime.scm`, `hl7formatutil.scm`, `hl7format.scm`,
   `hl7hold.scm`, `hl7localutil.scm`, `hl7local.scm`, `hl7labutil.scm`.
   (The `.cf`/`.scm` config files resolve from the SITE config dir on `load-path`;
   the shared helpers resolve from `hl7common`.)
3. Each incoming message goes through `hl7-process`:
   - `hl7-check` validates the message structure (a pair result → `hl7-ack-error`).
   - `find-trigger` matches MSH-9 (message type) + MSH-10 (trigger event) against the
     `trigger.cf` table (`msgs`).
   - the **MSH-11 processing-id gate**: `"A"` processes normally; `"T"` acks
     `"NOT PROCESSED; TEST MODE"` unless the site defines `process-t` as `"t"`
     (`hl7-test-pids` can whitelist test pids); `"D"` acks `"NOT PROCESSED; DEBUG MODE"`
     unless `process-d` is `"t"`.
   - `do-trigger` loads the trigger's `loadfile` if the subr symbol is still unbound,
     then evaluates the handler with `(trigger msg)`.
4. Handlers extract data (via `msgdata.cf` lookups / format fns), store it with the
   db/adt built-ins (`adt-admit`, `db-newd`, `store-labresults`, ...), and reply with
   `hl7-ack` / `hl7-ack-error` / `hl7-ack-reject`.
5. Logging goes to `hl7-logfile` (defined in the site's `hl7local.scm`, typically
   `$CCRUN/log/hl7log`; per-module: `$CCRUN/log/hl7log.<module>`).

## 3. Config file anatomy (per site module dir)

Every site module dir (a `config/` or `config.<module>/`) contains a core set plus
domain tables:

| File | Purpose |
|---|---|
| `trigger.cf` | trigger table (below) |
| `msgdata.cf` | `msg-lookup-table`: data-retrieval map (below) |
| `segment.cf` | per-segment field extraction/format definitions |
| `adt.cf` | ADT definitions (admit data mapping) |
| `oru.cf` | ORU/OBX definitions (lab result mapping) |
| `note.cf` | note-template definitions |
| `oruadmit.cf` | ORU-at-admit mapping |
| `unitbed_map.cf` | site unit/bed mapping (very frequently edited; dated backups common) |
| `hl7format.scm` | format functions (`format-pid`, `format-name`, `format-doctor`, `format-dob`, ...) and translation tables (`table-race`, `table-marital-status`, `table-religion`, ...) |
| `hl7local.scm` | site behavior overrides (below) |
| `hl7simulator.scm` + `transform.cf` / `special-transform.cf` + `*-mapping.cf` | test/simulator module (see `hl7.carefusion/config.simulator/`) |

Domain mapping tables present in some modules (pharmacy/lab-heavy sites):
`carrier.cf`, `colloids.cf`, `ivdrugs.cf`, `diabeticmeds.cf`, `freqconvert.cf`,
`qfreqs.cf`, `rtmeds.cf`, `holds.cf`, `micro.cf`, `pathology.cf`,
`allerg_type_map.cf` / `allerg_name_map.cf`, `cql-staffids.cf`, `clinics.cf`,
`immunizations.cf`, `micro_result_interpretation.cf`, `lab_notification_flags_map.cf`,
`ORCaction.cf`, `Ordstatus.cf`, `tpn.cf`, `nodupbeds`.

### `trigger.cf` — trigger table

Each entry: `("TYPE" "TRIGGER" subr-symbol "loadfile.scm" (list <segment spec>))`

Example:

```scheme
("ADT" "A01" hl7-a01 "hl7adt.scm"
  (list "MSH" "EVN" "PID" [ { "NK1" } ] "PV1" [ { "IN1" } ] [ { "IN2" } ]))

("ORU" "R01" hl7-oru "hl7oru.scm"
  (list "MSH" "PID" "ORC" "OBR" { [ "NTE" ] } { [ "OBX" ] { [ "NTE" ] } }))
```

- segment spec: bare `"MSH"` = required; `[ X ]` = optional; `{ X }` = repeat group
  (optionals may nest inside repeats).
- The first entry `( nil nil hl7-nil nil (list "MSH"))` matches the HL7 sequence-number
  message and acks it.
- `hl7-nil` / `hl7-noop` are ack-only stubs used to disable/placeholder a trigger.
- The `subr-symbol` must be defined in the `loadfile` (or already loaded); the segment
  list drives `hl7-check` validation.

### `msgdata.cf` — data lookup table

`msg-lookup-table` entries:

```scheme
("tag" "SEGMENT" field component sub-component format-fn [translation-table])
```

Example: `("mrn" "PID" 4 1 () format-pid)` or
`("marital" "PID" 16 () () format-none table-marital-status)`.

Consumed by `get-hl7-msg-data` (see `hl7localutil.scm`): the handler asks for a tag,
the engine locates segment/field/component, applies the format fn, then any
translation table. Adding a new data item = add a tag row here (+ format fn / table in
`hl7format.scm` if needed).

### `hl7local.scm` — site behavior overrides

Standard symbols a site defines here (see `hl7.bach/config/hl7local.scm` as a sample):

- `hl7-logfile` — log path (or `/dev/null` when `hl7-testing` is defined)
- `get-patient id` — how to resolve a patient from the message (default
  `(patient-by-mrn id)`; sites may match by another identifier)
- `ignore-oru msg` / `ignore-obx-seg seg` — drop-message hooks
- `get-obx-id-field` / `get-obx-id-from-comp` / `get-obx-result-field` — OBX mapping
- `get-obr-source msg` — OBR source extraction
- `hl7-ack-AR-override` / `hl7-ack-AE-override` — force ack codes (e.g. `"AA"`)
- `hl7-admit-pat-exists trigger msg` — override A01 behavior when the patient exists
  (e.g. route to `hl7-a08`)
- `store-admit-labs`, `lab-use-seconds`, `mfn-redund-copy` — behavior flags
- `demotable-units` — units for demo-table handling
- `local-oru-result-map`, `local-oru-rad-check` — local result/rad routing
- `local-transformation-setmsg! msg` / `hl7-processing-id-setmsg! msg` — pre-processing
  message transformation hooks (invoked by `hl7-process`)
- `hl7-do-micro-append` — append vs replace for micro notes

## 4. Adding a new site

1. Clone the closest existing site:
   `cp -r cql/lisp/hl7.<similar> cql/lisp/hl7.<newsite>`
2. Rewrite the per-site content: `hl7local.scm` (log file, `get-patient`, OBX mapping,
   ack overrides), `unitbed_map.cf`, `msgdata.cf` (tag/field map), `segment.cf`,
   `adt.cf` / `oru.cf` / `note.cf`, translation tables + format fns in `hl7format.scm`,
   and `trigger.cf`.
3. Remove `config.<module>` dirs the new site does not need (or adapt them).
4. If handlers need site-local behavior, drop files into
   `cql/lisp/hl7.<newsite>/hl7common/`.
5. Install **as user `cis`**:
   `cql/lisp/setup_cql_hl7 -t <newsite> [-m module|all]`
   (options: `-s <srcdir>` (default `.`), `-d <destdir>` (default `$CCRUN/cql/hl7`),
   `-f` force replace, `-p` list available sites/modules, `-h` usage).
6. Verify in `$CCRUN/cql/hl7/`: `config*/` (or `config.<module>/`),
   `starthl7[.module].scm`, and `hl7common/` in place; runtime logging to
   `$CCRUN/log/hl7log*`.

## 5. Adding a trigger / message type to an existing site

1. Add an entry to the site's `trigger.cf` (segment spec + handler symbol + loadfile).
2. Define the handler in the loadfile — usually the family file in
   `cql/lisp/hl7/hl7common/` (e.g. a new ADT trigger handler next to `hl7-a01` in
   `hl7adt.scm`), or a site-local `.scm` under `hl7.<site>/hl7common/` or the module dir.
3. If the handler needs new message fields, extend `msgdata.cf` (new tag row) and/or
   `hl7format.scm` (format fn / translation table).
4. If you added a NEW shared engine file, add it to the `SCRTn` list in
   `cql/lisp/hl7/Makefile` (the list is explicit; otherwise it is not installed).
5. Reinstall the module with `setup_cql_hl7` (as `cis`) and check `$CCRUN/log/hl7log*`.

## 6. Notes

- HL7 version is **2.1** (`hl7-version-id` in `ack.scm`).
- **Most** sites are installed by `setup_cql_hl7`; a few carry their own site Makefile
  instead (e.g. `cql/lisp/hl7.scc/Makefile` — make + rsync of `config.laborder` and
  `starthl7.laborders.scm` into `$(CCRUN)/cql/hl7`, with `.OLD`-suffix backup on overwrite).
  Check the site dir for a `Makefile` before assuming the `setup_cql_hl7` path.
- A site without a plain `config/` (named-module-only, e.g. `hl7.dss`, `hl7.scc`,
  `hl7.carechek`) is installed with `setup_cql_hl7 -t <site> -m <module>` (or `all`) —
  there is no default module to install.
- "Not processing" is often the MSH-11 processing-id gate, not an error — check
  `process-t` / `process-d` in the site's `hl7local.scm` before debugging handlers.
- The shared engine is installed by `cql/lisp/hl7/Makefile`; site content is installed
  by `setup_cql_hl7` (or the site's own Makefile). Never edit installed files under
  `$CCRUN` — edit the source under `cql/lisp/` and reinstall.
- Site dirs accumulate dated scratch/backup files (`*.SDxxxxx`, `*.051404troys`,
  `*.test`, `*.work`, `*.before`, `*.tamc`); treat them as history (see SKILL.md Section 6).
