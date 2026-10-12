---
name: "registration"
description: "Front-desk Patient Registration module guide for ehr/src/Registration: invoke when developing or testing THIS module, OR when the task is about patient registration flows — patient search, create new / mini-reg / unknown patient, demographics, guarantors, insurance, appointment creation (Scheduling tab), encounters, accounts, authorizations, referral, travel screening, documents."
---

# Registration Workflows (Patient Front-Desk Registration)

> Load this file first to get the module map. It is a **router**: pick your direction below, then read ONLY the file you need so unrelated detail stays out of context.
> Tech stack: React + TypeScript + MUI (`@cci/mui-components`) + jotai (global state) + TanStack Query (data fetching).
> All paths are relative to the `ccsrc` repository root.

## 0. Pick your direction first

| What you are doing | Read |
|---|---|
| 🧑‍💻 Writing / modifying Registration **code** | [workflows/dev-conventions.md](workflows/dev-conventions.md) (+ the workflow file below that matches your task) |
| 🧪 Writing / running **tests** | [workflows/testing.md](workflows/testing.md) |
| 🔍 Looking up a specific **workflow** | the matching row in the index below |
| 🧠 Looking up **global state / atoms** | [workflows/registration-atoms.md](workflows/registration-atoms.md) |

## 1. What the module is

`Registration` = the front-desk patient registration flow. A user searches for / creates a patient, then fills per-patient registration data (demographics, guarantors, insurance, appointments, encounters, accounts, authorizations, referrals, travel screening, documents).

- Entry chain: `ehr/src/Registration/Registration.tsx` → `ehr/src/Registration/components/common/DynamicPages.tsx` (tab bar of open patients). The first tab (`TAB_ID_ENUM.PATIENT_RECORD_ID`) renders `components/search/PatientSearchPage.tsx`; other tabs render `components/common/PatientTab.tsx`.
- **This module also creates the appointments that `ehr/src/Scheduling` displays.**

## 2. Directory overview (responsibilities)

```
ehr/src/Registration/
├── Registration.tsx / index.ts                # entry
├── jest.config.js                             # own jest project: displayName "registration"
├── components/
│   ├── search/           # PatientSearchPage / PatientSearchForm / PatientDataTable ...
│   ├── minireg/          # MiniRegDialog / UnknownPatientDialog
│   ├── scheduling/       # SchedulingSubTab / BookingSummary / AppointmentCard / conflicts ...
│   ├── common/           # DynamicPages / PatientTab / PatientHeader ...
│   └── <domain>/*        # demographics, insurance, guarantors, encounter, accounts,
│                         # authorization, referral, travelscreening, documents, estimates
├── constants/            # pages.ts (PAGE_INDICES/PAGE_LABELS), scheduling.ts (INIT_APPOINTMENT_FORM_VALUES), ...
├── config/               # referral.ts / authorization.ts / estimates.ts / common.ts dicts + getNextId
├── state/store.ts + state/atoms/*             # jotai per-domain atoms (reexported via @cci-monorepo/Registration/*)
├── types/*.ts            # per-domain TS types
└── util/                 # the single data entry point
    ├── DataAPI.tsx / DataRequests.tsx / DataHooks.tsx / QueryHooks.tsx   # backend requests
    ├── Validation.tsx + validationRules/getMergedRules.ts               # cross-field validation
    ├── helpers/          # SchedulingHelpers / InsuranceHelpers / GuarantorHelpers / AccountsHelpers ...
    └── Transform.tsx / EhrUtil.ts / appRoutingHooks.ts ...
```

> Treat `util/` as the **single data entry point** and `state/atoms/` as the shared state; consult them first when tracing data flow.

## 3. Pages & tabs (constants/pages.ts)

Per-patient registration is organized into tabs (`PAGE_INDICES` / `PAGE_LABELS`):

| Index | Page | Purpose |
|---|---|---|
| 0 | Demographics | Basic patient identity (DOB, MRN, address, PCP...) |
| 1 | Guarantors | Responsible-party / guarantor info (see [workflows/guarantors.md](workflows/guarantors.md)) |
| 2 | Insurance | Coverage plans, verify, upload documents (see [workflows/insurance.md](workflows/insurance.md)) |
| 3 | **Scheduling** | **Create appointments for this patient** (see [workflows/appointment-creation.md](workflows/appointment-creation.md)) |
| 4 | Encounters | Visit / encounter records — see [workflows/encounters.md](workflows/encounters.md) |
| 5 | Estimates | Cost estimates |
| 6 | Accounts (BNR) | Balances / accounts receivable (see [workflows/accounts-bnr.md](workflows/accounts-bnr.md)) |
| 7 | Authorizations | Referral authorizations |
| 8 | Referral | Referral form + documents (see [workflows/referral.md](workflows/referral.md)) |
| 9 | Travel Screening | Travel screening questionnaire (see [workflows/travel-screening.md](workflows/travel-screening.md)) |
| 10 | Documents | Patient documents |

## 4. Workflow index — READ ONLY WHAT YOU NEED (on-demand)

| If your task is about... | Read |
|---|---|
| Entry, navigation, opening a patient, `routeToRegistration` | [workflows/patient-search.md](workflows/patient-search.md) |
| Patient search screen / search form / results table | [workflows/patient-search.md](workflows/patient-search.md) |
| **Creating a new patient** (CreatePatientDialog, CPAT) | [workflows/patient-creation.md](workflows/patient-creation.md) |
| Quick registration (MiniReg) / anonymous patient | [workflows/minireg-unknown.md](workflows/minireg-unknown.md) |
| **Guarantors** (Add Guarantor) | [workflows/guarantors.md](workflows/guarantors.md) |
| **Insurance** (add/change plan, save, E-Verify, priorities, documents) | [workflows/insurance.md](workflows/insurance.md) |
| **Encounters** (create / edit / ADT admit-transfer-discharge / ambulatory check-in-out / print) | [workflows/encounters.md](workflows/encounters.md) |
| **Accounts (BNR)** (overview, Create/Combine BNR, BNR Details, collections) | [workflows/accounts-bnr.md](workflows/accounts-bnr.md) |
| Demographics / Estimates / Authorizations / Documents tab forms | [workflows/patient-data-tabs.md](workflows/patient-data-tabs.md) |
| **Creating an appointment** (Scheduling tab; the prerequisite data for `ehr/src/Scheduling`) | [workflows/appointment-creation.md](workflows/appointment-creation.md) |
| Referral form / drawer / status transitions | [workflows/referral.md](workflows/referral.md) |
| Travel screening | [workflows/travel-screening.md](workflows/travel-screening.md) |

> Rule: read exactly the matching file(s); do not dump all workflow files into context at once.

## 5. Cross-module note (read before any shared change)

> `Registration` is consumed by **`ehr/src/Scheduling`** via `@cci-monorepo/Registration` aliases. **When you change shared Registration exports, confirm `Scheduling` still works before committing.** Conversely, to create test appointments for Scheduling use [workflows/appointment-creation.md](workflows/appointment-creation.md).

Full development rules (data entry point, ESS runtime, validation, dates, cross-module boundaries) live in [workflows/dev-conventions.md](workflows/dev-conventions.md). Test rules live in [workflows/testing.md](workflows/testing.md).