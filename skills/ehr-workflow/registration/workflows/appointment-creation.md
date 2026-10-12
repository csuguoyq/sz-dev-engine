# Creating an Appointment (Scheduling tab) — KEY cross-module prerequisite

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves **creating an appointment**, or when you need a clickable appointment to test `ehr/src/Scheduling`.
> **Appointments are NOT created inside `ehr/src/Scheduling` — they are created here, via the patient's Scheduling tab.**

- Entry: `SchedulingSubTab.tsx` loads `regid`, patient demographics, insurance, initializes the appointment form, then renders `SchedulingWorkflow` (left) + `BookingSummary` (right) + `ReferralDrawer`.
- Workflow: `SchedulingWorkflow.tsx` is a multi-step stepper driven by `stepIndexAtom` / `schedulingStepsCountAtom`. Form fields (see `INIT_APPOINTMENT_FORM_VALUES` in `constants/scheduling.ts`): `reasonForVisit`, `patientType` (New/Established), `apptType`, `apptFacility`, `clinic`, `apptSlots[]`, `contactMethod`/phones/`email`, `guarantorType`/`guarantor`, `coverageType` (Insurance/Self Pay), `insurance`.
- Appointment slots: `ApptDateCalendar.tsx` + `AvailableApptTimePanel.tsx` pick dates/times; `SchedulingHelpers.ts` (`util/helpers/SchedulingHelpers.ts`) computes a month's available dates and pushes to the first available date when the requested date is earlier.
- Submit: `handleCreateAppointment` → `useBookMultiApptsMutation(regid)` (`util/QueryHooks.tsx`) → `postData("ess/bookMultiApptsByEnterprise", { apptInfo })`. The patient payload is built by `Ess.Util.genFacilityIdByCampusClinic`, and each slot becomes `{provider, startTime, endTime, date, time, apptSlotTitle}`. On success: advances the step, toast **"Appointment Created"**, links any referral (`handleReferralLink`), resets the form, and prints a booking summary.
- Result: the appointment appears on the `ehr/src/Scheduling` calendar; you can then click it and run Check-in / Check Out / Reschedule.

> **For agents testing Scheduling**: to get a clickable appointment, do NOT create it inside `Scheduling` — create a patient (see `patient-creation.md`) + an appointment here first.

## Prerequisite: patient must have a guarantor

A newly-created patient typically has **no guarantor**. The appointment flow's **Guarantor panel** (`Scheduling/components/GuarantorPanel.tsx`) treats `guarantorType` and `guarantor` as **required** (built from `useGetGuarantorsQuery` in `PatientInfoCard.tsx`, choices via `getGuarantorTypes` / `getGuarantorChoices`). When the patient has no guarantor:

- The panel shows a **"No guarantor"** state (`NoGuarantorCard`) with an **"Add Guarantor"** action (`GuarantorPanel.tsx`).
- The `BookingSummary`'s `PatientInfoPanel` marks the Guarantor section **not complete** while `guarantorType`/`guarantor` are missing (`BookingSummary.tsx`).

So **before completing an appointment, first add a guarantor to the patient** — follow `guarantors.md` (Add Guarantor → Self → Create New Guarantor → Save and Close). Your newly-created Self guarantor then fills the appointment's guarantor field.

> Precision note: `bookMultiAppts` (the submit) does not itself hard-check for a guarantor; the requirement is enforced by the form's required guarantor panel and the BookingSummary completion state, which block a complete booking flow until a guarantor is present.

## Create workflow — Step 1 (Guarantor Information) is AUTO-POPULATED

Once the patient already has a guarantor, the Scheduling tab's **Step 1 of 4 "Guarantor Information"** is **pre-filled automatically** when the sub-tab loads:

- **Guarantor Type** → the created guarantor's type (e.g. `Medical`).
- **Guarantor** → the created self-guarantor (e.g. `Testbot, Auto`).
- **Selected Coverage / Insurance** → **Self Pay**.

> **Do NOT re-select the guarantor.** Just verify the fields are populated, then click **Continue** to advance to Step 2. (A **Patient Portal Sign Up** dialog may appear after Continue — choose "No, don't ask again" or fill per requirement.)
>
> Only when the patient has **no guarantor** would Step 1 show an **Add Guarantor** state that must be handled first (see prerequisite above).

## Create workflow — Step 2 (Reason for Visit & Appointment Type) and Step 3 (Select Location)

**Step 2 "Describe Reason for Visit & Select Appointment Type"** (gotcha): Continue stays **disabled** until an appointment type is chosen. In order:
1. Fill **Reason for Visit** (`Enter Reason for Visit`, e.g. `Establish Care` / `Annual Physical`).
   - > **⚠️ Embed a unique random token in the Reason for Visit so the created appointment is identifiable later.** Patient name, date/time and provider can all be identical across appointments (e.g. re-using the same patient + First Available Time), making it impossible to tell which block you created once those fields match. Append a timestamp token (e.g. `yyyymmddHHMMSS`) to the reason text, e.g. `Establish Care 20260903051205`. **Record the exact token before submitting.** Later you can read each calendar block's `tooltip` HTML attribute (on `div.ess-cal-day-evt-header`) which includes the Reason, and match the recorded token to **pre-select the exact block you created before opening** — see `scheduling/workflows/calendar-provider-clinic.md`.
   - > **⚠️ The Reason for Visit is filled at Step 2 of the booking stepper ("Describe Reason for Visit & Select Appointment Type"), which comes AFTER Step 1 "Guarantor Information".** Do NOT try to enter the reason token in Step 1 (Guarantor Information is only for guarantor/insurance fields). If your flow is multi-step, make the ordering explicit in the calling instructions: Step 1 Guarantor → Step 2 Reason + Appointment Type (enter the token here) → Step 3 Location → Step 4 Slot.
