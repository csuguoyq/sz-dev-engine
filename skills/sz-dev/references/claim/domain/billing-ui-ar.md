# Billing tab UI, AR Management, permissions (5020 v3.0, 3034, 13001)

Read this whole file for Billing tab UI work (cards/tables/timeline/
notes/submit dialogs), AR Management visibility, or permission wiring.

## Billing Tab (5020 v3.0) — the UI hub

- F-0100 tables: Unbilled Charges (Pending/Posted), Insurance Claims
  (invoice, status, type, payer, charges, XR, payments, balance, claim
  file ID), Guarantor Balance, Payments (txn code + description),
  Adjustments. Summary cards: Unbilled Charges card, one Insurance card
  per payer (flippable stack; balance = sum of that payer's claim
  balances; hidden for self-pay; a billed insurance stays visible even if
  later terminated/inactivated — SZ34059), Guarantor card. F-0200
  Timeline: milestones (Admitted/Discharged -> Coded -> Billed ->
  Insurance -> Guarantor) + activity feed (claim/payment/status events,
  edits, postings, bill pause, notes with pin + visibility).
- v3.0 actions (permission-gated, one submit flow with 4 submitTypes in
  `Fee.tsx`):
  - **Initiate billing** (`toBill` → `manuallySubmitBill`): all or date
    range / selected charges; requires unbilled charges +
    checkout/discharge + coding; creates claim or statement; inpatient
    interim frequency codes 2/3/4.
  - **Force-bill** (`BNREditToBill` → `forceSubmitBill`): override BNR
    Edits, reason logged, completes eligible worklist entries.
  - **Submit claim immediately** (`Submit` → `manuallySubmitClaim`):
    Ready to Submit -> clearinghouse.
  - **Override Claim Edits** (`ClaimEditToBill` → `forceSubmitBill`):
    Errored claims only, reason logged.
- Initiate billing suppresses late-charge auto-claim behavior; out-of-
  range charges stay Unbilled and block BNR closure.
- Storage: vdata `billing_info` (DBI 22278) for date range + reason;
  `billing_activities` (DBI 22227) for the timeline.
- Cross-session: WebSocket `bill_data_changed` (dbpath_nit) triggers a
  debounced refetch.

## AR Management (3034 v1.0)

- Pre-billing: header icons (created/in-progress, no clearinghouse
  response after 3 days (configurable), edits/rejected, accepted) +
  timely-filing deadline per payer/contract (default 90 days from
  discharge; switches to days-since-acceptance after payer acceptance —
  must match `timelyFilingDays` in the DB, SZ33479).
- Reporting hyperjumps between AR reports and BNR/claim/payment detail
  pages (jump back supported; SZ33738 extended it to Charge Summary).
- Post-billing: worklist hyperlinks, status dates/tooltips, claim side
  panel (history incl. EDI responses; manual status limited to
  Appeal in progress / Underpaid-Payment Discrepancy / No payment-Follow
  Up when in remit review/submitted/denied/rejected/closed — the list is
  configurable; configurable owning party: Coding, Insurance Follow-up,
  Billing, Registration; comments).
- Payment management: milestone icons (clean green, review red, denied
  red), remittance actions on payment details (modification currently
  uses RCM_BILLING), most recent payment txn (incl. $0) on cards.
- Guarantor visibility: statement status + cycle color coding.

## Revenue Cycle Permissions (13001 Rev 2.0)

- Modes: None / Read / Write / Modify (Read = view + print; Write =
  read/write no edit; Modify = read/write/edit).
- Constants: `CHARGE_SERVICES_` (clinical charge app), `REV_CYCLE_` (rev
  cycle app: patient search, BNR overview, account summary),
  `RCM_CHARGE_` (view/add/reverse charges), `RCM_CODING_` (encoder,
  hold/complete), `RCM_BILLING_` (billing tab, guarantor search/overview,
  adjustments, edit guarantor info, void claims, resubmit claims).
- Production numbers (appli_perms.m): 238 RCM_CHARGE, 239 RCM_CODING,
  240 RCM_BILLING, 220 CHARGE_SERVICES, 147 Registration. v1.0 FRD's
  numbered list (235-242) does NOT match production — do not trust it.
- UI rule: hide (not grey out) unavailable buttons.
- **Permission checks are enforced server-side as well** (SZ33602) —
  client-side `cci.cfg.perms` alone is not sufficient for new entry
  points.
- Unresolved: "initiate billing" permission — product said existing RCM
  perms don't fit; an Admin-type perm may be reused (237:REV_CYCLE
  suggested, not final).
