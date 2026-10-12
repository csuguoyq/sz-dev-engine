# Accounts (BNR) — Overview / Create BNR / Combine BNRs / Edit Form

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves the **Accounts (BNR)** tab (index 6, `PAGE_LABELS.ACCOUNTS` in `constants/pages.ts`) — BNR overview grid, Do Not Bill Insurance, Create BNR, Combine BNRs, BNR edit form (assigned coverages, BNR Details occurrence/span/value/condition codes, Condition Related to, Collection Details).

All components live in `ehr/src/Registration/components/accounts/`.

## Entry & layout

`PatientTab.tsx` renders `AccountsSubTab` at `PAGE_INDICES.ACCOUNTS = 6` (`constants/pages.ts`). `AccountsSubTab.tsx` hosts `PatientHeader` plus one of two toolbars, chosen by the `accountsEditingAtomFamily(regid)` atom:

- `accountsEditing == null` → **Overview mode**: `OverviewToolbar` (prop `"Accounts (BNRs)"`, rendered as **"All Accounts (BNRs)"**) with **Create BNR** (`accounts-create-bnr-button`) and **Combine BNRs** (`accounts-combine-bnrs-button`) action buttons, a **Show Closed** toggle (`accountsShowClosedAtomFamily`, testid `overview-toolbar-toggle`), and a search box ("Search by BNR ID, Account Status...") backed by `accountsSearchAtomFamily`. Content = `AccountsOverview`.
- `accountsEditing = <bnrId>` → **Detail mode**: `DetailToolbar` (prop `"Account"`, rendered as **"Edit Account Details"**) with a **< Back** button that resets `accountsEditing` to `null`. Content = `AccountsEditForm bnrId`.
- Both toolbars carry a `SaveChangesButton`; save goes through the shared `useOnSave` dirty-form registry (see `IsDirtyHook` in `util/EhrUtil.ts`, registered with key `"accounts"`).
- Read-only (buttons disabled, forms inert) when the user lacks `useCheckAppPermission("REGISTRATION", "W")`.
- Deep link: `Config.openTo.bnrId` auto-opens that BNR's edit form after the overview loads (and is nulled when not found).

## BNR ID conventions (key mental model)

- BNR IDs start with a letter coding the type (`ACCOUNT_TYPE_MAP` in `constants/accounts.ts`): `H` Hospital, `P` Professional, `R` Research/Other; digits `0`–`9` are **Base BNRs**.
- `isBaseBNR` (`util/helpers/AccountsHelpers.ts`): base = first char NOT in `HPR`. Non-base BNRs are children of a base: `bnr.bnrId.slice(1).startsWith(baseBnrId)` (`getAllChildrenBnrs`); `bnr.baseId` links back.
- A BNR is frozen when `bnrStatus` is `Billed` or `Closed` (`isFrozen`); `Closed` rows are View-only in the grid.
- Overview rows are built by `processAccountBNRs` (`util/helpers/AccountsHelpers.ts`) from `registration/getPatientBNRs`, joined to the encounters map for admit/discharge columns.

## Overview (`AccountsOverview.tsx` + `BNROverviewTable.tsx`)

- Grid columns: **Billing Number BNR** (first column, expand +/− icon + BNR id), Admit Time, Discharge Time, Encounter Type (from `useEncounterGetter`), Balance / Total Charges (from `useBNRDetailGetter`), **Do Not Bill Insurance** checkbox, **Account Status**.
- Rows expand/collapse via `accountsToggleExpandedAtomFamily` (`bnr-overview-plus-button` / `bnr-overview-minus-button`; rows `bnr-overview-row-<index>`, per-cell testids `bnr-overview-row-<index>-<Column-Name>`, the Edit/View action cell is `bnr-overview-row-<index>-link`). The base BNR auto-expands on load; base rows have **no** Edit action (action shows only on non-base rows, label "View" when read-only or Closed). An expanded row shows an **Assigned Coverages** sub-table (`insurance/CoveragesTable`) built from `bnrDetail.assignedCoverages` mapped through `getInsuranceFromId`.
- **Account Status cell** (`renderAccountStatus`): "Closed (BD with Agency)" gets a warning icon; `chargePendFlag` + "BNR Edits" renders bold red with a tooltip of `chargeDescription`; otherwise `billPauseStatus` (imported from `@cci-monorepo/Charge/ChargeServices/util/BillPauseStatus`) renders claim-edit/bill-pause state ("Claim Edits" is displayed as "Billed" before pause processing).
- **Do Not Bill Insurance**: the base BNR's checkbox is an **aggregate of its children** (checked = all children checked, indeterminate when some are). Checking the base cascades to all children; checking a child updates the base's displayed state (verified). Changes are held in local `useFormData` (`useGetAccountOverviewFormData`), saved by the toolbar Save via `useFormWatcher` → `useBNROverviewMutation`, which diffs each non-base BNR's `doNotBillInsurance` against init and sends one `doRegAction("EBNR", { encounterDbPath, billingNumberNit, billingNumberDNBI })` per change, then refetches. Closed BNR checkboxes are disabled.

