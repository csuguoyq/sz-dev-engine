# Global State — state/store.ts + state/atoms/*

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when you need the meaning of a Registration atom, or plan to add / extend shared global state.

Registration uses jotai; each domain has `state/atoms/<domain>.ts`, re-exported through `@cci-monorepo/Registration/*` aliases and imported by other modules (e.g. `Scheduling`).

## Key atoms by domain

- **scheduling**: `stepIndexAtom`, `schedulingStepsCountAtom`, `apptSlotsCountAtom`, `hasReferralAtom`, `selectReferralAtom`, `showCancelApptDialogAtom`
- **tabs**: `fullTabListAtom`, `selectedTabIndexAtom`, `openPatientTabSetAtom`
- **per-domain**: pages, insurance, guarantors, demographics, documents, referral, encounters, accounts, authorizations, travelscreening, minireg, estimates, addressValidation, portalStatus

> Atoms are the single source of shared state — share cross-component data via atoms, never new globals. Keep exports stable when adding to `state/atoms/*` (they are consumed cross-module via `@cci-monorepo/Registration/*` aliases).