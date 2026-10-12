# Check Out (components/CheckOutPanel.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves **check-out**.

- Visibility: `canModifyAppointments && patApptData && (checkinTime||checkoutTime) && apptType not containing "Procedure"` (see `SchedulingRoot`).
- `checkoutStatus ∈ new | edit | finish` (`CHECKOUT_STATUS`). NEW = first check-out, FINISH = done, EDIT = modify.
- Submit `handleCheckOut`: build `buildCheckOutActionParams` → `doRegAction(ENCOUNTER_ACTIONS.CHECKOUT | EDIT, params)` → on success `setFormData("checkoutStatus", FINISH)` + toast + `setNeedUpdateCalendar(true)` + `getPatApptData` refresh.
- Revert: `updateApptStatus(APPT_STATUS.CHECKEDIN, misc)` via `updateAppointment` (not allowed after the appointment day).
- Validation/consts in `SchedulingUtil.tsx` (`CHECKOUT_STATUS`, `INIT_CHECKOUT_FORM_VALUES`, `APPT_STATUS`).