## Create BNR (`CreateBnrDialog.tsx`)

1. Toolbar **Create BNR** opens `create-bnr-dialog` ("Create BNR"). Top half: **Select Base BNR** — radio table (`create-bnr-list-table`) of existing base BNRs with admit/discharge date, encounter #, location, unit, type (from `useGetEncountersMap`); Closed base BNRs show italicized.
2. Bottom half: **Select BNR Type** — `ChipChoice` with `Hospital | Professional | Research/Other`; chips are disabled until a base BNR is selected.
3. Submit ("Create BNR") stays disabled until both a base BNR and a type are chosen → `useCreateBNRMutation` → `doRegAction("CBNR", { encounterDbPath, billingNumberType })`. On success the new BNR id is parsed from `CBNR.bnr` in the response, the grid refetches, and the app **navigates straight into the new BNR's edit form** (`setAccountsEditing(newBnrId)`).
4. Failure shows an error toast (`resp.ErrMsg ?? "Action failed."`).
5. After an **Admit**, the Overview already contains an **auto-created Hospital child BNR** (`H<baseId>01`, see [encounters.md](encounters.md) ADT note); creating another Hospital BNR afterwards still succeeds and does not conflict.

## Combine BNRs (`CombineBnrDialog.tsx`) — NOT IMPLEMENTED

`combine-bnr-dialog` has Source and Destination pickers (`CombineBnrSection` / `CombineBnrDropdown`; submit enabled only when both are chosen), but `onCombine` is a **stub that only logs** "Combine BNRs not yet implemented!" and closes. Don't write tests or automation asserting a real combine; don't "fix" by implementing without a requirement.

## Edit form (`AccountsEditForm.tsx`)

Two-column layout under an `AccountSummaryTable` (read-only summary of the BNR):

- **Left: insurance coverages** (`insurance/InsuranceOverviewTables`). Priorities are filtered to the encounter's guarantor type via `getPriorities`; assigned/available lists come from `useGetInsuranceData`. Moving a coverage updates `assignedCoverages` on the form. `effectiveDate`/`terminationDate` columns are omitted here.
- **Right: `BnrDetailsCard`** — only rendered when `hasDetails`, i.e. the BNR id does **not** start with `P` or `R` (`!"PR".includes(bnrId[0])`): Hospital (H\*) and base BNRs get the details card; Professional/Research BNRs don't.
  - Four detail sections — occurrence / span / value / condition code rows (`BnrDetailsRows.tsx`, field testids `bnr-occurrence-code-field-<index>`, `bnr-occurrence-code-date-field-<index>`, `bnr-occurrence-span-code-field-<index>`, `bnr-occurence-span-code-from-date-field-<index>` / `bnr-occurence-span-code-to-date-field-<index>` (typo "occurence" is in the code), `bnr-value-code-field-<index>`, `bnr-value-code-amount-field-<index>`, `bnr-condition-code-field-<index>`). Code choices come from choice lists `conditioncodes` / `occurrencecodes` / `spancodes` / `valuecodes`.
  - Row add/remove via `BnrDetailsButtons`: **plus only appears on the last row and only when that row is full; minus is disabled when it's the single empty row**. Max rows per section enforced via `maxRows`. Blank row templates in `BLANK_DETAIL_MAP` (`constants/accounts.ts`).
  - **Condition Related to** (`RelationSection.tsx`): yes/no `ChipChoice` for employment / auto accident / other accident plus a state dropdown; picking any relation auto-fills `state` from patient demographics (`useGetDemoData`). Validation requires a state when any relation is selected (`INIT_ACCOUNT_ERROR_VALUES.relation`).
  - **Collection Details** (`CollectionDetailsTable.tsx`): rows of amount collected / payment method / collection date / payment type / collected by (testids `bnr-collection-<field>-<index>`, delete icon `collection_delete_icon`), defaults from `INIT_COLLECTION_VALUES`. ⚠️ **Verified 2026-09-10: this component is dead code — it is not imported by `BnrDetailsCard` or any other component, and no Collection Details UI exists on the page.** `getBalance` (`util/helpers/AccountsHelpers.ts`) still computes balance = totalCharges − Σ collections + adjustments.
- **Save**: `useFormWatcher` with `validateAccountFormState` (`util/Validation.tsx`) → `useBNRMutation` → `convertBNRDataToDB` (`util/Transform.tsx`) → endpoint `registration/saveXBNRdata` (identifiers `regid`, `bnrnit`, `encdbpath`, `guarantorType`). The mutation accepts an optional `nits` array to save the same form data to multiple BNRs in chunks. On success the BNR info (`useGetBNRInfoQuery` → `registration/getBNRinfo`) is refetched.
- Form data seeds from `INIT_ACCOUNT_FORM_VALUES` (`constants/accounts.ts`) merged with `useGetBNRInfoQuery`.

## Key symbols

