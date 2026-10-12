# CQL architecture cache

Host-, environment- and toolchain-level facts validated by sz-dev runs.
Consult BEFORE re-deriving them (routing, repro, build verify, accept);
correct contradicted facts on the spot and bump `cache-date` /
`valid-until` (contracts.md rule 8). Symptom-level only: no SZ numbers,
no SZ-specific code mechanisms — those are re-derived from the tree.

```text
cache-date:  2026-09-30
valid-until: 2026-12-31
```

## Designated test host and engine

- Designated CQL test host: `ccifbch34`; shared runtime root `/fbch`
  (`CCRUN=/fbch`). Engine invocations go ONLY through
  `bash "$SKILL_DIR/tools/cql-run" --env CCRUN=/fbch -- -b -n ...`
  (batch, no line editor; `-e` evaluates; `-i` cannot load files
  outside `$CCRUN`).
- A wrong/absent `CCRUN` value does not fail fast — the engine hangs
  until the cql-run timeout. Set `--env CCRUN=/fbch` on the FIRST
  engine call, never discover it by timeout.

## Install / build (Scripts layer, site config)

- Site-config scripts install with
  `setup_cql_hl7 -t <site> -m <module> [-f]`; it must run as user
  `cis` (`.dosu cis`). It copies the config script into the runtime
  config dir and regenerates the site's `starthl7.*.scm`; verify with
  a byte-compare of the installed copy against the source. Redirect
  the destination when the shared runtime must stay untouched.
- `RESTART_HL7` bounces the shared HL7 listener on the test host —
  production-facing red line; execute only through the pack's accept
  safety gates, otherwise leave it to the IN / human track.

## Engine load order (inbound HL7)

- The inbound dispatcher loads `hl7common/hl7msg.scm` (field helpers,
  e.g. `field-to-string`) BEFORE `trigger.cf` / `hl7-main`, so helper
  functions are bound inside any site config script at load time;
  site scripts under `cql/lisp/hl7.<site>/config.<site>/` are loaded
  per configured site/module.
- `field-to-string` passes plain strings through unchanged, renders
  composites with `^` and repeats with `~`, and maps nil to `""` —
  a `string?` guard around it is redundant but harmless.

## Check harness (`cql/test/`)

- Sensors: `cql/test/check.sh` (suites: pure / db / menu / hl7),
  `preflight.sh` for environment; reports land in
  `<repo>/test-reports/` — run artifacts, NEVER change surface: copy
  them under `.sz-dev/SZxxxx/evidence/` and keep them out of the git
  index (older baselines have no `.gitignore` entry for the
  directory; `sz-replay diff` excludes the name, but do not stage it).
- `cql/test/` is injected into replay trees via
  `SZ_REPLAY_HARNESS_SRC` (current-harness source) — see
  `workflows/replay-mode.md`.
