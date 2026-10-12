# Check-in (components/CheckInPanel.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves **check-in** (demographics / guarantor / insurance forms, admit).

- Entry: click appointment on calendar → `patFocusDiagOpened + patApptData` → "Check-in" tab in patient focus.
- Data: `useGetPatientDemoInfoQuery` (demographics), `useGetEncounter`/`useGetEncountersQuery` (encounter), `useGetInsuranceData` (insurance), `useGetGuarantorsQuery` + BNR (guarantor/balance).
- Three forms (demographics / guarantor / insurance) via `useFormData`; defaults in `ehr/src/Scheduling/util/SchedulingUtil.tsx` (`INIT_DEMO/GUARANTOR/INSURANCE_FORM_VALUES`).
- Submit: `handleSaveChanges` calls `updateDemographics` / `updateGuarantor` / `updateEncounterInsurance` only when the respective `isXxxChanged()` is true; after all succeed → `setPatDetailsEdit(false)` + toast + `getPatApptData` refresh + `refetchDemoData/enounters`.
- Validation: `isCheckInFormValid` / `isAdmitFormValid` (in `SchedulingUtil`).