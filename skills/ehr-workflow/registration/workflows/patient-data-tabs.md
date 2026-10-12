# Register Patient Data (other tabs)

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves the patient data entry tabs **other than Scheduling / Referral / Travel Screening / Encounters** (i.e. Demographics, Guarantors, Insurance, Estimates, Authorizations, Documents). **Encounters has its own guide: [workflows/encounters.md](workflows/encounters.md); Accounts (BNR) has [workflows/accounts-bnr.md](accounts-bnr.md).**

These tabs follow a shared pattern: a sub-tab component + forms + data queries in `util/DataHooks.tsx` / `QueryHooks.tsx` / `util/QueryHooks.tsx`.

| Tab | Components | Key points |
|---|---|---|
| Demographics | `demographics/PatientDemoForm.tsx`, `DuplicatePatientDialog.tsx`, `CreatePatientDialog.tsx` | Full demographics form; duplicate handling; `constants/demographics.ts`, `util/helpers/patientHelpers.tsx` |
| Guarantors | **see [workflows/guarantors.md](guarantors.md)** | `util/helpers/GuarantorHelpers.ts`, `state/guarantors` |
| Insurance | **see [workflows/insurance.md](insurance.md)** | add/change plan, save, E-Verify, priorities, documents |
| Encounters | **see [workflows/encounters.md](encounters.md)** | `util/helpers/EncountersHelpers.tsx` |
| Accounts (BNR) | **see [workflows/accounts-bnr.md](accounts-bnr.md)** | overview, Create/Combine BNR, BNR Details, collections |
| Estimates | `estimates/*` | `constants/estimates.ts` / `config/estimates.ts` |
| Authorizations | `authorization/*`, `config/authorization.ts` | Referral authorization grid |
| Documents | `documents/*` | `state/atoms/documents.ts` (documentFilterAtom) |

- Forms seed from `INIT_<X>_FORM_VALUES` in the matching `constants/*.ts`, rendered with MUI + `@cci/mui-components` widgets.
- Cross-field rules go through `util/Validation.tsx` + `validationRules/getMergedRules.ts`; hook-driven validation via `util/hooks/useDebouncedValidation.ts`.
- Data queries/mutations live in `util/QueryHooks.tsx` (e.g. `registration/...`), data shaping in `util/Transform.tsx` / `util/EhrUtil.ts`.