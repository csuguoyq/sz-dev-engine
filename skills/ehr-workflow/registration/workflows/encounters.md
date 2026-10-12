# Encounters (Create / Edit / ADT actions / Check-in-out / Print)

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves the **Encounters** tab (patient-tab page index 4) — creating an encounter, editing one, ADT movements (admit/transfer/discharge), ambulatory check-in/check-out, or the encounter print actions.

## Entry

- Encounters is a per-patient sub-tab of the patient-tab opened in `Registration`. As with other sub-tabs, it is **hidden from the accessibility snapshot until selected** — reach it with the same side-effect script used for Guarantors/Scheduling (see `workflows/guarantors.md`, Entry note): match `/encounter/i` on `document.querySelectorAll('[role=tab], .MuiTab-root')` and `.click()`, then re-snapshot to confirm.
- `EncountersSubTab.tsx` renders:
  - `PatientHeader` (top).
  - Toolbar **"Create New Encounter"** button — `data-testid="encounters-new-encounter-button"`, wrapped in `WithPermissions` `VPERMS.CENC`; `disabled` when read-only (`!useCheckAppPermission("REGISTRATION","W").data`) or while editing an existing encounter that has no `selectedId`.
  - A `CardGrid`: **left** = `EncountersTableSection` (three tables), **right** = `<EncounterForm />`.

## Table structure (left side)

`EncountersTableSection.tsx` renders three `CciCard`s, each an `EncountersTable`:

| Card | Query | Columns |
|---|---|---|
| Active Encounters | `useGetActiveEncounters(regid)` | `ENCOUNTER_COLUMNS` |
| Scheduled Encounters | `useGetScheduledEncounters(regid)` | `ENCOUNTER_COLUMNS` |
| Historic Encounters | `useGetHistoricEncounters(regid)` | `HISTORIC_ENCOUNTER_COLUMNS` |

All three hooks derive from `useGetEncountersQuery(regid)` (`util/DataHooks.tsx`); `ENCOUNTER_COLUMNS` / `HISTORIC_ENCOUNTER_COLUMNS` live in `constants/encounters.ts`. Clicking a row calls `wrapNavigation(() => { setSelectedId(row.encounterId); setIsEditing(false); })` via `encounterSelectedIdAtomFamily(regid)` / `encounterEditingAtomFamily(regid)` — that loads the encounter on the right. (Auto-select also fires when `cci.encounterId` is set.)

## Create New Encounter

1. Click **Create New Encounter** (`encounters-new-encounter-button`) → sets `selectedId=null`, `isEditing=true` → form shows `EncounterBlankForm` then `EncounterDynamicForm` (seeded from `INIT_ENCOUNTER_DYNAMIC_FORM_VALUES`).
2. Pick **`type`** (encounter type) and **`status`** — both required and gate Save: `firstFormStage = !formData.type || !formData.status`. Type/status also drive the patient-class split (below).
3. Fill required fields; validation runs through `getEncounterFormValidator` (`util/Validation.tsx`) using `ENCOUNTER_FORM_CONFIG` (+ `ENCOUNTERS_FORM_LAYOUT` for layout).
4. Click **Create Encounter** (`data-testid="encounters-form-save-button"`, `onSave`) → `useEncounterMutation(regid, selectedId=null, actionName=ENCOUNTER_ACTION_LABELS.CREATE ("CENC"), editingDT=null)` → on success selects the new id, refetches, and toasts **"Encounter Created"**. Cancel = `data-testid="encounters-form-cancel-button"`.

## Automated creation (Playwright recipe)

