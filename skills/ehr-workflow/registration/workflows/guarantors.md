# Guarantors (Add / Create New / Save and Close)

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves the **Guarantors** tab, in particular the **create-guarantor** flow.

## Entry

`GuarantorsSubTab.tsx` renders a **"Guarantor Overview"** tab plus one tab per opened/created guarantor. A brand-new, unsaved guarantor tab is labeled **"New Guarantor"**. Each guarantor tab hosts `GuarantorForm.tsx`.

> **Navigating to the Guarantors tab (browser automation gotcha — verified working)**: right after **Create New Patient** lands you on the patient's **Demographics** sub-tab, the patient's other sub-tabs (**Guarantors**, **Scheduling**, Insurance, Diagnoses, Orders, …) are **not exposed as readable/clickable accessibility elements** — only the selected `Testbot, Auto` and `Demographics` tabs show. So you **cannot** `browser_click` them by a stable ref/selector. To switch, run a **side-effect** script via `browser_evaluate` that matches the tab text and clicks it (no return value needed — verify by re-snapshot):
>   `browser_evaluate("() => { ... document.querySelectorAll('[role=tab], .MuiTab-root') ... }")` → find the element whose `(t.textContent||'').trim()` matches `/guarantor/i` → `t.click()`. Then **re-snapshot** (don't rely on a return value — the script returns `undefined`) to confirm the **Guarantor Overview** sub-tab + `Add Guarantor` button appear before continuing.
>   Same technique targets the **Scheduling** sub-tab: match `/scheduling/i` and click. This is the reliable way to reach any patient sub-tab that's hidden from the accessibility snapshot.

The create flow (typical for a **new patient with no guarantor yet**):

1. On **Guarantor Overview** (`GuarantorOverview.tsx`) click **Add Guarantor** (`data-testid="guarantor-overview-add-guarantor-button"`, `setOpenAddGuarantorDialog(true)`).
2. **`AddGuarantorDialog`** opens. Choose a **Relationship to Patient** chip — **Self** is the default (index 0). `handleChangeRelationship` writes `addGuarantorDialogRelationshipToPatientFamily(regid)`.
3. The dialog shows **Search Existing Guarantors** (`GuarantorSearchForm` + `GuarantorsDataTable`). At the bottom of the results list there is a **`+ Create New Guarantor`** link (`GuarantorsDataTable.tsx`), which invokes the dialog's `onSave` → `openGuarantorTab(selectedGuarantor)` (`AddGuarantorDialog.tsx`). With no guarantor selected this opens a **new (empty) guarantor tab**, then closes the dialog.
4. You land on the **"New Guarantor"** sub-tab hosting `GuarantorForm`. For **Self**, the form **auto-populates from patient demographics** in an init effect (`GuarantorForm.tsx`): sets `guarantorType=["Medical"]`, `relationshipToPatient`=Self, copies name/DOB/SSN/phones/address/employer fields, `addressSameAsPatient=true`, etc. Non-Self person/entity also pre-fills from the dialog's search values.
5. Requi‌red validation / cross-field rules go through `util/Validation.tsx` + `validationRules/getMergedRules.ts`; `GuarantorForm` also runs a **duplicate** check on save (Self/entity handled via `useGuarantorMutation`).
6. Fill the required fields, then click **Save and Close** (toolbar `data-testid="guarantor-form-save-and-close-button"`) → `onSave!(onClose)` (`GuarantorFormToolbar.tsx`).
   - `useGuarantorMutation(guarantorId, regid)` → `saveGuarantorInfo` / `saveGuarantorNoDuplicate` → `postData("registration/saveGuarantorInfo", { ... })` (`util/QueryHooks.tsx`).
   - Success toast: **"Successfully created new Guarantor, and associated to Patient"**; the tab closes (`onCloseForm` filters it, `setSelectedTab(0)`).
  - ⚠️ **The toast auto-dismisses fast** (verified fbch34 2026-09-16) — it may already be gone when you read it. Confirm success by the **persistent state** instead: the `New Guarantor` tab disappears (text `New Guarantor` no longer present), `Guarantor Overview` returns, and a new row appears in the overview table (`Guarantor Name` = the patient name, `Guarantor Type` **Medical**, `Relationship To Patient` **Self**, `Status` **Active**).

## Other actions (overview / existing tabs)

- **Add existing Guarantor**: same dialog, but select a row in the results table (radio) then **Add Guarantor** → opens that existing guarantor's tab (associates it, toast "Successfully associated Guarantor with Patient").
- **Open existing**: click a row in the overview table (`onChangeSelection` → `openGuarantorTab(row.guarantorId)`).
- Toolbar also has plain **Save** and **Close**; **Save and Close** = `onSave!(onClose)`.

## Key symbols

- Atoms: `state/atoms/guarantors.ts` — `guarantorTabsAtomFamily`, `guarantorSelectedTabAtomFamily`, `guarantorOpenTabWriteOnlyAtomFamily`, `addGuarantorDialogRelationshipToPatientFamily`, `guarantorLookupFormAtomFamily(regid)`, `canAddGuarantorAtomFamily`.
- Constants: `constants/guarantors.ts` — `INIT_GUARANTOR_SEARCH_VALUES`, `MIN_GUARANTOR_SEARCH_QUERY_CRITERIA=3`, `INIT_PERSON_FORM_VALUES`, `INIT_ENTITY_FORM_VALUES`.
- Data: `useGetGuarantorInfoQuery`, `useGetGuarantorListQuery`, `useGetGuarantorsQuery`, `useGuarantorMutation` in `util/QueryHooks.tsx`; list columns in `util/DataAPI.tsx`.
- Permission: reads `useCheckAppPermission("REGISTRATION", "W")` (read-only); `canAddGuarantorAtomFamily` gates the dialog's Add button.