# Entry & Patient Search

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves **entry / navigation / opening a patient / the search screen**.

## Entry & navigation

- `components/common/DynamicPages.tsx` renders the tab bar (`CciCloseableTab`), switches via `handlePageChange` → `wrapNavigation`. The first tab always shows `PatientSearchPage`.
- `util/appRoutingHooks.ts`: `routeToRegistration` opens registration (`apptext=REGISTRATION`, `click.conf=registration`) with an optional `page` param to deep-link into a specific tab; `useRouteToDemographics` / `useRouteToInsurance` are helpers for specific tabs.

### Opening a patient from search results

Registration defaults to the **Patient Record (search)** tab. The Demographics / Guarantors / Insurance / ... tabs only exist **inside a patient's tab** — you first open a patient from the search table, then those tabs appear in that patient's tab.

The **Patient Data** table (`components/search/PatientDataTable.tsx`) supports two ways to open a patient, both → `openPatientTab({ label, regid })` via `openPatientTabSetAtom` (`state/atoms/tabs`):
- **Double-click a patient row** → `handleDoubleClick` → `openPatientTab({ label: row.name, regid })` (`PatientDataTable.tsx`).
- **Click the Patient Name hyperlink** in the Patient Name column → `PatientNameCellRender.handleClick` → `openPatientTab({ label: value, regid })` (`PatientNameCellRender.tsx`).
- Note: the `onPatientSelect` callback (when provided externally, e.g. LISReview) takes precedence over the default open-tab behavior.
- The newly opened patient tab renders `components/common/PatientTab.tsx`, which holds the per-patient tab strip (Demographics, Guarantors, Insurance, Scheduling, ... see SKILL.md §3). Repeatedly opening the same patient focuses the existing tab rather than duplicating.

### Playwright: open the patient from the MUI results table — verified

The search results render as a **MUI table** (`MuiTableRow-root cci-data-table-styled-row`), NOT the old ExtJS `x-grid` grid. A generic `tr.x-grid-row` / row double-click heuristic does **not** open the record (the row click handler is wired to the row, but the most reliable and intent-matching target is the **patient-name hyperlink**).

- **Reliable:** click the **patient-name `<A>` link** inside the row. It is `a.MuiTypography-root.MuiTypography-inherit` whose text equals the patient name. The link is `PatientNameCellRender.handleClick` → `openPatientTab`.
  ```
  var as=document.querySelectorAll('a');var t=null;as.forEach(function(a){if(/<PATIENT_NAME>/.test(a.textContent))t=a;});if(t){t.click();return 'clicked';}return 'no-link';
  ```
  Replace `<PATIENT_NAME>` with the patient's full name (e.g. `Testbot_2609140137, Auto`). `playwright_click` with `a:has-text("<PATIENT_NAME>")` also works.
- Clicking the row container itself (`tr:has-text("...")`) loads the encounter list on the right in the Encounters tab, but to **open the Patient Record** (Demographics / Guarantors / Insurance / Scheduling / Encounters tabs) you must click the **name link** specifically.
- After clicking, re-snapshot: the page gains the per-patient tab strip (Demographics, Guarantors, Insurance, Scheduling, **Encounters**, Estimates, Accounts (BNR), ...) and the header shows the patient's name + DOB/SEX/MRN.

## Patient search (`components/search/`)

- `PatientSearchPage.tsx` is the search gateway. Actions: `handleNewPatientClick` (create → `patient-creation.md`), `handleQuickRegForNewPatientClick` (quick reg → `minireg-unknown.md`), `handleQuickRegForUnknownPatientClick` (anonymous → `minireg-unknown.md`).
- UI: `PatientSearchForm` (criteria incl. `patientLookupFormAtom` from `state/atoms/patients`), `PatientDataTable` (results), `NoResultMsg` / `NoResultMsgHideCreatePatient`, `ClearFieldsButton`, `MinCriteriaMsg`, `NoQueryMsg`.
- Search triggers `registration/...` queries in `util/QueryHooks.tsx` (debounced via `PatientSearchForm`).
- The search fields seed the Create New Patient modal on open (`seededValues` in `CreatePatientDialog`).