2. Choose **Patient is** → **New** or **Established** — **pick it RANDOMLY each time** (e.g. coin-flip `Math.random() < 0.5 ? 'New' : 'Established'`), **never default to `New`**. These two options appear **only after a Reason for Visit is entered**; if they are not visible yet, the reason was not registered — re-enter it.
3. **Only after `Patient is` is chosen** does the appointment-type list appear below. From the list under `Search Appointment Types`, **select an appointment type RANDOMLY from the available rows** (e.g. `Establish Care 30 min`, `Annual Physical`, etc.) — do **not** hardcode one appointment type. Only after a type is selected does **Continue** become enabled — this is what the Booking Summary shows under `Appointment Type`.
   - > **⚠️ Verified: the appointment-type list is a MUI `DataGrid`, and each option is a row `div.MuiDataGrid-row`** whose `textContent` concatenates the name+length with no space (e.g. `Establish Care 30 min` reads as `Establish Care30 min`). It is **not** a `[role=option]`/`li`/`button` set, so a `role=option`/exact-text selector won't match. Select randomly by filtering the rows on whitespace-stripped `textContent` and clicking a random match, single-line ending in a `return`:
   - ```js
     var types=['Establish Care 30 min','Establish Care 45 min','Establish Care 60 min','Referral 30 min','Referral 45 min','Referral 60 min'];var want=types[Math.floor(Math.random()*types.length)].replace(/\s/g,'');var rows=Array.from(document.querySelectorAll('div.MuiDataGrid-row'));var sel=rows.filter(function(r){return r.textContent.replace(/\s/g,'')===want})[0];var name=sel?sel.textContent.replace(/\s+/g,' ').trim():'NONE';if(sel)sel.click();return JSON.stringify({target:want,chose:name})
     ```
   - (Adapt `types` to the rows actually rendered — read them from the `Search Appointment Types` grid first; normalize by removing all whitespace on both sides of the comparison.)
4. Click **Continue**.

**Step 3 "Select Location / Select Facility"** (gotcha): Continue is **disabled** until both a **Facility** and a **Clinic** are chosen.
1. **Facility** (`Search Facilities`): pick a facility, e.g. **San Diego Medical Center**. Booking Summary then shows it under `Facility`.
2. **Clinic** (`Search Clinics`): pick a clinic, e.g. **Cove Community Hospital (COC)**.
3. Click **Continue** to Step 4 (Appointment Slot — date/time/ clinician).

**Step 4 "Appointment Slot"** — a calendar + time-slot grid appears. The time-slot list is **grouped by provider**: each provider's name is a header row, and the slots (`HH:00 - HH:30`) listed directly underneath it are the appointment times for **that** provider.
- By default **First Available Time** is auto-selected, which auto-picks the **first available slot of the first available provider**. In the common case you do **not** need to pick anything: just verify the **Create Appointment** button is **enabled**. **However, First Available Time is still a specific provider's slot** — you MUST determine which provider's timeline the auto-selected slot sits under (see the mandatory provider note below) and record it; you are never allowed to click Create without knowing the provider.
- Only if the test requires a **specific provider and time** do you pick them explicitly: choose a date on the month grid (today is pre-selected), then click the **time slot** button (`HH:00 - HH:30`) on the **target provider's timeline** in the list, and finally click **Create Appointment** (this submits `bookMultiApptsByEnterprise`).
- > **⚠️ MANDATORY — record the provider of the chosen time slot (even for First Available Time) BEFORE any submit.** **Reliable way to get the final provider: read the Booking Summary → "Clinician" field** (the `AppointmentPanel` in `BookingSummary.tsx` shows a `Clinician` row whose value is `provider.name` + `licensetype`, sourced from `curApptSlot.provider`). This updates the instant a slot (or First Available Time) is selected — do NOT try to infer the provider by scanning column indices (`nth`) or by guessing from the grouped-slot headers; the Booking Summary `Clinician` field is authoritative and trivially readable. Record **provider + date + start/end time + clinic + appointment type + the exact reason token** together before submitting, so the appointment remains identifiable and displayable in `scheduling/workflows/calendar-provider-clinic.md`. Never click Create with a blank/unrecorded provider.

> **⚠️ Print/record ALL appointment info BEFORE clicking Create Appointment.** Once Create succeeds, the dialog resets to the success state and the appointment's info (provider, clinic, date, time) is **no longer retrievable from the page** — so immediately before submitting, dump the complete record: `Patient`, `Reason (with token)`, `Appointment Type`, `Provider`, `Facility`, `Clinic`, `Date`, `Start/End Time`. Submit only after this list is written down. This is what lets a subsequent browser step find **the exact appointment you created** (via the reason token in the block tooltip) instead of guessing which provider/block it is.

**Success screen / Success indicator**: seeing the dialog title **"Complete" / "Appointment Created"** together with a **Create Another Appointment** button means the appointment was created successfully — no further confirmation is needed. Booking is complete at this point.
- **Want to create another appointment** → click **Create Another Appointment** to start the stepper again.
- **Finished booking** → **do nothing else; do not try to close this dialog/page.** Just leave it and move on to the next step (e.g. test `ehr/src/Scheduling`). There is no need to dismiss the dialog (a plain `Escape` may not close it anyway).