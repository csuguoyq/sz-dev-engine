# Create New Patient (detailed)

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file only when your task involves **creating a new patient**.
> The full flow lives in `ehr/src/Registration/components/demographics/CreatePatientDialog.tsx`. Use these steps to create a patient programmatically or verify the flow.

1. **Prerequisite — fill the search form first (hit Search gating)**: The **Create New Patient** button is **disabled** until the search form (`patientLookupFormAtom`) is dirty and valid. In `PatientSearchPage.tsx`, `disableButtons = isReadOnly || !isSearchFormDirty || !isValid`, where `isSearchFormDirty` means any search field is non-empty and `isValid` is determined by `getQueryMsg` (see `patient-search.md` §"Search gating"). The button only becomes clickable once the criteria are **valid**:
   - **✅ Preferred: fill `mrn` first.** MRN is a **primary criterion**, so a **single** MRN value already makes the query valid — no need to fill anything else. This is the most reliable way to enable the button.
   - Other primary criteria behave the same: `ssn`, `visitNumber`, `hospitalAccountNumber` (any single one suffices).
   - Otherwise (no primary criterion) a valid query needs **at least 3 secondary criteria** out of `lastName`, `firstName`, `dateOfBirth`, `phoneNumber`, `gender`. ⚠️ Filling only `lastName` + `firstName` (2 fields) is **not enough** — the search screen shows **"Minimum Search Criteria Not Met"** and the button stays disabled. ⚠️ Also note the search `dateOfBirth`/`phone` fields are **MUI date/mask widgets that may not pick up plain-typed text reliably** (plain `browser_type` often won't land in the atom), so prefer MRN over trying to reach 3 secondaries.
   - The search values also **seed the Create Patient modal** (see step 2 below), so filling lastName / DOB in the search form pre-fills those fields in the creation dialog.

2. **Entry**: Once the button is enabled, click **Create New Patient** → `PatientSearchPage.handleNewPatientClick` → opens the modal via `createPatientModalOpenAtom` (`@cci-monorepo/Registration/state/atoms/demographics`).
3. **Form shape**: a `DynamicForm` with **3 stacked sections** — Basic Information / Address / Additional Details — columns built by `util/helpers/patientHelpers.ts` `buildCreatePatientColumns(combinedConfig, requiredFields)`; configs/consts from `constants/demographics.ts` (`INIT_DEMO_FORM_VALUES`, `DEMOGRAPHICS_FORM_CONFIG`, `DEMOGRAPHICS_COMPONENT_MAP`, `CREATE_PATIENT_SECTIONS`).
4. **Seeded values**: each time the modal opens it re-seeds from the patient-search form: `firstName, lastName, dateOfBirth, sex, ssn` (see `seededValues`).
5. **Required fields are dynamic**: fetched via `useGetConfQuery({ getdemographicsdefaults: 1, getssnplaceholders: 1 })` → `requiredDynamicFields`; placeholder SSNs (`ssnPlaceholders`) are excluded from the duplicate check. Only the fields the modal renders participate in validation/gating (`modalFieldSet`).
6. **Validation / gating**: `validateDemoFormState` + `getDemographicsValidationRules()` (merged via `getDemographicsValidationRulesWithConfig`) + async state/zip check (`validateZipcodeAsync`, `useDebouncedValidation`). `canCreate = Object.keys(formErrors).length === 0`.
7. **Duplicate state**: a full (11-char) non-placeholder SSN triggers a live lookup via `useGetDuplicatePatientQuery` → matched SSN **blocks** create and opens `DuplicatePatientDialog`. On submit, a server `hasduplicatessn` also hard-blocks; `hasduplicate` (non-SSN) is a soft warning that lets the user force-create via `savePatientDemoAsyncNoDuplicate` (skipDuplicateCheck).
8. **Submit** (`onCreate`): `usePatientDemoMutation("")` → `REG_ACTIONS.CPAT` → `doRegAction(CPAT, { ...convertDemoDataToDB(regid, formData, init), skipDuplicateCheck, patientIsJDoe })`. The CPAT response is parsed from `resp.Result[0].jresult[CPAT]`.
9. **Success** (`openNewPatient(newRegId)`): success toast **"Patient Creation Successful"** → `openPatientTab({ label, regid })` (opens a new tab) → `setPageIndexByRegId(newRegId, PAGE_INDICES.DEMOGRAPHICS)` → lands on the new patient's **Demographics** page; modal closes & form resets.
10. **Permissions**: `REGISTRATION` "W" gates read-only on the modal; the Create button is additionally guarded by `WithPermissions perms={[VPERMS.CPAT]}`.

> The patient created here seeds the appointment flow (`appointment-creation.md`) and the `ehr/src/Scheduling` calendar.

---

## ⚡ Speed-up recipe (verified end-to-end)

Use this concrete field bundle to create a patient in the least number of browser actions. All values below are confirmed to pass validation and create successfully.

**Step A — hit Search gating fast**
1. In the search form, fill only the **MRN** field (a primary criterion): `mrn = 90001`. The search screen then flips from *"Minimum Search Criteria Not Met"* to *"No results have been found…"* — that is the signal the **Create New Patient** button is now enabled. (Do not bother typing lastName/firstName/DOB — they don't seed the modal from an MRN-only search anyway.)

> **Browser automation gotcha — MRN field is a MUI TextField, not a plain `<input>`** (verified):
> The MRN field is rendered by `PatientSearchForm.tsx` → `InputField` (from `ehr/src/common/mui-components/src/components/inputfields/InputField.tsx`), which wraps a styled MUI `TextField`. The `data-testid="sf-mrn-tf"` lands on the MUI `TextField` **root `div`**, not on the inner `<input>`. In the accessibility snapshot this `div` appears as a generic element (not a `textbox`), so `browser_type`/`browser_fill_form` targeting it can fail with "not a text input".
>
> **Reliable fill method**: use `browser_evaluate` to locate the inner `<input>` via CSS and set its value through React's native value setter (React overrides the `value` property, so a direct `.value =` assignment won't trigger `onChange`; note the trailing bare `el?el.value:'not found'` needs an explicit `return` or the `() => {...}` body yields `undefined`):
> ```js
> var el=document.querySelector('[data-testid="sf-mrn-tf"] input');if(el){var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(el,'90001');el.dispatchEvent(new Event('input',{bubbles:true}));}return el?el.value:'not found'
> ```
> After this, re-snapshot to confirm the **Create New Patient** button is enabled (the form becomes dirty → `disableButtons` flips to false).
>
> **Same pattern applies to all search form fields** (`sf-last-name-tf`, `sf-first-name-tf`, `sf-dob-field`, `sf-phone-number-field`, `sf-mrn-tf`, `sf-visit-number-field`, `sf-ssn-tf`) — they all use the same `InputField` component. Always query `[data-testid="..."] input` to reach the real input element.

> **⚡ Browser automation efficiency — combine steps to avoid round-trip latency** (verified):
> Each `browser_*` MCP call (e.g. `browser_evaluate`, and any browser sub-agent tool call) has round-trip context overhead. Splitting the patient creation flow into separate calls (navigate → fill MRN → click Create → fill form → submit) wastes time on re-establishing context between calls. Instead, **do as much as possible in a single `browser_evaluate` body**:
> - In one call: navigate → click Registration → fill MRN via the `browser_evaluate` setter script → click **Create New Patient** → fill all form fields → submit.
> - Do **not** pause to verify intermediate states (e.g. "is the button enabled?") — just proceed to the next action. If an action fails, the agent will report the error.
> - Reserve re-snapshots for after **major state transitions** (dialog opened, form submitted) — not after every single field fill.

**Step B — open the modal & fill the form**
2. Click **Create New Patient** (toolbar icon near *Quick Reg*). ⚠️ After the dialog is up, re-snapshot — the search page behind re-renders and the dialog fields get stable refs; the toolbar buttons (`Create New Patient`/`Quick Reg…`) still appear in your snapshot but the *real* dialog form starts at the "Create New Patient" heading.

3. Fill these **required** fields (leave optional/advanced fields empty):

> **Dialog fields are also MUI TextFields** (verified): the Create New Patient dialog uses `DynamicForm` → `DynamicFormComponent` (`ehr/src/common/components/forms/DynamicFormComponent.tsx`), which renders TEXT-type fields via `InputField32` (another MUI `TextField` wrapper from `ehr/src/common/mui-components/src/components/inputfields/InputField32.tsx`). The `data-testid` is generated as `create-patient-{fieldName}-field` (e.g. `create-patient-firstName-field`, `create-patient-lastName-field`, `create-patient-address1-field`, `create-patient-city-field`, `create-patient-zip-field`, `create-patient-ssn-field`) and land on the wrapper `div`, **not** the inner `<input>`. Use the same `browser_evaluate` + React value setter pattern as the search form. Fill all TEXT fields in a **single** `browser_evaluate` body to minimize round-trips (trailing `out.join(', ')` needs an explicit `return`, else `undefined`):
> ```js
> var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;var out=[];[['create-patient-firstName-field','Auto'],['create-patient-lastName-field','Testbot'],['create-patient-ssn-field','345-67-8902'],['create-patient-address1-field','123 Main St'],['create-patient-city-field','San Diego'],['create-patient-zip-field','92101']].forEach(function(p){var el=document.querySelector('[data-testid="'+p[0]+'"] input');if(el){setter.call(el,p[1]);el.dispatchEvent(new Event('input',{bubbles:true}));out.push(p[0]+':ok')}else{out.push(p[0]+':miss')}});return out.join(', ')
> ```
> (Generate a fresh unique SSN per patient per the naming convention — the last 3 digits are a random serial, regenerated each time, e.g. `260-90-2001`.)

| Field | Value | Notes |
|---|---|---|
| First Name | `Auto` | TEXT field, `data-testid="create-patient-firstName-field"` |
| Last Name | `Testbot` | TEXT field, `data-testid="create-patient-lastName-field"` |
| D.O.B. | `MM/DD/YYYY` (year random) | **MUI X DatePicker** — see special handling below; pick a **random year** (e.g. 1990–2005), not a fixed one |
| SSN | `260-90-NNNN` (last 3 digits = random serial) | TEXT field, `data-testid="create-patient-ssn-field"`; mask `___-__-____`; **must be a fresh random value every patient** (naming convention: date-encoded SSN `260-90-2001`, last 3 digits random) or the `DuplicatePatientDialog` pops (see pitfall below) |
| Address | `123 Main St` | TEXT field, `data-testid="create-patient-address1-field"` |
| City | `San Diego` | TEXT field, `data-testid="create-patient-city-field"` |
| State | `CA` | **MUI combobox** → click it, then click the `CA` option (ZIP already hinted "Valid states for ZIP 92101: CA") |
| Zip Code | `92101` | TEXT field, `data-testid="create-patient-zip-field"`; auto-suggests the valid state for it |
| Country | `United States` | pre-filled default — skip |
| Citizenship | `US Citizen` | **MUI combobox** → click it, then click the `US Citizen` option |

> ### 📝 Test-data naming convention (hard constraint):
> - **Last Name** = `Testbot_YYMMDDHHmm` — current year+month+day+hour+minute suffix, e.g. `Testbot_2609021326` (created 2026-09-02 13:26). The timestamp makes each name effectively unique; if a duplicate is still hit (name+DOB), append/increment a serial.
> - **SSN** = `YY`+`MM`+`DD` + a random `NNN`, grouped **3-2-4** (mask `___-__-____` = 9 digits), e.g. today (2026-09-02) → `260-90-2NNN` (`26`+`09`+`02`+`345` → `260-90-2345`). The `NNN` (last 3) **MUST be random** — never reuse/increment, or duplicates recur; keep groups non-zero and avoid rejected patterns (`9XX-…`, `000-…`, `666-…`, `XX-00-…`, `XX-XX-0000`). ⚠️ Never hand-write `YY-MM-NNN` (produces a 7-digit masque-failing value). Use this ready-to-run single-line script, then **read the field back** to confirm a full 9-digit value:
> ```js
> var now=new Date(),y=('0'+String(now.getMonth()+1)).slice(-2),d=('0'+String(now.getDate())).slice(-2),yy=String(now.getFullYear()).slice(2),nnn=String(Math.floor(100+Math.random()*900)),eight=yy+y+d+nnn,ssn=eight.slice(0,3)+'-'+eight.slice(3,5)+'-'+eight.slice(5),el=document.querySelector('[data-testid="create-patient-ssn-field"] input');if(el){var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(el,ssn);el.dispatchEvent(new Event('input',{bubbles:true}))};return JSON.stringify({eight:eight,ssn:el?el.value:null,done:!!el})
> ```
> After running, verify `done:true` and `ssn` matches `/^\d{3}-\d{2}-\d{4}$/`; if not (short/partial), regenerate before continuing.

> **⛔ D.O.B. field is a MUI X DatePicker — `browser_evaluate` + React value setter does NOT work** (verified):
> The D.O.B. field is rendered by `DynamicFormComponent` → `CciDatePicker` (`ehr/src/common/mui-components/src/components/datepickers/CciDatePicker.tsx`), which wraps MUI X `DatePicker` from `@mui/x-date-pickers`. The `onChange` callback receives a `Date | null` object, not a string. Setting the inner `<input>`'s `.value` via the React value setter + `input` event **does not trigger** the DatePicker's `onChange` — MUI X DatePicker has its own keyboard parsing layer that intercepts and validates input.
>
> **⚠️ Locate the real `<input>` by its `id`, not `data-testid`** (important) — the D.O.B. DatePicker input's `id` is `create-patient-dateOfBirth` (**no `-field` suffix**). Unlike the TEXT fields (which go through `InputField32` and get a `data-testid="create-patient-{name}-field"` on the wrapper div), `CciDatePicker` passes `id`/`name`/`className` to the DatePicker's inner `slotProps.textField` but does **not** forward `data-testid` — so `document.querySelector('[data-testid="create-patient-dateOfBirth-field"] input')` returns `null`. Reach the real input via `document.getElementById('create-patient-dateOfBirth')`.
>
> **⛔ There are TWO D.O.B. fields on screen — never type into the wrong one** (verified): the Registration **search form** also has a D.O.B. field (`data-testid="sf-dob-field"`), distinct from the **Create Patient dialog's** D.O.B. (`id="create-patient-dateOfBirth"`). Both are MUI date pickers with the same `__/__/____` placeholder, so an automation agent can easily focus/type into the search page's DOB while the dialog's is left empty. **Always target the dialog one by its `id`, and verify with `document.getElementById('create-patient-dateOfBirth').value` that the dialog input actually holds the value before submitting.**
>
> **✅ Fastest reliable method — select the date from the picker's calendar UI (verified)**:
> Selecting the date entirely from the DatePicker **calendar dropdown** is the only reliable automation path. Keyboard editing of the field is unreliable (verified: even individual digit `browser_press_key` keydowns into the focused year segment leave the value unchanged), so drive the picker's own month/day/year grids instead.
> 1. `browser_click` the D.O.B. **input itself** (`#create-patient-dateOfBirth`) to **open** the picker — ⚠️ there is **no separate "Choose date" button**: verified `document.querySelectorAll('button[aria-label="Choose date"]')` returns **0**. The `aria-label="Choose date"` sits on the **readonly `<input>`** itself (`id="create-patient-dateOfBirth"`, `readonly`, `Mui-readOnly`), and clicking that input is what opens the picker. It opens in **calendar (month) view** on the current date (e.g. September 2026), and writes the **current date** (e.g. `09/09/2026`) into the input immediately.
>    - > ⚠️ **Verified (corrected 2026-09-09): the picker is a popper, NOT a `Select date` dialog.** It renders as `.MuiPickersLayout-root` (MUI X `DateCalendar` + action bar), **not** as `[role=dialog]` — so `document.querySelector('[role=dialog]')` resolves to the **Create New Patient modal** (buttons `Cancel` / `Create Patient`), not the picker. The picker's **OK / Cancel** buttons live inside `.MuiPickersLayout-root`. After choosing the year/month/day you **must click OK** (the `.MuiPickersLayout-root button` whose text is `OK`) to commit the value; the picker header shows the currently-selected date, so read it to confirm the correct year before pressing OK.
> 2. **Reach the year you want via the year view** (fastest way to land a random past year):
>    - `browser_click` the header toggle **"calendar view is open, switch to year view"** to enter the **year view** — a grid of `[role=radio]` buttons, one per year from **1899** up to the current year. ⚠️ It is a `button` **inside `.MuiPickersLayout-root`**; target it by matching `aria-label` containing `switch to year view` (verified: filter `.MuiPickersLayout-root button` on `aria-label`), not by a snapshot ref.
>    - Only the *focused* year is exposed as an interactive ref; the rest are not. So dispatch a programmatic click on the target year's radio by **index = year − 1899** with a single expression — e.g. for 1991: `document.querySelectorAll('[role=radio]')[92].click()` (index 92 = 1991). (⚠️ **Verified off-by-one: the year list starts at 1899, so the older `index = year − 1900` lands on the year BEFORE the one you want** — e.g. `1991−1900=91` produced `1990`. Use `year − 1899`, and confirm the target year in the dialog header after clicking.) (⚠️ The harness drops IIFEs, `for` loops, and `.map`/arrow chains — use a single bare-expression call only.)
>    - Clicking the year returns the picker to **month view for that year** and writes `MM/DD/YYYY` into the input (month/day still come from "today", e.g. `09/15/1991`); the header then reads e.g. `September 1991`.
> 3. **Optionally set the month/day:** in the month grid, `browser_click` the target **gridcell** (e.g. the "15" cell) — this sets the exact day (e.g. `09/15/1991`). In the picker **popper** the grid does **not** auto-close on day selection — click **OK** (inside `.MuiPickersLayout-root`) to commit the full date (per the step-1 note).
> 4. Confirm with `document.getElementById('create-patient-dateOfBirth').value` — it holds the real date and the "Date of birth is required." error disappears. Pick a **random year** (e.g. 1980–2005), not a fixed one.
>
> > **⚠️ Preferred: seize the auto-prefill, then just fix the year.** Because opening the picker already writes `MM/02/2026` (today) into the field, the minimum viable calendar-UI flow is: open picker → switch to year view → click a random past year (step 2). Adjusting month/day via gridcells (step 3) is only needed if you want a specific day.
>
> **⛔ NEVER press `Escape` to close the datepicker calendar** (verified): in a React MUI modal, `Escape` dismisses the **entire Create New Patient dialog**, discarding every field already filled (name/SSN/address/DOB…), and the subsequent read of the DOB element then throws "Script failed to execute" because the element is gone. To close or reopen the calendar, always **`browser_click` the D.O.B. input itself (`#create-patient-dateOfBirth`)** — it toggles the picker open/closed without touching the dialog. (There is no separate `Choose date` button — see the step-1 note.)

4. Sex is required too — **pick it RANDOMLY each time** (`Sex` **MUI combobox** → click it, then click the chosen option). Do **not** hardcode `Female`; randomly choose between `Female` and `Male` (e.g. coin-flip `Math.random() < 0.5 ? 'Female' : 'Male'`, or pick whichever of the two the browser randomly lands on). Never default to `Female`.

**MUI combobox interaction (Sex/State/Citizenship)** (verified fbch34 2026-09-16): the three comboboxes carry `data-testid="create-patient-sex-field"` / `create-patient-state-field` / `create-patient-citizenship-field` (wrapper `div`; the real `<input>` is inside). ⚠️ **Do NOT use a real Playwright click** on these — open each with the **synthetic dispatch protocol** (on the inner `input`, dispatch `pointerdown`→`mousedown`→`pointerup`→`mouseup`→`click` with `{bubbles:true,cancelable:true,view:window,button:0,clientX,clientY}` at the rect center; use `window.PointerEvent` for the `pointer*` events and `window.MouseEvent` for the `mouse*` events). The MUI `[role=listbox] li[role=option]` renders **with a delay**, so in the **next** evaluate call `.click()` the option whose text matches (State listbox has ~57 options incl. `CA`; Sex has `Male`/`Female`; Citizenship has ~4 incl. `US Citizen`). This is a two-step open / option-click, not `browser_type`/`browser_fill_form` — and it avoids the view-revert risk that real clicks carry elsewhere in Registration.

**Step C — submit**
5. Click **Create Patient** — `data-testid="create-patient-create-button"` (bottom-right of the dialog, distinct from the toolbar's "Create New Patient"; cancel is `create-patient-cancel-button`). Success → toast **"Patient Creation Successful"** (auto-dismisses) → dialog unmounts (`[data-testid="create-patient-firstName-field"]` gone) and the new patient's tab opens on **Demographics**.

**⛔ Pitfall — duplicate SSN**: typing an SSN that already exists (e.g. `123-45-6789`) triggers a live lookup and pops **`WARNING: DUPLICATE SSN`** (`DuplicatePatientDialog`, see step 7). Close it with **Cancel** (the one in the duplicate dialog, not the main dialog's Cancel), then change the SSN to a new unused value. If you type a new SSN while the warning was showing, that dialog stays resettable — re-snapshot to confirm no duplicate warning remains before submitting.

> **⛔ Duplicate detection also matches name+DOB, not just SSN** (verified): the live check flags an existing patient sharing the same **last name + DOB** (score-based, e.g. 4/6) and pops the same `DuplicatePatientDialog`, even with a brand-new SSN. Reusing an existing test name (e.g. `Testbot_0902002`) triggers it — always use a **unique** Last Name per patient (see the naming convention above), and verify no duplicate dialog remains before clicking Create Patient.

**⛔ Valid-SSN caveat**: `9XX-…`, `000-…`, `666-…`, `XX-00-…`, and `XX-XX-0000` patterns are rejected as "not real SSNs" (e.g. `999-00-0101` fails). Keep the middle/last groups non-zero.