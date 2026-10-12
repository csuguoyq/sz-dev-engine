# Claim module reference

Optional map for Billing/Claim SZs. Open this pack only after
MCP-reading the SZ (category / sub-category / title / cited FRDs) —
not from the chat prompt. `frd-catalog.md` is **always** read when
this pack is selected, including bug-ticket light paths.

Not ground truth — the current FRD and the ccsrc repository win.

```text
claim/
├── README.md                 this file
├── domain-knowledge.md       INDEX — which domain/*.md to open
├── frd-catalog.md            FRD family → latest version / attachment
├── sz-history.md             Claim-path git changelog (grep, not read-all)
└── domain/
    ├── claim-lifecycle.md
    ├── remittance-835.md
    ├── guarantor.md
    ├── billing-ui-ar.md
    ├── misc.md
    ├── code-map.md           GREP
    └── gotchas.md            GREP
```

How to use (agent): read `domain-knowledge.md` first, then only the
files it points at. Check `frd-catalog.md` for the latest FRD in the
family before treating the SZ attachment as authoritative.

## Capabilities (framework contract, `contracts.md`)

| Capability (framework question) | Phase | File(s) |
|---|---|---|
| `check` | 2, per step | manual track |
| `repro` | 1 (bug SZs) | manual track |
| `routing` | 1 | `domain/code-map.md` (GREP) + `domain-knowledge.md` index |
| `accept` | 3 | manual track (rendered TC scripts for a human) |
| `build` | 2 end | manual track |
| `deliverables` | 4 | manual track (`tools/sz-gen-deliverable` skeletons) |
| `review-checklist` | 2.5 | `domain/gotchas.md` (GREP) + `sz-history.md` historic bug classes |
