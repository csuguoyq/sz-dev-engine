# Registration Development Conventions

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when you are **writing or modifying code** under `ehr/src/Registration`.

## Global state

Atoms are the single source of shared state (jotai) — share cross-component data via atoms, never new globals. State and DataAPI are imported cross-module through `@cci-monorepo/Registration/*` aliases; keep exports stable when adding to them. The atom map lives in [registration-atoms.md](registration-atoms.md).

## Single data entry point

- Put backend calls in `util/DataAPI.tsx` (`postData("iss|ess|registration/...", payload)`) or `util/DataRequests.tsx` / `QueryHooks.tsx` mutations — do not scatter fetch logic in components.

## Shared ESS runtime

- Time/identifier logic relies on globals like `Ess.Util.EssUtil.newDate`, `Ess.Util.genFacilityIdByCampusClinic`, `cci.cfg.*`; do not reimplement.
- Dates use `dayjs` + `dayjs/plugin/timezone`, TIMEZONE from `cci.cfg.sitetz`.

## Validation in one place

- Route cross-field rules through `util/Validation.tsx` + `validationRules/getMergedRules.ts`.

## Reuse

- Reuse `@cci/mui-components` widgets and per-domain atoms instead of new global state or reimplemented widgets.

## Conventions recap

1. **Read context first**: before changing `Registration`, read the touched component + `util/DataAPI.tsx`/`util/DataRequests.tsx`/`util/QueryHooks.tsx` + relevant `state/atoms/*`.
2. **Single source of truth**: jotai atoms; no new global vars.
3. **Centralize data requests**: DataAPI / DataRequests / QueryHooks.
4. **Validation in one place**: getMergedRules.
5. **ESS runtime & dayjs for dates** — never hand-roll time/facility-id logic.

## Cross-module boundaries

- Consumed by **`ehr/src/Scheduling`** via `@cci-monorepo/Registration` aliases (form hooks, choice lists, `useBookMultiApptsMutation`, `useGetGuarantorsQuery`, `DataAPI`, atoms). **When you change shared Registration exports, confirm `Scheduling` still works before committing.**
- Shares lots with `@cci-monorepo/common` (auth/perms, `useWrapNavigation`, dialogs) and `ess/...` backend endpoints used by Entry/Scheduling.
- Full end-to-end flows (registration save → scheduling calendar) cross module boundaries; keep cross-module changes additive.