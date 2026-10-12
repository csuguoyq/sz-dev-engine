# Charge Patient — Patient Tab, BNR Overview & BNR Tabs

> Companion to `skills/ehr-workflow/charge/SKILL.md`. Read this file for the **patient → BNR → Charges navigation** inside `ChargeServices` (what the `ChargePatient` view actually renders) and for the **BNR data model** quirks that decide whether a patient can carry charges at all.
> Prerequisite: login + Account Lookup entry — see [entry-and-navigation.md](entry-and-navigation.md).
> Verified live on SDMC `fbch34`, 2026-09-11 (navigation) and 2026-09-13 (Coding manual entry: Diagnosis + DRG + Complete) (Playwright MCP).

## 1. Where this screen is (code map)

- `ehr/src/Charge/ChargeServices/ChargePatient/` — `ChargePatient.tsx` (patient tab: header + BNR tabs), `ChargePatientTabs.tsx` (the **BNR tab** subtabs), `PatientBNRTable.tsx` (BNR Overview list).
- Patient tab header: `PatientHeader` (Registration shared) + per-level `dynamicInfo`.
- BNR list rows come from `useGetBNRsQuery(regid)`; the row action and +/− icons are in `@cci-monorepo/Registration` `components/accounts/BNROverviewTable.tsx` (shared with Registration's `Accounts (BNRs)` tab).

## 2. Patient tab (opens from the Account Lookup name link)

- A new module tab labeled with the patient name (e.g. `35048test1L, 35048test1F`) opens with one auto-selected subtab: **`BNR Overview`**.
- Header levels (verified):
  - **Patient-level** (BNR Overview selected): `DOB`, `SEX`, `MRN`, `Plan Name`, `Insurance Plan`, `Financial Class`, `Pref. Language`.
  - **BNR-level** (a BNR tab selected): `BNR ID`, `BNR Status`, `Financial Class`, `Account Balance`, admit/discharge dates.
- Header reads `New Patient` with `N/A`/empty values when the patient's `regid` did not resolve — see §6 (orphan records).

## 3. BNR Overview (`PatientBNRTable.tsx`)

- Toolbar: `Search Billing Number Records` field, **`Show Closed`** checkbox (filters closed BNRs client-side), `Bill Pause` button (disabled while no BNRs).
- Table columns: **Action | Billing Number BNR | Admit Date | Discharge Date | Encounter Type | Encounter ID | Discharge Department | Payer | Balance | Total Charges | Account Status**.
- Row model (`isBaseBNR` in `Registration/util/helpers/AccountsHelpers.tsx`):
  - **Base BNR row**: first cell shows a **+ / − expand icon** (`data-testid="bnr-overview-plus-button"` / `bnr-overview-minus-button`) that toggles the child BNR rows. **No action link** while the encounter is active. ⚠️ **After the encounter is Discharged, the base row additionally carries an `Open` action link** (observed 2026-09-17, `fbch34`: base row `…$511.00 | $511.00 | Open` with the child row showing `Discharged` status); the `Open` link then opens the BNR tab for the (Hospital child) BNR.
  - **Child BNR row**: first cell shows the **`Open` action link** (bold MUI `<Link>`, `<a>` text exactly `Open`). Clicking it runs `addPatientTransactionTab(bnr.bnrId)` → opens the **BNR tab** for that BNR.
- Empty state: a single row with text `None` (`data-testid="bnr-overview-no-results-row"`) — the patient has no BNRs (or none pass the Show Closed filter).
- Verified example (2026-09-11, patient `35048test1L, 35048test1F`): base `1001650344580` + child BNRs `100165034458001`–`…004`, all `Active`, encounter `1650344580` (Inpatient Acute, admitted 07/09/2026).

## 4. BNR tab (`ChargePatientTabs.tsx`)

- Tab label: `BNR <typeChar><bnrId>` (e.g. `BNR H100165034458001`; `H` = Hospital type).
- Subtabs render **only when the BNR info resolves** (`useGetBNRInfoQuery(regid, bnrId)` non-empty — otherwise the component returns `<></>`):
  - **Account Summary** (default)
  - **Charges** — `ChargesSubTab.tsx` → `PatientChargeAppForChargePatient` → the **Add Charges / View Charges** surface (see `charge-edit.md`)
  - **Coding** — coding views (manual forms; `coding-view/manual/forms/blocks/*FormBlock.tsx`)
  - **Registration** — registration tab
  - **Billing** — claim/fee billing
- Unsaved-changes guard: `data-testid="charge-patient-confirm-dialog"` (CciUnsavedDataDialog) on tab switches with dirty data.
- The selected BNR is tracked in `bnrIdAtom` (ChargeServices atoms) and set from `bnrInfo?.bnr`.

## 5. Coding subtab — manual entry (Diagnosis / DRG / Complete)

Verified end-to-end on `fbch34`, 2026-09-13 (BNR `H100165034458001`, patient `35048test1L, 35048test1F`). All coding surfaces are **MUI + React** manual forms under `ehr/src/Charge/ChargeServices/ChargePatient/coding-view/manual/forms/blocks/*FormBlock.tsx`.

The Coding subtab itself renders nested subtabs: **DRG · Diagnosis · Procedure · ADT · Coding History · Coding Notes**, with a shared toolbar (**Add** [per-tab], **Remove**, **Add Note**, **Hold**, **Complete**) and a `Coding Status` field (`Not Started` → `In Progress` → `Complete`). For the Begin-session dialog testids, the ICD-10 search-input mechanics (Enter-to-open listbox, real-keystroke requirement, unique-match auto-select), the `charge/getProblemList` probe, and the demo ICD-10 data caveat, see [coding.md](coding.md).

- **Start coding**: if `Coding Status` is not yet `In Progress`, click **Begin Coding** (sets status → `In Progress`) so the Add buttons become usable.
- **Complete gating**: the **Complete** button is disabled until **both Diagnosis and DRG are entered**; clicking it moves `Coding Status: In Progress → Complete` (timestamped). This is why DRG must be entered before Complete.

### 5.1 Diagnosis

- Diagnosis nested subtab → **Add Diagnosis** → drawer `Add Diagnosis` with two form blocks: **Admit Diagnosis** and **Principal Diagnosis** (each an `ICD 10-CM Code` autocomplete).
- `ICD 10-CM Code` field: MUI Autocomplete, searches by **description keyword** (verified `diabetes` → 3 matches). A bare partial code like `E11` returned 0 — search by the term, not a code prefix. Selecting a row fills the field.
- **Save Diagnosis** enables only when BOTH Admit and Principal blocks hold a valid code; click it → drawer closes and rows appear in the Diagnosis table (columns: `ICD 10-CM Code | Description | POA | HAC | CC | MCC | Code Date | Type of Diagnosis | Code Set Source`).
- Observation (non-blocking): `POA/HAC/CC/MCC/Code Date` are not required and save blank; `Type of Diagnosis` column carries a default (observed `I10`).

### 5.2 DRG

- DRG nested subtab → **Add DRG** → drawer `Add DRG` (fields: `DRG`, `Severity Illness`, `Risk Mortality`, `DRG Description`, `DRG Type`, `MDC Code`, `MDC Description`, `Weight`, `ALOS`, `GLOS`).
- `DRG` field: MUI Autocomplete, placeholder `Search DRGs`; matches by **code or description** (verified `470` → `470 - MAJOR HIP AND KNEE JOINT REPLACEMENT...`). Selecting a DRG auto-populates `DRG Description`, `DRG Type` (e.g. `SURG`), `MDC Code`, `MDC Description`, `Weight`, `ALOS`, `GLOS` — these become disabled/read-only.
- `Severity Illness` and `Risk Mortality`: **required** MUI select/autocomplete; options `1 - Minor` / `2 - Moderate` / `3 - Major` / `4 - Extreme`. Must both be chosen.
- **Save DRG** enables when DRG + Severity + Risk Mortality are set; click it → row appears in the DRG table (verified: `470 | SURG | 08 | 1.9289 | 3 - Major | 3 - Major | 2.2 | 1.9`).
- **Browser-testing note (MUI Autocomplete)**: Playwright `fill` does **not** trigger the async DRG search — the popup stays on its "Type to Search" empty state. To drive it from Playwright, set the value via the native input setter + dispatch an `input` event:
  ```js
  const i = document.querySelector('#DRG-DRG');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, '470');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  ```
  The field ids follow `DRG-<field>` (e.g. `DRG-DRG`, `DRG-Severity_Illness`, `DRG-Risk_Mortality`, `DRG-DRG_Description`). Severity/Risk Mortality open a normal option list (`role=option`) and can be clicked by text.

### 5.3 Complete

- With Diagnosis + DRG present, click **Complete** (Coding toolbar) → `Coding Status: Complete` with a timestamp. Procedure is optional for completion in this verification.

## 6. ⚠️ Orphan billing records (why a patient can show no BNRs)

The Account Lookup index is the **billing** index — it can contain MRNs with **no Registration patient**. Symptoms (all observed 2026-09-11):

- Patient tab header: `New Patient`, `DOB: ()`, `MRN: N/A`, `Plan Name: N/A`.
- BNR Overview: `None` even with `Show Closed` on.
- Cause: `useGetPatientInfoQuery(mrn)` → no `regid` → `useGetBNRsQuery`/insurance queries return nothing.

Consequences:

- **No BNR can be created** for such a patient from the UI: Registration's `Create BNR` dialog (`Accounts (BNRs)` tab, `data-testid="accounts-create-bnr-button"`, `components/accounts/CreateBnrDialog.tsx`) requires a `regid` and an **existing base BNR** to select; API `registration/createXBNR {encdbpath, bnrtype}` (`Registration/util/DataAPI.tsx` `createBNR`) also takes the **base BNR's `encdbpath`** — there is no "create the first/base BNR" UI. Base BNRs originate from the billing system at admission.
- **Diagnosis**: re-search the same MRN in the **Registration** app (rail `REGISTRATION`, `[data-testid="sf-mrn-tf"] input` + Enter). No result there ⇒ orphan record ⇒ pick a different patient.
- **Pick a patient whose BNR Overview lists rows** (e.g. any admitted demo patient with an Active BNR) before attempting charge entry.

## 7. Verification checklist

- Patient tab: name tab present; BNR Overview table rendered (rows or `None`).
- Patient is real: the same MRN finds a patient in the Registration app search.
- BNR tab: `BNR …` tab with the five subtabs; BNR-level header shows `BNR ID` / `BNR Status` / `Account Balance`.
- Charges subtab: `Add Charges / View Charges` tabs present (`data-testid="patient-charge-add-charges-tab"` on the Add Charges surface).
- Coding subtab (manual entry, see §5): `Begin Coding` sets `Coding Status → In Progress`; **Add Diagnosis** drawer saves Admit + Principal rows to the Diagnosis table; **Add DRG** drawer (search `470`, set Severity + Risk Mortality, Save) saves a DRG row; once Diagnosis + DRG exist, **Complete** flips `Coding Status → Complete`.
