# Testing — Registration

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when you are **writing or running tests** for `ehr/src/Registration`.

This module is **its own jest project** (`displayName: "registration"`) — config in `ehr/src/Registration/jest.config.js`, `testEnvironment: jsdom`.

## Running tests

- Run only this project (from the `ehr` dir):
  ```
  npx jest --selectProjects registration
  ```
- When debugging a failure, scope to the exact file: `npx jest <path-to-test>`.

## Test style

- Test files follow `__tests__/*.test.ts(x)`.
- When you add a unit-testable pure helper (e.g. in `util/helpers/` or `constants/`), add `__tests__/*.test.ts` and cover it with `jest --selectProjects registration`.

## ⚠️ Legacy tests are disabled

- Many legacy tests are excluded via `testPathIgnorePatterns` (context tests, search/demographics/encounter/insurance/travelscreening sub-tabs, `Transform.test`, `PatientTab`/`DynamicPages`/`PatientHeader`, etc. — they import deleted modules or need a `QueryClientProvider`/`TextEncoder` polyfill). When you touch those areas, plan to **rewrite, not patch**.

## Browser regression (playwright)

- Appointments created here feed `ehr/src/Scheduling`; run the combined flow via the `scheduling` skill's `testing` workflow / browser guidance.
- **Creating an encounter via Playwright** (for a repeatable test setup) is documented in the Encounters workflow: [workflows/encounters.md → "Automated creation (Playwright recipe)"](workflows/encounters.md). It covers the side-effect click to open the Encounters sub-tab, `encounters-new-encounter-button`, the `encounters-type-field` / `encounters-status-field` dropdowns, and the `encounters-form-save-button` ("Create Encounter").
- Resolve the EHR test-environment URL first (HOSTNAME + webframe-dir + Entry + screen overrides) — see the shared `browser-testing` skill (`skills/ehr-ui/browser-testing/SKILL.md`) for the default URL and credentials.