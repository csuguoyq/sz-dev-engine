# CQL module pack (sz-dev `references/cql/`)

Capabilities map for the CQL module. The sz-dev framework queries this pack
at fixed points (see `../../contracts.md`); each capability answers one
framework question. Consumers: load the file listed here when the framework
asks the corresponding question — do not read the whole pack at once.

## Capabilities

| Capability (framework question) | Phase | File(s) |
|---|---|---|
| **check** — is this change OK so far? (fast inner loop) | 2, per step | `tools/cql_lint.py` (5 static gates: cql.hlp sync, disable_storage, Makefile SCRTn, load path, template install) + `cql/test/check.sh` sensor suite (read-only, verified) |
| **repro** — can the defect be produced and removed? | 1 (bug SZs) | `repro.md` (3 levels, verified engine-level recipe) + `tools/state-leak-two-message-repro.scm` (worked two-message driver) + `templates/hl7-driver-checklist.md` (generic staging checklist — walk it BEFORE the first driver run; it exists because first-run failures on config roots, prologue globals and message quoting cost a debugging round each in past runs) |
| **routing** — which layer did this SZ touch and what follows? | 1 | `routing.md` (Scripts / Lib / GDB / interpreter) |
| **build** — does it compile/install into a versioned dir? | 2 end | manual track (install → gitrelink → version, then per-directory make; provenance recorded in `phase4-handoff.md`) |
| **accept** — full acceptance + regression testing | 3 | `testcase-schema.yaml` (declarative case format, five-stage: backup → inject → assert → restore → verify-clean) + `cql/test/acceptance/README.md` (runner: command, `--dry-run`/`--smoke` rehearsal order, exit codes 0/1/2/3 — exit 3 = teardown failure is the **stop-on-unsafe signal**: stop everything, never consume a fix round; exit 2 gates are never bypassed) + per-SZ regression cases (delivered with the SZ as a tarball, not stored in-repo); engine-level case sets follow the case-set pattern in `templates/hl7-driver-checklist.md` (discriminator / solo control / family regression / site-gate / manual-track) |
| **deliverables** — generate TC/RN/IN/CN drafts | 4 | `cql/test/acceptance/gen_docs.py` (reverse-generates from case YAML — full-pipeline five-stage cases only). Engine-level driver case sets (read-only `cql -b -n` drivers) have no YAML shape: fall back to `sz-gen-deliverable` skeletons filled from `phase3-test-report.md` |
| **review-checklist** — what does a reviewer check beyond lint? | 2.5 | `automation.md` red lines + historic bug classes: stale globals between messages, boundary values, co-change files (`trigger.cf` / `segment.cf` / `msgdata.cf` / Makefile), cross-layer C++ callers when `cclib/cqlA` changes |

Prior art is a framework-level step (Phase 1: local git log + softzilla
MCP quicksearch), not one of the seven capabilities above. This pack
contributes sz-history.md as an extra prior-art source — grep it for
symptom / FRD family / SZ id, never read whole.

Host-, environment- and toolchain-level facts (test host, CCRUN root,
install commands, engine load order, harness output behavior) live in
`architecture-cache.md` — consult it BEFORE re-deriving any such fact
(routing, repro, build verify, accept) and write validated facts back
there, never into chat (`contracts.md` rule 8).

## Code templates (`templates/`)

- `hl7-inbound-handler.scm` — HL7 inbound handlers (most Scripts-layer SZs)
- `query-report.scm` — query/report scripts (data-access five-step, modeled on
  `cql/lisp/dumpdb.scm`)
- `c-primitive-trio.md` — new C primitive: implementation + `cci.c` registration
  + `cql.hlp` entry, one diff

## Red lines (never cross; violation = rework)

- `gdb*` means global database, never a debugger; GDB layer is read-only.
- A write primitive without the `disable_storage` check (see
  `cclib/cqlA/cciadt.c`) breaks `-n` read-only mode — do not merge.
- Tests never write production DB paths, never overwrite the production `cql`
  binary, never leave unrestored patient data.
- Docs reference code by file path + symbol name only — no line numbers.

## Related assets outside this pack

- `cql/test/` — the CQL test tree: read-only sensor harness at the root
  (`preflight.sh` + `check.sh`, check capability) and the write-path
  acceptance runner under `cql/test/acceptance/` (accept/deliverables
  capabilities). Never mix the two entries: sensors are read-only,
  acceptance cases write DBs under backup/teardown gates.
- SZ ticket reads go through the **softzilla MCP** (`bug_info`,
  `bug_comments`, `bugs_quicksearch`); `add_comment` is forbidden (SZ is
  read-only).