### Search gating (what counts as a valid query)

Determined by `getQueryMsg(searchValues, pageNum, pageSize)` in `util/helpers/patientHelpers.tsx` (validity only — read-only is handled separately). Run against the trimmed value of each field:

- **Primary criterion**: any of `mrn`, `ssn`, `visitNumber`, `hospitalAccountNumber` is non-empty. **MRN alone is valid** — note `parseSearchValues` only `trim()`s and treats `"0"` as truthy, so typing `0` into MRN counts as a primary criterion (this is the "MRN=0 trigger" the UI uses).
- **Otherwise (no primary criterion)**, a valid query needs **at least 3** secondary criteria out of `lastName`, `firstName`, `dateOfBirth`, `phoneNumber`, `gender`.
- `< 3` secondary → `MinCriteriaMsg` (invalid); zero → `NoQueryMsg` (invalid).

### Searching for a known patient (the "lastName + MRN=0" trick) — verified

When you need to **locate a specific existing patient by name** (e.g. to open them and create an appointment) and you do **not** know their real MRN/SSN, do **not** fill only `lastName` — a lone lastName (<3 secondaries, no primary) makes the query invalid and the search returns nothing. Instead:

- Fill **Last Name** with the patient's name, **and** put **`0`** in **MRN**.
- `"0"` in MRN satisfies the primary-criterion branch (truthy after trim), so the query is valid; the lastName narrows results to the target patient.
- This reliably returns the known patient (e.g. `Testbot_2609031421, Auto`) without needing a real MR number.
- **⚠️ Field layout & locating inputs (verified, `PatientSearchForm.tsx`):** the fields are laid out in a `Grid` row with `labelPosition="top"` — **each label sits above its own input**, and every field has a stable `data-testid` on the field/InputField wrapper. Do **NOT** locate an input by guessing from label text / placeholders — because the label sits above the input, a heuristic can put the value into the wrong field (e.g. writing `0` into First Name's input below a neighboring label). Use the exact testids instead:
  - Last Name field: `sf-last-name-tf` → its input is `[data-testid="sf-last-name-tf"] input`
  - MRN field: `sf-mrn-tf` → its input is `[data-testid="sf-mrn-tf"] input`
  - Others: `sf-first-name-tf`, `sf-dob-field`, `sf-gender-field`, `sf-phone-number-field`, `sf-visit-number-field`.
- **Reliable single-line fill for Last Name + MRN** (React native value setter, single-line ending in an expression, per `ehr-ui/browser-testing/SKILL.md`):
  ```
  var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;var out=[];[['sf-last-name-tf','<LAST_NAME>'],['sf-mrn-tf','0']].forEach(function(p){var el=document.querySelector('[data-testid="'+p[0]+'"] input');if(el){setter.call(el,p[1]);el.dispatchEvent(new Event('input',{bubbles:true}));out.push(p[0]+':ok')}else{out.push(p[0]+':miss')}});return out.join(', ')
  ```
  Replace `<LAST_NAME>` with the patient's last name. **After filling, verify via snapshot that `0` actually landed in the MRN field** (and the name in Last Name) before searching — catching a misplaced value early avoids a noisy retry.

### Create New Patient / Quick Reg enable

`PatientSearchPage` computes `disableButtons = isReadOnly || !isSearchFormDirty || !isValid`, where:
- `isReadOnly = !useCheckAppPermission("REGISTRATION", "W").data`
- `isSearchFormDirty = Object.values(patientLookupFormAtom).some(Boolean)` — any field non-empty
- `isValid = getQueryMsg(searchValues, 0, 0).valid`

So **Create New Patient** (and Search) enable as soon as the form holds valid criteria; they do **not** wait for a search to return. Quick Reg additionally requires `VPERMS.QREG`.