# Data API (ehr/src/Scheduling/util/DataAPI.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when you need the list of **backend endpoints**.
> All requests go through `DataAPI.tsx` (GET/POST to `cci.cfg.baseUrl + "/index.php/" + path`). **Add new data needs as methods here; do not scatter fetch logic across components.**

| Function | Endpoint / Purpose |
|---|---|
| `getPatApptData(id)` | `ess/getAppointmentById` — fetch appointment details and refresh the current appointment |
| `updateAppointment(params, onSuccess)` | `ess/bookAppointment` — update appointment / check-in/out times / status |
| `addEvent(params)` / `editEvent(params)` / `deleteEvent(params)` | `ess/saveEvent`, `ess/editEvent`, `ess/deleteEvent` — add/edit/delete block events, incl. rrule + `ignoreConflict`/`onlyCheckAvailable` |
| `sendMail(params)` / `getPortalStatus(params)` | Email & portal status |
| `updateDemographics` / `updateGuarantor` / `updateEncounterInsurance` | Save patient demographics / guarantor / insurance in the check-in panel |
| `getResourcesCals(params)` | Fetch Provider / Room / Equipment resource calendars |
| `savePreferenceCard` / `setPreferenceCardStatus` / `useGetPreferenceCard*Query` / `useGetEssRcfConfigQuery` | Preference-card related |

Event rrule params are complex; `rruleToSummary` (in `SchedulingUtil.tsx`) builds a human-readable recurrence summary. **Run the related tests whenever changing rrule logic.**