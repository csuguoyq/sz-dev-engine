# Event Management (components/Event/)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves **block events** (add / edit / delete / conflict / recurrence).

- **Add** `AddEventDialog`: `handleSave` → `addEvent(eventData)`. Success → toast **"Block Added"** + `setNeedUpdateCalendar`; response with `ret.data.events` → `EventConflictDialog`; failure → error toast.
  - Conflict handling: `handleForceSave` re-saves with `{ ignoreConflict: true }`; `handleRemove` deletes the conflicting event then re-checks.
- **Edit** `EditEventDialog`: `handleSave` → `editEvent(eventData)` with a similar conflict flow; `handleDelete` → `deleteEvent`.
  - `eventData.mode`: 0 = single occurrence, non-zero = whole series (drives copy & delete params).
- **Conflict grid** `EventConflictGrid`/`EventConflictDialog`: DataGridPro lists conflicts with Remove/Edit actions; edits may retrigger the save.
- **Recurrence**: `SetRecurringDialog` + SchedulingUtil's `rruleToSummary` produce a summary; `repeatTypeChoices` / `daysOfWeek` / `ordinalTypeChoices` etc. are exported by `SchedulingUtil`.
- Data shape: `addEvent` assembles `status:"BU"`, `facility`, `title`, `isAllDay`, `startTime/endTime` (server ms), `details`, `resources`, `rrule` (JSON).

> Rule: run the rrule-related tests whenever changing recurrence logic.