- Atoms: `state/atoms/accounts.ts` — `accountsEditingAtomFamily`, `accountsShowClosedAtomFamily`, `accountsSearchAtomFamily`, `accountsExpandedAtomFamily` / `accountsToggleExpandedAtomFamily` / `accountsExpandedHistoryAtomFamily`.
- Constants: `constants/accounts.ts` — `ACCOUNT_TYPE_MAP`, `INIT_ACCOUNT_BNR_VALUES`, `INIT_ACCOUNT_FORM_VALUES`, `INIT_ACCOUNT_ERROR_VALUES`, `INIT_COLLECTION_VALUES`, `BLANK_DETAIL_MAP`.
- Helpers: `util/helpers/AccountsHelpers.ts` — `isBaseBNR`, `isFrozen`, `getAccountType`, `getAllChildrenBnrs`, `getAccountBnrsForBaseBnr`, `getBalance`, `processAccountBNRs`, sort functions.
- Data: `useGetBNRsQuery` (`registration/getPatientBNRs`), `useGetBNRInfoQuery` (`registration/getBNRinfo`), `useBNRMutation` / `useBNROverviewMutation` (`registration/saveXBNRdata` / `doRegAction("EBNR")`), `useCreateBNRMutation` (`doRegAction("CBNR")`), `useGetAccountOverviewFormData`, `useBNRDetailGetter`, `useEncounterGetter`, `useGetEncountersMap` (`util/DataHooks.tsx` / `util/QueryHooks.tsx`).
- Types: `types/accounts.ts` — `AccountBNR`, `IBaseBNR`, `SpreadBNR`, `BNRType`, `AccountEditFormValues`, `AccountEditFormErrors`, `CollectionDetail`, `BNRRelation`, `BnrDetailType`.
- Cross-module: BNR status rendering reuses Charge's `billPauseStatus`; estimates (`components/estimates/CustomTooltip`) supply the `LightTooltip`.

## Browser-automation notes

- The tab is reached from an open patient via the patient-level tab labeled **Accounts (BNR)**; like other patient sub-tabs, the tab list may need a re-snapshot after patient creation (see [guarantors.md](guarantors.md) gotcha pattern).
- Overview Save is driven by the toolbar Save (`SaveChangesButton`/`useOnSave`), not a per-row button; after checking Do Not Bill Insurance on a base BNR, expect **multiple child rows** to change at once (and one `EBNR` call per changed child).
- Create BNR dialog requires selecting a radio row **before** the type chips unlock; both must be set before submit enables. The radio/checkbox inputs live in portals — click by testid/`input` inside `[data-testid="create-bnr-dialog"]`, and click the chip's **text label** (the visible `input` is just an icon overlay; `check()` on it times out).
- The Account Status column is a rendered composite (icons/tooltips), not plain text — assert on inner text of the cell, not the raw value.
- Edit form is the only place Save validation surfaces (`validateAccountFormState` errors on relation/state and detail rows).
- Detail-section code pickers are **MUI Autocomplete** (type to filter, click `ul[role=listbox] li`), not MUI Select — `.MuiSelect-select` clicks fail. Date fields have **no testid** and typing into them is unreliable: the click opens a **"SELECT DATE" MUI dialog**; pick a day cell then **OK** (typing `09/01/2026` left the mask showing a different date).
- **A detail row added via "+" but left blank silently blocks Save**: `validateAccountFormState`'s `isEmptyRow` exemption applies only when a section has exactly one blank row; a second empty row marks `value`/`date` invalid and Save does nothing (no request, no visible error). Remove the extra row before saving.
- Search box on the overview **does not visibly filter the grid** in this build (verified 2026-09-10: "H100" and "ZZZZ" both leave all rows rendered, Enter included) — don't rely on it in automation.
- The Do Not Bill Insurance checkbox lives behind a wrapper div — **click the inner `input`**, clicking the wrapper does nothing.
- **< Back with dirty edit-form data opens an "Unsaved Changes" confirm** ("You have unsaved data." Cancel | Discard Changes); Discard returns to Overview.

## Verified

- 2026-09-10 (fbch34, playwright): full chain create patient → Self guarantor → insurance 68888 → Inpatient Acute encounter → Admit (auto-created Hospital child BNR) → add second Hospital + Professional BNR (no conflict, both auto-navigate into edit form, no BNR Details card on P/R) → R BNR (no details card) → DNBI cascade save (one `EBNR` POST per changed child) → H BNR detail rows (occurrence code Autocomplete enables date; SELECT DATE dialog; "+" on full row) → Condition Related to Employment=Yes auto-fills state CA → `saveXBNRdata` save + refetch → blank extra row silently blocks Save → < Back unsaved-changes guard → Combine BNRs dialog stub. Env notes (fbch34 vs fbch19): login shows a **Smart Card PIN dialog** first — click "Username/Password Login"; Create Patient DOB picker has a visible **"Choose date" button** (fbch19 does not); encounter Expected Date/Time dialog has an explicit **OK** button.

Not yet exercised: EBNR save with a base-level cascade across multiple children, Combine BNRs actual combine (stub), read-only permission path, Account Status special states (Closed (BD with Agency), BNR Edits + chargePendFlag, bill-pause), deep link `Config.openTo.bnrId`.
