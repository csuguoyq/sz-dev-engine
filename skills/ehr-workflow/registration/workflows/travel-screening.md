# Travel Screening

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves the **travel screening** questionnaire.

- `TravelScreeningSubTab` / `Form` / `Table` capture the questionnaire; `TravelScreeningContext` provides context state (see `context/__tests__/TravelScreeningContext.test.tsx` for usage).
- Schema / choices: `types/travelscreening.ts` + `constants/travelscreening.ts`; helpers in `util/helpers/TravelScreeningHelpers.tsx`; atom in `state/atoms/travelscreening.ts`.
- Forms/validation follow `util/Validation.tsx` / `validationRules/getMergedRules.ts`.