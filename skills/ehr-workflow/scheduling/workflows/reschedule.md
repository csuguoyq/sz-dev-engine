# Reschedule (components/Reschedule/RescheduleApptDialog.tsx + Reschedule/SchedulingWorkflow.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves **rescheduling an appointment**. Note this reuses the appointment-creation logic from `ehr/src/Registration`.

- Entry: `rescheduleOpenAtom && rescheduleApptDataAtom?.patient?.dbpath`.
- Data: `useGetPatientDemoInfoQuery`, `useBookMultiApptsMutation(regid)` (from `@cci-monorepo/Registration`), choice lists (facility / appointment_types / guarantor_type / phone_type).
- Form uses `INIT_APPOINTMENT_FORM_VALUES` (`ehr/src/Scheduling/util/SchedulingUtil.tsx`); submit `handleCreateAppt` → `bookMultiAppts` → on success close + toast **"Appointment Rescheduled"** + `setNeedUpdateCalendar(true)` + print BookingSummary.
- Enable logic lives in a `useEffect` (reasonForVisit, apptType, apptFacility, clinic, contact phone/email, guarantor, etc.); `setEnabled(true)` only when all are satisfied.