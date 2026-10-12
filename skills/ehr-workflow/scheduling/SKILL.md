---
name: "scheduling"
description: "Ambulatory Appointment Management (Scheduling / AmbApptManagement) for ehr/src/Scheduling: invoke when developing or testing THIS module, OR when the task is about appointment-management flows — patient check-in, check out, appointment reschedule, block/conflict events (incl. recurrence), preference cards, schedule print, or the scheduling calendar."
---

# Scheduling Workflows (Ambulatory Appointment Management)

> Load this file first to get the module map. It is a **router**: pick your direction below, then read ONLY the file you need so unrelated detail stays out of context.
> Tech stack: React + TypeScript + MUI (`@cci/mui-components`) + jotai (global state) + TanStack Query (data fetching).
> All paths are relative to the `ccsrc` repository root.

## 0. Pick your direction first

| What you are doing | Read |
|---|---|
| 🧑‍💻 Writing / modifying Scheduling **code** | [workflows/dev-conventions.md](workflows/dev-conventions.md) (+ the workflow file below that matches your task) |
| 🧪 Writing / running **tests** | [workflows/testing.md](workflows/testing.md) |
| 🔍 Looking up a specific **workflow** | the matching row in the index below |
| 📚 Looking up **backend endpoints** | [workflows/data-api.md](workflows/data-api.md) |
| 🧠 Looking up **global state / atoms** | [workflows/scheduling-atoms.md](workflows/scheduling-atoms.md) |

## 1. What the module is

`Scheduling` = **Ambulatory Appointment Management (internal name AmbApptManagement)**.
Front desk / clinicians manage appointments on a calendar: patient check-in, check out, reschedule, resource block events, preference cards, and schedule printing.

- Entry chain: `ehr/src/Scheduling/Scheduling.tsx` → `ehr/src/Scheduling/SchedulingRoot.tsx` (permission checks + assembling dialogs) → each workflow component.
- `screenParams` passes 3 key params: `displayResources` (displayed resources/calendars), `procType` (process type), `cacheKey` (cache key); they flow down to `ehr/src/Scheduling/components/CalendarMainPanel.tsx`.

## 2. Directory overview (responsibilities)

```
ehr/src/Scheduling/
├── Scheduling.tsx / SchedulingRoot.tsx / index.tsx   # entries + permission checks + dialog assembly
├── appointmentManagementAccess.ts                    # access-level consts & decision functions
├── context/SchedulingAtoms.tsx                       # all jotai global state (patApptDataAtom, needUpdateCalendarAtom, ...)
├── hooks/                                            # useAppointmentManagementAccess / Entry / CheckAppPermission
├── util/
│   ├── DataAPI.tsx        # all backend requests (ess/* endpoints) — the single data entry point
│   └── SchedulingUtil.tsx # form defaults, consts, validators, RRule helpers
└── components/
    ├── CalendarMainPanel.tsx      # calendar main panel (wraps Ext JS EnterpriseCalendarMainPanel)
    ├── CheckInPanel.tsx + CheckIn/  CheckOutPanel.tsx + CheckOut/   # check-in / check out
    ├── PatientFocus.tsx / AppointmentPatientFocus.tsx               # patient-focus dialogs
    ├── Reschedule/Event/PreferenceCards/SchedulePrintDialog        # per-workflow dialogs
    └── common/                  # reusable widgets (RevertConfirm, PatientHeader, ...)
```

> Treat `util/DataAPI.tsx` as the **single data entry point** and `context/SchedulingAtoms.tsx` as the shared global state; consult them first when tracing data flow.

## 3. Workflow index — READ ONLY WHAT YOU NEED (on-demand)

| If your task is about... | Read |
|---|---|
| Permission checks / entry (`APPT_MGMT`, token/level logic) | [workflows/access-and-permissions.md](workflows/access-and-permissions.md) |
| The Ext JS calendar main panel & callbacks | [workflows/calendar-main-panel.md](workflows/calendar-main-panel.md) |
| Browser-testing: making a new appointment show on the calendar (provider + clinic selection) | [workflows/calendar-provider-clinic.md](workflows/calendar-provider-clinic.md) |
| Check-in (demographics/guarantor/insurance forms, admit) | [workflows/check-in.md](workflows/check-in.md) |
| Check-out | [workflows/check-out.md](workflows/check-out.md) |
| Reschedule an appointment | [workflows/reschedule.md](workflows/reschedule.md) |
| Block events (add/edit/delete, conflict, recurrence) | [workflows/events.md](workflows/events.md) |
| Preference cards (list / CRUD / batch print) | [workflows/preference-cards.md](workflows/preference-cards.md) |
| Patient-focus dialog (generic vs RAD/PERIOP) | [workflows/patient-focus.md](workflows/patient-focus.md) |
| Schedule print | [workflows/schedule-print.md](workflows/schedule-print.md) |
| Backend endpoints (`DataAPI.tsx` reference) | [workflows/data-api.md](workflows/data-api.md) |

> Rule: read exactly the matching file(s); do not dump all workflow files into context at once.

## 4. Global refresh convention (read this before any write)

> After a successful save/edit/delete, code **universally calls `setNeedUpdateCalendar(true)`** to refresh the calendar, and calls `getPatApptData(apptData._id)` to refetch appointment data back into `patApptDataAtom`. **Keep this pattern when adding any new workflow.**

Full development rules (permissions, data/time handling, cross-module boundaries) live in [workflows/dev-conventions.md](workflows/dev-conventions.md). Test rules live in [workflows/testing.md](workflows/testing.md).