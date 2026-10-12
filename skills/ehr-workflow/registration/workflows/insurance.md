# Insurance (Add / Plan Lookup / Save / Verify / Priorities / Documents)

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves the **Insurance** tab — add/change insurance, payer-plan lookup, save, E-Verify / manual verify, priorities reorder, documents, True Self-Pay / Pending Medicaid drawers.

## Entry & layout

`PatientTab.tsx` renders `InsuranceSubTab` at `PAGE_INDICES.INSURANCE = 2` (`constants/pages.ts`). `InsuranceSubTab.tsx` hosts `PatientHeader` + `CciSubTabs`:

- Tab 0 = **Insurance Overview** → `InsuranceOverviewForm` (toolbar + coverage table + self-pay/pending-medicaid cards + details drawer + reorder dialog).
- Tabs 1..n = one per open insurance NIT (`insuranceTabsAtomFamily`), labeled by payer name or **"New Insurance"** for a blank form (`BLANK_FORM_NIT = -3`). Content = `PatientInsuranceForm`.
- On tab change a blank (unnamed) insurance tab auto-closes; deep-links via `Config.openTo.insuranceId` / `.nit` can auto-open an insurance tab.

> **Browser gotcha**: like the Guarantors sub-tabs, patient sub-tabs may be hidden from the accessibility snapshot right after patient creation — switch by clicking the tab whose text matches `/insurance/i` via a side-effect `browser_evaluate` script, then re-snapshot (see [guarantors.md](guarantors.md) for the working pattern).

## Add Insurance flow (two-step)

1. On **Insurance Overview**, click **Add Insurance** in `InsuranceOverviewToolbar` (`data-testid="insurance-add-insurance-button"`). This does **two things at once**: opens a blank "New Insurance" tab (`setSelectedNit(BLANK_FORM_NIT)` via `insuranceOpenTabWriteOnlyAtomFamily`) and opens **`AddInsuranceDialog`** (`showAddInsuranceDialogAtomFamily`).
2. In the dialog (`AddPayerPlanContent`), type into the payer/plan search field (`add-insurance-lookup-search-field`, debounced 250 ms, min `MIN_NUM_PAYER_PLAN_CHARS = 3`) → `useGetPayerPlanQuery` → endpoint `registration/getpayerplan`. Results are a radio list (`add-insurance-radio-group` / `add-insurance-list-table`).
   - No results → auto re-search `"generic"` and show a `CciAlert` that generic plans disable electronic verification.
3. Select a plan radio — the submit button (`add-insurance-dialog-submit-button`) stays disabled until one is selected. Submit → `integratePayerPlanData` (`util/Transform.tsx`) merges plan fields into the form; dialog closes, you are on the "New Insurance" tab.
4. Cancel (or a dirty close) resets `INIT_INSURANCE_FORM_VALUES`, closes the blank tab, returns to Overview. Backdrop clicks are ignored; dirty close raises `CciUnsavedDataDialog` (`add-insurance-dialog-unsaved-changes-confirm-dialog`).

**Change Plan** reuses the same dialog (`isChangePlan`, `showChangePlanDialogAtomFamily`; button `reg-insurance-change-plan-button` in `PayerPlanSubtitle.tsx`) and wipes Insured/Subscriber fields via `handleChangePlan`.

## Fill & save the insurance form

`PatientInsuranceForm.tsx`:

- Data from `useGetPatientInsuranceQuery(regId, selectedNit)`; form state via `useFormData` + `INSURANCE_FORM_CONFIG` (`constants/insurance.ts`) rendered by `DynamicFormPage` with `INSURANCE_COMPONENT_MAP`.
- **Validation**: `requiredForSaveErrors` plus async debounced validators — `validateZipcodeAsync` (payer-claims + subscriber addresses) and `validatePayerMemberIdAsync` (atoms in `state/atoms/addressValidation.ts`). Hard stops disable Save.
- **Duplicate payer guard**: adding a payer whose `payerId` matches an existing RTE-enabled plan (`useHasMatchingPayerId`) silently blocks Save; attempting save opens **`PayerIdDuplicateDialog`** (`registration-payer-id-duplicate-dialog`, "Duplicate Payer Plan Detected") with "Change Plan" / "Return to Form".
- **Save**: toolbar **Save / Save and Close** (`InsuranceFormToolbar`) → `useInsuranceDataMutation` → `doRegAction("SINS", ...)` (action code `SINS`, not a plain endpoint). New insurance gets an id from `generateInsuranceId` (`util/helpers/InsuranceHelpers.ts`); new NIT is parsed from the response. Toasts: "Insurance saved successfully" / "Insurance changes saved successfully".
- Form is **read-only** when the insurance is inactive, terminated, or the user lacks `useCheckAppPermission("REGISTRATION", "W")`.
- Toolbar also has: **E-Verify**, **Verify Manually**, Delete (`DeleteInsuranceDialog`, toast "Succesfully deleted this insurance" — typo is in the code), Inactivate/Activate (`useToggleInsuranceActive`, requires a termination date via `ConfirmActionDialog` dragId `inactivate-insurance`), Eligibility history dialog.