> **Verified end-to-end 2026-09-09** against the SDMC demo portal (fbch19, `demo`/`123`). Drive it **through the Playwright MCP directly** (per AGENTS.md rule #4). Resolve the module URL + credentials first via the `browser-testing` skill — log on through the `Cps` entry, then open Registration and a patient per the `navigation` / `patient-search` skills.

**Prereqs:** patient opened in Registration; not editing an existing encounter. The Create button is gated by `VPERMS.CENC` and read-only `REGISTRATION` W.

**Steps (verified)**

1. **Open the Encounters sub-tab.** Click the tab — verified id `simple-tab-4` (also reachable via a side-effect `.click()` on the `/encounter/i` match, see `workflows/guarantors.md` Entry note). Confirm `data-testid="encounters-new-encounter-button"` appears.
2. **Create New Encounter** — click `encounters-new-encounter-button`. Sets `selectedId=null`, `isEditing=true`; the right card shows `EncounterDynamicForm`.
3. **Select a Facility FIRST.** `data-testid="encounters-facility-field"`. ⚠️ The **`type` field is disabled (`dependsOn: "facility"`) until a facility is chosen** — this is the #1 gotcha. Pick any facility (verified: "San Diego - Cove Community Hospital").
4. **Pick a `type`.** `data-testid="encounters-type-field"` (now enabled). ⚠️ **Outpatient types are ambulatory**: choosing one (e.g. "Ambulatory and Ancillary", "Outpatient …") switches the action button to **"Check In Patient"** and routes through the ambulatory check-in flow (separate required fields / editing state). To exercise the plain **"Create Encounter" (CENC)** flow documented here, pick an **Inpatient/ADT** type — verified: **"Inpatient Acute"**.
5. **`status`.** `data-testid="encounters-status-field"`. For ADT the form effect sets it to `Planned`; for ambulatory to `Arrived`/`Planned`. You may also pick one (e.g. `Arrived`/`Planned`). The action button stays disabled until `type`+`status` are set.
6. **Fill class-specific required extras.**
   - **ADT / Inpatient ("Create Encounter" path, verified fbch19 2026-09-09 + fbch34 2026-09-14):** required for save — **Admit Type** (`encounters-admitType-field`, e.g. **"Elective"**), **Expected Date/Time** (input `#encounters-expDatetime` — the `encounterDT` field; rendered while status ∉ Arrived/In Progress/Finished/In Error), and for any type other than **Non-Billable**: **Guarantor Type** (`encounters-guarantorType-field`) + **Guarantor** (`encounters-guarantor-field`, `dependsOn: guarantorType`). This matches `getEncounterFormValidator` (`util/Validation.tsx`): always gates on type/status/facility/encounterDT, plus guarantorType/guarantor when type ≠ NON_BILLABLE; `admitType` comes from the declarative required-fields seed. **Level of Care / Admit Unit / Room-Bed are NOT required at create time** — they only become required after **Admit** is clicked (`needsAdmitFields`, once admitTime is stamped). admitProvider / admitService / attendingProvider are optional at create time. (Department / apptProvider / reasonForVisit belong to the ambulatory path and are not required here.)
    - fbch34 verified option values (2026-09-14): facility **"San Diego Medical Center - Cove Community Hospital"** (the encounter details display it as **"San Diego - Cove Community Hospital"**); Guarantor Type **Entity** to Guarantor **"Mini Reg Guarantor"** (the only options for a fresh patient); Admit: Level of Care **Med-Surg**, Unit **PHASE2** (options: PHASE2 / 6C-DISCH), Room/Bed **PHASE2-Exam-1 / PH2-HD**, Admit Point of Origin **Home or Self Care**, Means of Arrival **Self**, HIPAA **Yes** (default).
    - fbch34 verified full-flow (2026-09-16, new patient → guarantor → encounter in one run): facility dropdown has **13** options (first = `San Diego Medical Center - Cove Community Hospital`); `type` options are exactly **Emergency / Observation / Clinic/Ancillary / Outpatient, Lab Specimen / Inpatient Acute** (pick **Inpatient Acute** for the plain CENC path); selecting the type auto-sets `status` to **Planned**; **Admit Type** options: Accident / **Elective** / Emergency / Labor and Delivery / Newborn (Birth in healthcare facility) / Routine / Urgent / Trauma Center. ⚠️ **Guarantor Type / Guarantor are context-dependent** — for a patient that already carries a **Self / Medical** guarantor, `encounters-guarantorType-field` offers **only `Medical`** (no `Entity`/`Person`) and `encounters-guarantor-field` then lists **that patient's own guarantor** (e.g. `Testbot_..., Auto`). The `Entity → "Mini Reg Guarantor"` pair therefore applies **only to a fresh patient with no guarantor**. Expected Date/Time: click `#encounters-expDatetime` (synthetic events), the picker **auto-fills now**, then click **OK** in `.MuiPickersLayout-root`.
   - **Ambulatory ("Check In Patient" path):** requires a Department (Clinic), an Appointment Provider, and often a Reason for Visit, and the check-in save is gated by the ambulatory editing state — fill those, then enable check-in editing, before saving.
7. **Save.** Click `data-testid="encounters-form-save-button"` — label is **"Create Encounter"** (ADT) or **"Check In Patient"** (ambulatory). → `useEncounterMutation(regid, null, "CENC" | "CHKIN", null)`. Cancel = `encounters-form-cancel-button`.
8. **Verify.** Success toasts **"Encounter Created"** (auto-dismisses — may be gone before you read it; rely on the persistent state below). The form then exits create mode: the save button disappears, an **edit (pencil) icon** `encounters-form-edit-icon` appears, and the form title reads **"<Class> Encounter - <Status>"** (verified: "Inpatient Encounter - Planned"). A **Planned** ADT encounter lands in the **Scheduled Encounters** table (not Active) with **Start Date/Time = the Expected Date/Time** entered above (verified: `Scheduled Encounters` row `09/16/2026 02:13` / `Inpatient Acute`; the Active table stays `None`).

> MUI `SingleDropdownMenu` tip: open the field, then click the `li[role=option]` whose text matches the target. Re-snapshot between steps that toggle hidden DOM.

> ⚠️ **Driving the encounter-form dropdowns safely (verified fbch34 2026-09-14):** a **real Playwright click on an MUI Autocomplete `input`** (type / admitType / facility / guarantorType / guarantor / levelOfCare / admitUnit / admitRoomBed) **reverts the whole Registration view to the bare Cps landing** — the patient tab and all form state are lost (happened twice). Drive these fields with a **synthetic dispatch protocol** instead:
> 1. On the field's `input`, dispatch `pointerdown` then `mousedown` then `pointerup` then `mouseup` then `click`, in order (use `window.PointerEvent` for the pointer* events, `window.MouseEvent` for the mouse* events), with `{bubbles:true, cancelable:true, view:window, button:0, clientX, clientY}` at the `getBoundingClientRect()` center.
> 2. The MUI `[role=listbox]` renders **with a delay** — it is NOT present in the same evaluate. In the **next** evaluate call, find `[role=listbox] li[role=option]` by exact text and `.click()` it (a `li` click is safe — no navigation).
> 3. React text/date inputs: set via `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set` + `dispatchEvent(new Event('input',{bubbles:true}))`. For the MUI read-only date picker (Expected Date/Time): click the input, the picker auto-fills now, then click **OK** in `.MuiPickersLayout-root`.
> Non-Autocomplete elements (rail links, MUI table rows, plain buttons, `li[role=option]`) are fine with synthetic `.click()` or real Playwright clicks.

## Patient-class split (Outpatient vs Inpatient / ADT)

`getPatientClassName(patientClass, isADT)` (`util/helpers/EncountersHelpers.tsx`) classifies the form:

- `NON_BILLABLE` → `"Non-Billable"`
- `INPATIENT` → `"Inpatient"`
- ADT movement (`patientMovement === ADT`) → `"Inpatient Style"`
- else → `"Outpatient"` (ambulatory)

This decides which right-side form renders (`EncounterForm.getFormContent`):

- **Outpatient (`isAmb`)**: `AmbEncounterForm` with separate **Check In** / **Check Out** sub-flows and an `AmbEncounterBottomBar`.
- **Inpatient / Inpatient-Style**: `EncounterDynamicForm` (edit) or `EncounterDynamicSummary` (view) + `EncounterFormDetails` (Admit / Transfer / Discharge).

## ADT actions (Inpatient / Inpatient-Style)

- `EncounterFormDetails.tsx` exposes **Admit / Transfer / Discharge** via the `detailEditing` state (`ENCOUNTER_ACTIONS.ADMIT` / `TRANSFER` / `DISCHARGE`). The edit pencil — `data-testid="encounters-form-edit-icon"`, `WithPermissions` `VPERMS.EENC` — calls `setEditingMode`.
- Each action stamps a time (`serverNow`) when missing, and **requires an order** when `adtOrderRequired` and `(isDischarge || isTransfer)` and not editing — otherwise `missingOrder` makes Save disabled (`isEmergencyToEmergency` exempts transfers).
- Submit label comes from `ENCOUNTER_DETAIL_LABELS` ("Admit/Transfer/Discharge Patient"). Save → `useEncounterMutation(...)` with `actionName` = `"ADMIT"`/`"TRANSFER"`/`"DISCH"`. Toasts: "Patient Admitted/Transferred/Discharged".
- **Edit ADT History** (`VPERMS.EADT`): open the "more" menu (`data-testid="encounters-more-options-icon"` → `data-testid="encounters-more-menu"`) → `ADTHistoryEditDialog` (`ADTHistoryEditDialog.tsx`).

### Admit an inpatient encounter — verified browser recipe (2026-09-14, re-verified 2026-09-16, fbch34)

> Verified end-to-end 2026-09-14 on SDMC `fbch34` (`demo`/`123`, displays as **DRR, Darwin R**): a planned **Inpatient Acute** encounter was admitted and moved from **Scheduled** to **Active Encounters** with status **In Progress**. **Re-verified 2026-09-16** as the tail step of the one-shot new-patient → guarantor → encounter run (same host, same encounter helper).

**Prereqs:** patient opened in Registration; a **Planned** Inpatient encounter exists (per the create recipe above); the encounter row is open on the right.

**Steps (verified):**

1. **Open the encounter row** in the Scheduled Encounters table (`tr:has-text("<Encounter Type>")`) — right panel shows **"<Class> Encounter - Planned"**. (Right after creating the encounter the form is already loaded on it, but re-selecting the row re-runs `setSelectedId` + `setIsEditing(false)` and is harmless.)
2. Click **Admit** (bottom action button; the `detailEditing` ADT action) — the **Admit Details** section expands for editing. Verify the action buttons are exactly **`Admit Patient`** + **`Cancel`**.
3. Fill Admit Details (use the synthetic dropdown protocol above for every field — real clicks break the screen). ⚠️ Filling order matters because of the `dependsOn` chain: **Point of Origin / Means of Arrival → Level of Care → Admit Unit → Room/Bed**:
   - **Admit Point of Origin** (`encounters-admit-admitPointOfOrigin-field`) — e.g. **Home or Self Care** (fbch34 options, 15: Home or Self Care / Non-Health Care Facility / Clinic or Physicians Office / Hospital / SNF, ICF or ALF / Another Health Care Facility / Court/Law Enforcement / Information Not Available / One Distinct Unit to Another Distinct Unit of the Same Hospital / Ambulatory Surgery Center / Hospice Facility / Designated Disaster Alternate Care Site / Born Inside This Hospital / Born Outside of This Hospital / From Accident/Emergency Department).
   - **Means of Arrival** (`encounters-admit-meansOfArrival-field`) — e.g. **Self** (fbch34 options: Ambulance / Relative / Police / Self / Other).
   - **HIPAA** consent (`encounters-admit-hipaaConsent-field`) — ⚠️ **correction (2026-09-16): it does NOT default to `Yes`.** Left untouched its raw input value is **`1`**, which is **recorded as `No`** in the admit summary (verified). **Explicitly select `Yes` if consent is required**, and always confirm the real value from the Admit Details **summary** after admit (see step 5).
   - **Level of Care** (`encounters-admit-levelOfCare-field`) — e.g. **Med-Surg** (fbch34 options: Coronary Care (CCU) / Emergency / Intensive Care / Med-Surg / NICU / Newborn Nursery / Surgical).
   - **Admit Unit** (`encounters-admit-admitUnit-field`) — `dependsOn` Level of Care (e.g. **PHASE2**; fbch34 options: PHASE2 / 6C-DISCH).
   - **Room/Bed** (`encounters-admit-admitRoomBed-field`) — `dependsOn` Admit Unit (e.g. **PHASE2-Exam-1 / PH2-HD**; for unit PHASE2 this is the only option).
   - Special Accommodation Code (`encounters-admit-specialCode-field`) — optional.
4. Click **Admit Patient** (the ADT submit label) → `useEncounterMutation(... actionName="ADMIT")` → toast **"Patient Admitted"**; the encounter moves to **Active Encounters**, status **In Progress**, and the bottom actions become **Transfer** + **Discharge**.
5. **Verify (2026-09-16):** after admit, the Admit Details inputs are replaced by **read-only summary nodes with `data-testid="encounters-admit-<field>-summary"`** (note the `-summary` suffix, and there are **no** `<input>`s) — read their `textContent` to confirm e.g. `admitTime` = server-now, `admitPointOfOrigin` = Home or Self Care, `meansOfArrival` = Self, `levelOfCare` = Med-Surg, `admitUnit` = PHASE2, `admitRoomBed` = PHASE2-Exam-1/PH2-HD. Persistent success state: form title flips to **"Inpatient Encounter - In Progress"**, the **Scheduled Encounters** table reads **`None`**, the row appears in **Active Encounters**, and the bottom actions are **Transfer** / **Discharge**. (The `Patient Admitted` toast auto-dismisses, so this persistent state is the reliable check.)

### Discharge an inpatient encounter — verified browser recipe (2026-09-14, re-verified 2026-09-17 on `fbch34`: "Order in Place" + auto-filled `09/16/2026 20:16` / `Home or self-care` from an Active OE DISCHARGE order, Save enabled, encounter moved Active → Historic with End Date/Time)

> Verified end-to-end 2026-09-14 on SDMC `fbch19` and re-verified on `fbch34` (`demo`/`123`, displays as **DRR, Darwin R**), inpatient encounter `Inpatient Acute` / unit `PHASE2` / bed `PHASE2-Exam-1/PH2-HD`. Drive it **through the Playwright MCP directly** (AGENTS.md rule #4), after opening the patient per `patient-search.md` (click the patient-name `<A>` link) and placing an **Active DISCHARGE order** in OE first (see `ehr-workflow/oe/workflows/creating-an-adt-order.md`).

**Prereqs:**
- Patient opened in Registration (per-patient tab strip visible).
- An **Active DISCHARGE order** exists for this patient (placed via OE). The Discharge action is order-gated: when `adtOrderRequired && isDischarge && !editing`, a **missing order disables Save** (`missingOrder`). The recipe below shows the satisfied path ("Order in Place").
- The Discharge / Transfer buttons are the `detailEditing` ADT actions, gated by `VPERMS.EENC`.

**Steps (verified):**

1. **Open the Encounters sub-tab** — click the **Encounters** sidebar tab (verified id `simple-tab-4`; also reachable via a side-effect `.click()` on the `/encounter/i` match, see `workflows/guarantors.md` Entry note). Confirm the three tables render: **Active / Scheduled / Historic Encounters**.
2. **Open the active encounter.** The Active Encounters table is a MUI `MuiTableRow-root cci-data-table-styled-row`. Click the row → `wrapNavigation(() => { setSelectedId(row.encounterId); setIsEditing(false); })` loads it on the right. Reliable Playwright selector: `tr:has-text("<Encounter Type>")` — e.g. `tr:has-text("Inpatient Acute")`. (Do **not** rely on a generic `tr.x-grid-row`/double-click heuristic — the grid is MUI, not ExtJS.)
3. The right panel shows **"<Class> Encounter - In Progress"** with **Encounter Details**, **Admit Details**, and **Discharge Details**, plus bottom **Transfer** and **Discharge** buttons. Click **Discharge** (`button:has-text("Discharge")`).
4. The Discharge Details section expands. With an Active Discharge order present it shows a **"Order in Place"** status line; **Discharge Date/Time** (`input#encounters-discharge-dischargeTime`) is **auto-filled with now**, and **Disposition** (`input#encounters-discharge-dischargeDisposition`) is **auto-filled from the order** (verified: `Home or self-care`). No manual entry needed when the order supplies these.
5. Click **Discharge Patient** (`button:has-text("Discharge Patient")`) → `useEncounterMutation(... actionName="DISCH")`.
6. **Verify:** the panel now reads **"Patient Discharged"**; **Encounter Status → Finished**; **Discharge Details** records Discharge Date/Time + Disposition; the encounter moves from **Active** to **Historic Encounters** (a new Historic row gains an **End Date/Time**), and the **Active Encounters** table reads **None**.

> **Gotcha — order requirement:** if no Active Discharge order exists, step 4 will NOT show "Order in Place" and the Discharge Patient save stays disabled. Place the DISCHARGE order in OE first (the order's Disposition value is what auto-populates the encounter Disposition here). This is why the discharge workflow is two-step: OE order → Registration discharge.

## Ambulatory Check-In / Check-Out (Outpatient)

- `AmbEncounterForm` drives `isCheckinEditing` / `isCheckoutEditing` and its own `AmbEncounterBottomBar` (configured via `handleSetAmbSaveButtons`).
- **Check-in** → `handleCheckInSave` → `useAmbEncounterMutation(regid, encounterId, encounterDBPath, checkInActionName)` where `checkInActionName` is `"CHKIN"` (or `"EENC"` when changing an in-progress encounter). Writes `checkinTime`, `checkinLocation`, `checkinRoomNumber`, and `checkInEncStatus` (Planned / No Show / Cancelled / In Progress).
- **Check-out** → `handleCheckOutSave` → `useAmbEncounterMutation(... checkOutActionName)` (`"CHKOUT"` / `"EENC"`) with `checkoutTime` + `dischargeDisposition`.
- On check-in, location/room are read back from the appointment via `getAppointmentByDbpath`.

## Print actions (more menu)

`encounters-more-options-icon` → menu: **Print Wristband** (`WristbandPrintDialog`), **Print Registration Label** (`RegLabelPrintDialog`), **Print FaceSheet** (`print/printReg` → `encounter.json`), **Print Detail Bill** (`print/printDetailBill` → `detailBill.json`; warns "No charge data to print!" when only one BNR nit). ADT-only items are gated by `isADT`.

## Patient Portal (on Admit)

If `cci.cfg.bWantPatientPortal` and it is an ADT admit with portal status not `Active`/`OptedOut`, clicking save opens `PatientPortalSignUpDialog` (Opt Out / Defer / Send Invite). Toasts reflect "Patient Admitted, Invite Sent" / "Patient opted out from portal" / "Patient enrollment deferred".

## Permissions

- `CENC` (create), `EENC` (edit), `EADT` (edit ADT history). Read-only gate: `useCheckAppPermission("REGISTRATION", "W")`.

## Key symbols

- **Atoms** — `state/atoms/encounters.ts`: `encounterSelectedIdAtomFamily`, `encounterEditingAtomFamily`, `openRegLabelDialogAtom`, `encounterTablePagesAtomFamily`.
- **Constants** — `constants/encounters.ts`: `ENCOUNTER_ACTIONS`, `ENCOUNTER_STATUSES`, `ENCOUNTER_FORM_CONFIG`, `ENCOUNTERS_FORM_LAYOUT`, `ENCOUNTER_DETAILS_FORM_CONFIGS`, `ENCOUNTER_ACTION_LABELS`, `ENCOUNTER_DETAIL_LABELS`, `ENCOUNTER_COLUMNS` / `HISTORIC_ENCOUNTER_COLUMNS`, `INIT_ENCOUNTER_DYNAMIC_FORM_VALUES`, `INIT_PATIENT_DETAILS_DYNAMIC_FORM_VALUES`, `ADT` / `OUTPATIENT` / `INPATIENT` / `NON_BILLABLE` / `EMERGENCY` / `LOCATIONLABELS`.
- **Data** — `util/DataHooks.tsx`: `useGetActiveEncounters`, `useGetScheduledEncounters`, `useGetHistoricEncounters`, `useGetEncountersQuery`, `useGetEncounter`, `useGetEncounterTypes`, `useGetEncounterOrdersQuery`, `useGetLevelOfCareChoicesQuery`, `useGetConvertEncounterFunction`. `util/QueryHooks.tsx`: `useEncounterMutation`, `useAmbEncounterMutation`, `usePatientDemoMutation`, `useGetBNRsQuery`.
- **Helpers** — `util/helpers/EncountersHelpers.tsx`: `getPatientClassName`, `isEmergencyToEmergency`, `getDepartmentName`, `preparePatientWristbandData`, `getEncounterIdFromDBPath`.
- **Validation** — `util/Validation.tsx`: `getEncounterFormValidator`.
- **Types** — `types/encounters.ts`: `EncounterDynamicFormValues`, `EncounterRowDisplayType`, `AdmitDynamicFormValues`, `TransferDynamicFormValues`, `DischargeDynamicFormValues`, `PatDetailsDynamicFormValues`, `EGroup`, `EncounterTypeInfo`.
