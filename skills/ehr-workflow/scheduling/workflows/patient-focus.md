# Patient Focus (components/PatientFocus.tsx / AppointmentPatientFocus.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves the **patient-focus dialog**.

- Generic (`PatientFocus`): tabs = ["Check-in"], plus ["Check Out"] when the check-out condition holds.
- RAD/PERIOP (`AppointmentPatientFocus`): targeted at radiology/surgical appointments; takes `appointmentType` and selects `selTab` accordingly.
- **"Go to patient page"**: `Config.gotoPatientPage({ dbpath }, {})`; when leaving the module it persists calendar/appointment state via `gotoPatientPageConfigAtom` + `Cci.RunTime.setCache("apptManageGotoConfig")`, restored on re-entry.