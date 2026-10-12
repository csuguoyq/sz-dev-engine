# Quick Registration (MiniReg) & Unknown Patient

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves **quick registration for a new patient** or **anonymous / unknown patient**.

Both are opened from `PatientSearchPage` (`handleQuickRegForNewPatientClick`, `handleQuickRegForUnknownPatientClick`) in `components/search/PatientSearchPage.tsx`.

## MiniReg (quick reg) — `components/minireg/`

- `MiniRegDialog.tsx` (+ legacy `MiniRegDialogOld.tsx`) is the quick registration modal; it reuses `MiniReg*` elements (`MiniRegUnit`, `MiniRegSexChips`, `MiniRegPcp`, `MiniRegLocation`, `MiniRegGuarantorType`, `MiniRegGuarantorName`).
- On success the search page callback (`onMiniRegSuccess`) opens the new patient tab.
- Forms/validation follow `util/Validation.tsx` / `validationRules/getMergedRules.ts`; consts in `constants/minireg.ts`, atom in `state/atoms/minireg.ts`.

## Unknown patient — `components/minireg/`

- `UnknownPatientDialog.tsx`: anonymous registration (no identity / a placeholder record), also rooted in `components/minireg/`.

> Keep validation centralized via `util/Validation.tsx` / `validationRules/getMergedRules.ts` when touching these.