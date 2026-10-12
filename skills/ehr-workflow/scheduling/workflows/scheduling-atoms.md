# Global State — context/SchedulingAtoms.tsx

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when you need the meaning of a Scheduling atom, or plan to add / extend shared global state.

`context/SchedulingAtoms.tsx` is the **single source** of shared global state (jotai). Share cross-component data via these atoms — do not create new global vars.

| Atom | Meaning |
|---|---|
| `patApptDataAtom` | Current selected patient appointment data (`{ patient, encounterDbpath, _id, apptType, status... }`); almost every dialog depends on it |
| `patFocusDiagOpenedAtom` / `patFocusDiagLoadingAtom` / `patFocusDiagSelTabAtom` | Patient-focus dialog open/loading/selected tab |
| `needUpdateCalendarAtom` | Set to true to trigger a calendar refresh (CalendarMainPanel listens, calls `onRefreshCalendarPanel`, then resets to false) |
| `rescheduleOpenAtom` / `rescheduleApptDataAtom` | Reschedule dialog open + data |
| `addEventDiagOpenedAtom` / `editEventDiagOpenedAtom` / `editEventDataAtom` | Add/edit event dialog + data |
| `preferenceCardsOpenedAtom` / `preferenceCardsLoadingAtom` | Preference-cards dialog open/loading |
| `checkOutAtom` | Flag before entering check-out (CalendarMainPanel sets false when opening an appointment) |
| `schedulePrintDialogOpenAtom` | Schedule-print dialog open |
| `apptCalendarConfigAtom` | Calendar initial config (startDate, selCalIdx, activeItem) |

> After a successful event/operation, code **universally calls `setNeedUpdateCalendar(true)`** to refresh the calendar, and calls `getPatApptData(apptData._id)` to refetch appointment data back into `patApptDataAtom`. Keep this pattern when adding new workflows.