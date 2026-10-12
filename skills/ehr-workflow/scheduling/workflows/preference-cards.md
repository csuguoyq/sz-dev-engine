# Preference Cards (components/PreferenceCards.tsx + PreferenceCard*.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves **preference cards** (list / CRUD / batch print).

- On open → `useGetPreferenceCardListQuery(facility.id)` loads the list; filter by search and Active-Inactive-All.
- Actions: Add (`handleEdit` → `PreferenceCardEdit`), Edit `doEdit`, Duplicate `doDuplicate` (copy), Print `doPrint` (hidden-frame print), Activate/Inactivate/Delete (`setPreferenceCardStatus` with `ConfirmDialog`).
- All mutating buttons must be guarded by `canModifyPreferenceCards` (i.e., `canModifyAppointments`), otherwise disabled.