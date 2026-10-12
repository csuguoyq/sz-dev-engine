# Testing — Scheduling

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when you are **writing or running tests** for `ehr/src/Scheduling`.

This module is tested with **Jest + React Testing Library** inside the `ehr` app.

## Running tests

- Run Jest from the `ehr` directory, scoped to the scheduling project. For a single project workspace use `npx jest --selectProjects <project>` (use the project name declared in `ehr/jest.config.js`). When debugging a failure, scope to the exact file: `npx jest <path-to-test>`.
- When a snapshot change is intentional (rendered UI/colour/label changed on purpose), update them with `--updateSnapshot`.

## Test style

- Test files follow `__tests__/*.test.tsx`; see the existing style under `ehr/src/SchedulingWorklist/**/__tests__` (snapshots + behavior assertions).

## When your change must add/run tests

- Modify `util/SchedulingUtil.tsx` (validators/consts/rrule) → add/run `__tests__/SchedulingUtil.test.ts(x)`, including rrule logic.
- Modify permission logic (`appointmentManagementAccess.ts`) → add `__tests__` covering NONE / READ / MODIFY: `262:R`=READ; `262:W`/`262:E`=MODIFY.

## Browser regression (playwright)

- Resolve the EHR test-environment URL first (HOSTNAME + webframe-dir overrides) — see the shared `browser-testing` skill (`skills/ehr-ui/browser-testing/SKILL.md`) for the default URL and credentials.
- Key flow: calendar → click appointment → Check-in / Check Out / Reschedule.
- Prerequisite: appointments must first be created in `ehr/src/Registration` (see the `registration` skill's `appointment-creation` workflow), because `Scheduling` only displays appointments created there.