## Verification

- **E-Verify** (`VerifyInsuranceButton`, `insurance-everify-button`): first checks configured required fields (`useGetConfQuery({geteverificationdefaults: 1})` mapped via `INSURANCE_FIELD_MAP`). Missing → highlights required fields (`highlightRequiredAtomFamily`) + warning toast, no request. OK → `registration/verifyPatientInsurance` with `status: "request_270"`, then refetch. Disabled for unsaved/new insurance, read-only, or per `shouldDisableEVerify` interval config.
- **Manual** (`ManuallyVerifyButton`, `insurance-manual-verify-button`): menu reasons "Website" / "Phone Call" → same endpoint with `manual_verified`; already verified shows "Unverify Insurance" (`manual_unverified`).
- Status icons/labels in `VerificationInfo.tsx` (`unverified | in_process | request_270 | everified | manual_verified | needs_review | rejected | error | eberror`); history in `EligibilityDialog` (`cci-eligibility-details-dialog`, newest first).
- Grid cell rendering: `InsuranceCellRender.tsx` (verified/failed icons, "No Insurance", "Re-Verify" link — the Re-Verify handler is a stub `alert()`).

## Priorities (reorder)

On Overview, **Reorder Priorities** → inline drag mode (MUI DataGrid `rowReordering`, `InsuranceOverviewTable`) → **Apply** opens `ReorderPrioritiesDialog` (dragId `reorder-priorities`) asking an effective date per changed type (defaults `serverMidnightToday()`) → `useInsuranceOverviewMutation` → endpoint `registration/savepatientinsurancepriorities` (payload `insurance_priorities` + unix `priority_dates`); toast "Succesfully reordered insurance priorities" (typo in code). Priority naming/grouping helpers: `getPriorityName`, `applyPriorityToInsurance`, `resetInsurancePriorities` in `util/helpers/InsuranceHelpers.ts`.

## Documents

- `AddInsuranceDocumentButton` (id `insurance-upload-document-button-${nit}`): insurance doc-type-filtered upload; disabled for new (negative) NIT.
- `UploadInsuranceDialog` (`cci-upload-insurance-dialog`): cropperjs front/back image upload.
- `InsuranceFormDocumentsTable`: documents from `useGetDocumentsQuery` filtered by `otherAssociations.insurancenit === formData.nit`; delete via `DeleteDocumentDialog`.

## True Self-Pay / Pending Medicaid drawers

`InsuranceDetailsCard` ×2 on Overview open `InsuranceDetailsDrawer`; content picked by `insuranceDetailsTypeAtomFamily` (`SELF_PAY` / `PENDING_MEDICAID` from `constants/insurance.ts`):

- `SelfPayDrawerContent` / `PendingMedicaidDrawerContent`, notes via CommonNotes; save via `useInsuranceDetailsMutation` → `doRegAction("SINS", { self_pay_details })`.
- Pending Medicaid's **"Save and Add Medicaid"** sets `newMedicaidInsuranceValuesAtom` to prefill a new Medicaid insurance form in `PatientInsuranceForm`.

## Key symbols

- Atoms: `state/atoms/insurance.ts` — `insuranceTabsAtomFamily`, `selectedNitAtomFamily` (-1 on Overview), `insuranceViewModeAtomFamily` (`current|historical|all`), `showAddInsuranceDialogAtomFamily`, `showChangePlanDialogAtomFamily`, `highlightRequiredAtomFamily`, `newMedicaidInsuranceValuesAtom`, etc.
- Constants: `constants/insurance.ts` — `INIT_INSURANCE_FORM_VALUES`, `BLANK_FORM_NIT = -3`, `INSURANCE_FORM_CONFIG`, `INSURANCE_FIELD_MAP`, `PAYER_PLAN_EXISTS_ERROR_STRING`, `PRIORITY_MAP`, `SELF_PAY`, `PENDING_MEDICAID`.
- Helpers: `util/helpers/InsuranceHelpers.ts` (priority management, verification-dirty checks, id generation, delete permission via `useCanDeleteInsurance`).
- Data: `useGetPatientInsuranceQuery`, `useGetPayerPlanQuery`, `useInsuranceDataMutation`, `useInsuranceOverviewMutation`, `useInsuranceDetailsMutation`, `useDeleteInsurance`, `useToggleInsuranceActive`, `useHasMatchingPayerId`; endpoints `registration/getpatientinsurance`, `registration/getpayerplan`, `registration/verifyPatientInsurance`, `registration/savepatientinsurancepriorities`, `registration/deletepatientinsurance`; saves/deletes/activation all via `doRegAction("SINS", ...)`.
- Types: `types/insurance.ts` — `InsuranceFormData`, `InsuranceOverviewData`, `VerificationStatus`, `SelfPayDetailType`, `PendingMedicaidDetailsType`.
- Tests: `components/insurance/__tests__/` — `InsuranceSubTab.test.tsx`, `PatientInsuranceForm.test.tsx`, `AddInsuranceButton.test.tsx`, `VerifyInsuranceButton.test.tsx`, `UploadInsuranceDialog.test.tsx`, `InsuranceCellRender.test.tsx`.

