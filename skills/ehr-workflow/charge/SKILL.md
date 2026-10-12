---
name: "charge"
description: "Charge capture / professional & institutional billing module (ehr/src/Charge): invoke when developing or testing THIS module, OR when the task is about charge workflows — ChargeAdmin config, ChargeServices charge entry/edit (ChargeEdit), patient charges (ChargePatient / coding-view manual forms), charge patient list, guarantor charges, PatientCharge, Claim billing, or the separate ClinicalChargeTool professional capture."
---

# Charge Workflows (Charge Capture / Billing)

> Load this file first to get the module map. It is a **router**: pick your direction below, then read ONLY the file you need so unrelated detail stays out of context.
> Tech stack: React + TypeScript + MUI (`@cci/mui-components`) + jotai (global state) + TanStack Query (data fetching) + (legacy pockets of) React Context + `useReducer`.
> All paths are relative to the `ccsrc` repository root.

## 0. Pick your direction first

| What you are doing | Read |
|---|---|
| 🧑‍💻 Writing / modifying Charge **code** | `ehr/src/Charge/CLAUDE.md` (dev practices — the authoritative conventions file) + the workflow file below that matches your task |
| 🧪 Writing / running **tests** | [workflows/testing.md](workflows/testing.md) *(pending)* |
| 🔍 Looking up a specific **workflow** | the matching row in the index below |
| 🧭 Reaching the module from the portal / browser entry | [workflows/entry-and-navigation.md](workflows/entry-and-navigation.md) |
| 🧠 Looking up **global state / atoms** | [workflows/charge-atoms.md](workflows/charge-atoms.md) *(pending)* |

## 1. What the module is

`Charge` = the charge-capture and billing module. It spans charge **configuration** (`ChargeAdmin`), professional/institutional **charge entry & editing** (`ChargeServices` → `ChargeEdit`, `ChargePatient`, `ChargePatientList`, `Guarantor`), the **PatientCharge** surface, downstream **Claim** billing, and the standalone **ClinicalChargeTool** for point-of-care professional capture.

- **Entry chain**: `ehr/src/Charge/index.ts` → `export { default } from "./ChargeServices"` → `ehr/src/Charge/ChargeServices/index.tsx` (default export `ChargeServices`).
- **Dev conventions** (state model, folder traps, validation, reuse rules) are owned by **`ehr/src/Charge/CLAUDE.md`** — read it before writing code; this skill only adds the workflow/entry/browser map on top of it.

## 2. Directory overview (responsibilities)

```
ehr/src/Charge/
├── index.ts                       # entry: re-exports ./ChargeServices
├── CLAUDE.md                      # dev practices (READ THIS FIRST for code conventions)
├── ChargeAdmin/                   # cleanest area, FLAT: components/ contexts/ pages/ util/ (+ colocated tests)
├── ChargeServices/                # largest, most nested; owns its own atoms/ constants/ types/ util/ contexts/ components/
│   ├── ChargeEdit/                # charge lookup, edit, queue, reverse, buckets, search toolbar
│   ├── ChargePatient/             # patient charge view; coding-view/manual/forms/*DynamicForm.tsx (→ blocks/*FormBlock.tsx)
│   ├── ChargePatientList/         # list of patients carrying charges
│   ├── Guarantor/                 # guarantor charges
│   ├── atoms/ constants/ contexts/ components/ util/   # ChargeServices-wide (NOT top-level Charge/*)
├── PatientCharge/                 # minimal today: top-level files + util/ (follow ChargeAdmin's flat pattern if it grows)
├── Claim/                         # billing/claim; context/ holds BOTH jotai atoms (BillingAtom, ClaimAtom) AND React Context — verify which
├── common/ config/ constants/ types/ util/ theme/   # top-level shared (distinct from ChargeServices/*)
└── (sibling) ClinicalChargeTool/  # separate top-level module: professional charge capture (drawer, queue, transactions)
```

> ⚠️ **Folder traps (from `CLAUDE.md`)**: `ChargeServices/` has its *own* `constants/types/util/atoms` separate from top-level `Charge/*` — keep them distinct. `Claim/context/` mixes atoms and React Context. `ChargePatient/coding-view/manual/forms/*DynamicForm.tsx` are thin wrappers; real form render/validation lives in `blocks/*FormBlock.tsx` (shared `@cci-monorepo/common` DynamicForm).

## 3. Workflow index — READ ONLY WHAT YOU NEED (on-demand)

| If your task is about... | Read |
|---|---|
| Reaching the Charge app from the portal / left rail / test URL | [workflows/entry-and-navigation.md](workflows/entry-and-navigation.md) |
| ChargeAdmin config pages | [workflows/charge-admin.md](workflows/charge-admin.md) *(pending)* |
| Creating / editing / reversing a charge (`ChargeEdit`) | [workflows/charge-edit.md](workflows/charge-edit.md) |
| Manual coding entry — Diagnosis / DRG / Procedure, Begin-session dialog, search-input mechanics, Complete gating | [workflows/coding.md](workflows/coding.md) (+ [charge-patient.md](workflows/charge-patient.md) §5 for the first-time Diagnosis + DRG + Complete run) |
| Patient tab / BNR Overview / BNR tabs / charge entry surface navigation (`ChargePatient`) | [workflows/charge-patient.md](workflows/charge-patient.md) — incl. **Coding manual entry** (Diagnosis + DRG + Complete) in §5 |
| Manual coding entry (Diagnosis / Procedure / DRG) on the BNR **Coding** subtab | [workflows/coding.md](workflows/coding.md) |
| Charge patient list | [workflows/charge-patient-list.md](workflows/charge-patient-list.md) *(pending)* |
| Guarantor charges | [workflows/charge-guarantor.md](workflows/charge-guarantor.md) *(pending)* |
| PatientCharge surface | [workflows/patient-charge.md](workflows/patient-charge.md) *(pending)* |
| Claim billing — end-to-end claim **generation** playbook (Registration→Guarantor→Insurance→Encounter→BNR→Charge→Coding→OE discharge order→Encounter discharge→DB lgtime shift→`updateBNRStatus`) | [workflows/claim.md](workflows/claim.md) |
| ClinicalChargeTool (professional capture) | [workflows/clinical-charge-tool.md](workflows/clinical-charge-tool.md) *(pending)* |
| Global state / atoms | [workflows/charge-atoms.md](workflows/charge-atoms.md) *(pending)* |
| Writing / running tests | [workflows/testing.md](workflows/testing.md) *(pending)* |

> Rule: read exactly the matching file(s); create them on demand as workflows are explored/browser-verified. Do not dump all workflow files into context at once.

## 4. Cross-module note (read before any shared change)

> `Charge` overlaps with **Registration** (guarantors, patient demographics) and **Scheduling** (patient context). `ChargeServices/ChargePatient` reuses the shared DynamicForm system from `@cci-monorepo/common` (see `ehr/src/common/components/forms/DYNAMIC_FORM.md`). When you change shared Charge exports consumed elsewhere, confirm the dependents still work. Avoid the known smell of importing directly from sibling feature modules (e.g. `Claim/Claim.tsx` → `../../Registration/util/QueryHooks`); route through `common` or the proper `@cci-monorepo/*` alias.

Full development rules live in `ehr/src/Charge/CLAUDE.md`. Test rules will live in [workflows/testing.md](workflows/testing.md).
