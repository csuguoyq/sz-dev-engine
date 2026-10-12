# Referral

> Companion to `skills/ehr-workflow/registration/SKILL.md`. Read this file when your task involves the **referral** sub-flow.

- `ReferralSubTab` / `ReferralForm` build a referral using `CDB*` widgets (custom Document Builder selectors/inputs under `components/referral/components/CDB*`: `CDBSelect`, `CDBInput`, `CDBDateInput`, `CDBDateTimeInput`, `CDBDataGrid`, `CDBChipChoice`, `CDBButtonChoice`, `CDBOrder`, `CDBText`, `CDBTextArea`, `CDBSeparator`, `CDBSelectWithTable`, `CDBMultiSelectWithTable`, `CDBNumberInput`, `CDBDocumentBox`).
- `ReferralDrawer` / `ReferralCard` let the appointment flow (see `appointment-creation.md`) attach an existing referral; status transitions use `config/referral.ts` (`statusDict`, `historyTypeDict`, `historyActionDict`, `updateReferralData`).
- Reading/writing referral data goes through `util/DataAPI.tsx` (`getReferralData`, `updateReferralData`).
- Supporting types in `types/referral.ts`, consts in `constants/referral.ts`, atom in `state/atoms/referral.ts`.