## E2E walkthrough (add → save → verify → reorder → delete)

> Verified end-to-end 2026-09-10 (fbch19 SDMC demo; steps 3–4 also re-verified on fbch34 the same day — see the environment-difference gotchas below).

1. **Reach the tab**: after opening the patient, patient-level tabs (Demographics/Guarantors/Insurance/...) were directly visible; clicking `Insurance` opened the Overview with `Add Insurance`, Current/Historical view toggle, Insurances grid, `Reorder Priorities`, True Self-Pay / Pending Medicaid cards.
2. **Add Insurance** (`insurance-add-insurance-button`) opened the blank "New Insurance" tab **and** the plan dialog together; submit button (`add-insurance-dialog-submit-button`) verified **disabled** before plan selection. Searching `68888` in `add-insurance-lookup-search-field` returned exactly one plan (BCBS PPO / 68888 / BCBSTX / Commercial); selecting its radio enabled submit.
3. **Prefill**: after submit, the New Insurance form held all plan fields read-only (Plan Name BCBS PPO, Plan ID 68888, Payer ID SB900, Payer Name BCBSTX, claims address). Field testids follow `insurance-<camelCaseField>-field` (e.g. `insurance-memberId-field`, `insurance-subscriberFirstName-field`); date inputs have **no testid** — target `input[placeholder="__/__/____"]` by position (0=effectiveDate, 1=terminationDate, 2=subscriberDOB).
4. **Relationship to Subscriber = Self**: pick `Self` from the relationship field (`insurance-insured-relationship-field`; see gotchas for the Select vs Autocomplete difference between environments) — choosing Self **auto-fills the whole Subscriber section from patient demographics**.
5. **Save**: toolbar Save → tab renamed from "New Insurance" to the payer name, status line gains an `Unverified at <timestamp>` stamp, form turns read-only, and the insurance appears in the Overview grid as a new priority row. Success toast flashes too fast to capture — **the tab rename + status timestamp + Overview row are the reliable save assertions**.
6. **E-Verify**: on the saved insurance (not new/unsaved) the button is enabled; clicking it sent the request — status line became **In Process** (no required-field block when member id + demographics suffice).
7. **Verify Manually**: menu shows exactly **Website / Phone Call**; picking Website flipped the status to **Manually Verified** (green icon in the Overview grid).
8. **Reorder Priorities**: button enters an inline reorder mode (per-row drag handles, header buttons become Cancel/Apply). A real Playwright **mouse drag** of the row's drag handle works (move to handle center → `mouse.down` → steps → `mouse.up`); priorities auto-relabel (Primary/Secondary/Third/...). **Apply** opens `ReorderPrioritiesDialog` ("Please enter the effective date for the reordered priorities: Medical", one date input, Cancel/Confirm Reorder, defaults today). Confirm → toast "Succesfully reordered insurance priorities" (typo in code) and the new order persists after reload of the grid.
9. **Delete**: toolbar Delete on an opened insurance → `DeleteInsuranceDialog` "Are you sure you want to delete BCBSTX?" → Delete → toast "Succesfully deleted this insurance" (typo in code) and the row disappears from Overview.

Not yet exercised: E-Verify blocked path (missing required verification fields → highlight + warning toast), eligibility dialog, Inactivate/Activate, document upload, True Self-Pay / Pending Medicaid drawers, Change Plan.

## Browser-automation gotchas

- Add Insurance is **two-step**: the blank tab AND the plan dialog open together; the form populates only after plan selection + submit. Automation must expect tab-count changes and the disabled submit button.
- Duplicate payerId blocks Save **silently**; the dialog only appears on attempted save.
- Unsaved-changes guards everywhere: `useWrapNavigation` on tab switches, `CciUnsavedDataDialog` on dirty dialog close, backdrop clicks ignored on the Add dialog.
- E-Verify with missing required fields only highlights fields + toast — don't expect a network call.
- Inactive/expired insurance or missing REGISTRATION write permission → form silently read-only.
- Async zipcode/memberId validation is debounced — errors can appear seconds after typing; hard stops disable Save.
- `Config.openTo` / `cci.openTo` deep links can auto-open tabs/dialogs and are nulled after handling.
- **Environment-dependent required fields** (fbch34, verified 2026-09-10): **Member ID** (`insurance-memberId-field`) and **Effective Date** are required there before Save enables — fill both (any member id string works, e.g. `M68888001`). fbch19 did not require them.
- **Relationship field differs by environment**: fbch19 = MUI Select (click `.MuiSelect-select`, then the `Self` option in `ul[role=listbox]`); fbch34 = MUI Autocomplete (click `[data-testid="insurance-insured-relationship-field"] input`, the option listbox opens directly).
