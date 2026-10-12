# Scheduling Development Conventions

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when you are **writing or modifying code** under `ehr/src/Scheduling`.

## Global state

Atoms are the single source of shared state (jotai) — share cross-component data via atoms, never new globals. The atom table lives in [scheduling-atoms.md](scheduling-atoms.md); consult it when adding or extending shared state.

## Data & time

- All backend requests go through `util/DataAPI.tsx` (GET/POST to `cci.cfg.baseUrl + "/index.php/" + path`) — the **single data entry point**. Add new data needs as methods there; do not scatter fetch logic across components.
- Use `Cci.util.DateTime.*` for time conversion — never hand-roll it.
- Event rrule params are complex; `rruleToSummary` (in `util/SchedulingUtil.tsx`) builds a human-readable recurrence summary. **Run the related tests whenever changing rrule logic.**

## Conventions

1. **Read context first**: before changing `Scheduling`, confirm which workflow it touches and read the corresponding component + `util/DataAPI.tsx` + `util/SchedulingUtil.tsx` + `context/SchedulingAtoms.tsx`.
2. **Single source of truth**: share cross-component data via jotai atoms (SchedulingAtoms); do not create new global vars.
3. **Centralize data requests**: put backend calls in `DataAPI.tsx`; use `Cci.util.DateTime.*` for time conversion.
4. **Refresh after success**: after save/edit/delete succeed, call `setNeedUpdateCalendar(true)` + `getPatApptData(apptData._id)`. This is the single most important shortcut.
5. **Permission guarding**: write operations must check `canModifyAppointments` (or `canModifyPreferenceCards`), consistent with existing code.
6. **Reuse**: reuse form defaults/validators/consts from `SchedulingUtil`, and `common/` widgets (ConfirmDialog / RevertConfirm / PatientHeader) instead of reimplementing.
7. **Permission/entry changes**: if touching `appointmentManagementAccess.ts` or `useAppointmentManagementAccess`, add/run unit tests covering the token/permission-level logic.

## Permissions model

- `262:R` = READ; `262:W` / `262:E` = MODIFY.
- Entry & permission decision logic lives in `appointmentManagementAccess.ts` and `hooks/useAppointmentManagementAccess`.

## Cross-module boundaries

- This module heavily reuses `@cci-monorepo/Registration` (form hooks, choice lists, `useBookMultiApptsMutation`, `useGetGuarantorsQuery`, etc.) and `@cci-monorepo/common`. **Confirm cross-module changes do not impact Registration before committing.**
- Styling: use MUI + existing styled-component style (Roboto, white cards, rounded dialogs); do not introduce a new styling system.