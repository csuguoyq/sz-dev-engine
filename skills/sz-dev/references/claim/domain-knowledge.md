# Claim module reference (sz-dev)

Billing/Claim domain knowledge, split into on-demand topic files under
`domain/`. **Do not read them all** — use the routing table and open
only what the task needs.

Two access modes:
- **READ** — narrative files, read whole when the domain matches
- **GREP** — lookup files, search for the symbol/symptom instead of
  reading (grep costs ~nothing in context)

Everything here is a map, not ground truth — verify against the current
FRD revision (see `frd-catalog.md`) and the actual repository. Code wins
any conflict.

## Sibling references

| File | Access | When |
| ---- | ------ | ---- |
| `frd-catalog.md` | READ (Phase 1, always) | FRD family → latest version → attachment ID |
| `sz-history.md` | GREP (SZ id / keyword) | prior art: one line per SZ that touched the module |
| (key SZ prior art) | READ via softzilla MCP (`bug_info` / `bug_comments`) | when current SZ is a follow-up of a key SZ, fetch the SZ via softzilla MCP (`bug_info` / `bug_comments`) (check `.sz-dev/SZxxxx/attachment/<id>_*.md` first) |

## Routing table (task → files)

| The SZ is about… | READ | GREP first |
| ---------------- | ---- | ---------- |
| Claim lifecycle: create/edit/submit/reject/void/resubmit/late charge/COB/XR/status/TC/balance math | `domain/claim-lifecycle.md` | `domain/gotchas.md` (symptom) |
| 835/ERA, payment posting, remittance actions, EDI segments, 277/999 parsing | `domain/remittance-835.md` | `domain/gotchas.md` |
| Guarantor (balance/statements/payments/view) or Bill Pause | `domain/guarantor.md` | `domain/gotchas.md` |
| Guarantor **payments**, EasyPay/Verifone, card-on-file, TC 1000/1001 | `domain/guarantor.md` (Payments section) | `domain/gotchas.md` (EasyPay), `domain/code-map.md` |
| Billing tab UI (cards/tables/timeline/notes/submit dialogs), AR Management, permissions | `domain/billing-ui-ar.md` | `domain/code-map.md`, `domain/gotchas.md` |
| Where code lives / what to touch | — | `domain/code-map.md` |
| New code: where it goes, which patterns to avoid, terms, end-to-end picture | `domain/misc.md` (only the section you need) | — |

If the SZ touches more than one domain, read each matching file — they
are small on purpose.

For prior-art on a key SZ (one per FRD family, latest version, plus the
2026 key SZs — identified by grepping `sz-history.md` for the family or
symptom), fetch the SZ's attachment directly through the
softzilla MCP (`bug_info` / `bug_comments`) for `SZ<id>`. The attachment carries the FRD digest,
code footprint, and pitfalls — the fastest way into a follow-up ticket.
Always save the result to `.sz-dev/SZxxxx/attachment/<id>_<title>.md`
(check the directory first; re-use any cached copy).

## Topic files

```text
domain/claim-lifecycle.md      flows + status models + TC v2.0 + formulas
domain/remittance-835.md       835 pipeline + remittance actions + EDI
domain/guarantor.md            guarantor family + 5013 payments + Bill Pause
domain/billing-ui-ar.md        billing tab hub + AR management + perms
domain/code-map.md             where each family touches (verified 2026-09)  [GREP]
domain/gotchas.md              numbered gotchas, each with SZ source      [GREP]
domain/misc.md                 revenue-cycle picture, glossary, conventions
```

## Hard rules

1. The FRD attachment on the current SZ is not always the latest version
   — check `frd-catalog.md`.
2. Code scope comes from the FRD use cases + Figma, plus related
   historical SZs in git. Do not copy the current SZ's C-3PO file list
   or MR as the map.
