# Access & Permissions (prerequisite for every flow)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves **permission checks or module entry**.

- `hooks/useAppointmentManagementAccess.ts`: calls `authen/checkperms` for the `APPT_MGMT` permission → `accessLevel ∈ NONE | READ | MODIFY`; `canModifyAppointments = accessLevel === MODIFY`.
- `appointmentManagementAccess.ts` (module root): `getAppointmentManagementAccessLevel(permissions)` decides by token — `262:W`/`262:E` = MODIFY, `262:R` = READ; missing/unrelated token = NONE. `getAppointmentManagementPermMap` handles the perm-map style (`APPT_MGMT: R/W/E`, enabled by `1`/`true`).
- `hooks/useAppointmentManagementEntry.ts` / `useCheckAppPermission`: module entry capability check.
- Flow notes: `NONE` renders a no-permission message; render `null` before `isReady`; **only `MODIFY` may operate** (check-out, edit events, preference cards, reschedule).

> Rule (from SKILL.md): if touching `appointmentManagementAccess.ts` or `useAppointmentManagementAccess`, add/run unit tests covering token/permission-level logic (NONE / READ / MODIFY).