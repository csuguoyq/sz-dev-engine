# Guarantor (3016, 5007, 5013; Bill Pause 5016)

Read this whole file for guarantor work (balance / statements /
payments / billing view). Bill Pause lives here because it has a
guarantor-side pause (no balance move, no statements, dunning hold).

## Guarantor family

- **Balance move**: when the insurance claims table totals 0 and claims
  are Closed, patient responsibility (835 CLP05, final RA per invoice)
  moves to the BNR Guarantor Balance. True self-pay: guarantor balance =
  account balance.
- **Statements**: generated overnight (default midnight) for guarantors
  with a balance not already statemented within N days (default 30);
  status Ready to Submit -> Submitted (nightly file, 6-digit random ID,
  to print vendor) -> Paid/Partially Paid/Unpaid. Dunning cycles per
  120-day (default) or 90-day cadence; cycle 4 = bad-debt eligible.
  Statement Review rule (SZ34109): user confirms the statement is good —
  "Review Needed" -> "Approved" flow (note: a test-env HOBJS-dir mismatch
  once made Approve land on "Submitted" — check the test HOBJS dir).
- **Payments**: three entry points (Registration cost center 7900,
  Guarantor Billing View 8300, BNR view 8300). Pay a BNR, a pre-service
  copay (Service Type, auto-populated from RTE), or a statement. Card
  (EasyPay iframe for manual entry; PCI), cash, check. Partial statement
  payments auto-apply: FIFO (default), highest-balance-first, PBNRs before
  HBNRs, or reverse. TC 1000 (pre-service) / 1001 (statement/BNR).
  Payment updates Amount Paid / Remaining Balance — never Total
  Responsibility. Foundation SZ: **SZ28113** (5013 v1.0); latest FRD
  is v2.0 **SZ28633** — see **Guarantor Payments** below.
- **Billing View**: guarantor-level overview (demographics, employment,
  income, propensity-to-pay score), statements, BNR overview; paid
  statements hidden by default. v1.0 has mock/placeholder fields.

## Guarantor Payments (5013 — SZ28113 v1.0, latest v2.0 SZ28633)

Post patient-responsibility money (copay / statement / remaining
liability) from three staff entry points. Prior-art: softzilla MCP
(`bug_info` / `bug_comments`) on SZ28113; authoritative FRD is the
**latest**
catalog row (v2.0 SZ28633 att 94132), not the v1.0 PDF on SZ28113
(att 93093). Figma (v1.0): proto `sVm5KNaMAocLIGzOuo6TFJ`.

Use cases (v1.0 F-0100):

| US | Where | Cost center default | What can be paid |
| -- | ----- | ------------------- | ---------------- |
| 0010 | Guarantor Registration | 7900 | BNR (past, TC 1001), Pre-service (today/future, TC 1000 + Service Type from RTE), Statement (not Paid) |
| 0020 | Guarantor Billing View | 8300 | BNR, Statement (no pre-service in this view) |
| 0030 | Patient Billing Tab / BNR | 8300 | BNR (defaults to the open BNR), Statement |
| 0040 / 0050 | Display | — | After post: Amount Paid / Remaining update; **Total Responsibility does not change** |
| 0060 | ASG | — | Partial **statement** apply: FIFO (default), highest-balance-first, PBNRs before HBNRs, or reverse |
| 0070 / 0080 | Summary + receipt | — | Print preview after tender |

Payment types: Card (default), Cash, Check. Payment-from: Guarantor
(default) or Patient. Tendered amount may not exceed amount due.
Card sub-modes: Card on file (default), Chip/Swipe (Verifone P400),
Manual entry (EasyPay iframe). Check: check # + date.

Posted adjustments (BNR view):

- Pre-service → TC **1000** (Patient Payment-Pre-Service); GL
  148000-0000 / 111033-3000; invoice blank.
- BNR or statement → TC **1001** (Patient Payment-Statement); GL
  149000-0000 / 211033-3000; statement # on statement pays.

Storage: DBI **22155** `guarantor_payment` (vdata, SD406448). PCI:
**never** store full PAN or CVV. Callback `CardNumber` is last-4;
card type, ConsentID, TransactionID, ApprovalCode are OK. ExpireDate
was initially disallowed then Clinical allowed the EasyPay JSON
fields — verify the current schema before adding columns.

EasyPay / Verifone (SZ28113 thread):

- Silent JSON callback: `WidOptions.eSubmission` = `0E11`; read the
  POST **InputStream** (not query string). `PostURL` must be reachable
  from the US region (non-US hosts 502'd in the original debug).
- AES-256 on widget params: `EINDEX` `317`; before decrypt, replace
  SPACE with `+` in Base64.
- Chip/Swipe + Card-on-file: Windows middleware
  `3rdparty/Windows/EPVerifoneSetup_E2E_1039.exe`; SAVE CARD
  (`Index2.html`) **validates only** and returns ConsentID — it does
  **not** authorize an amount. Charge a stored card via EasyPay REST.
- Frontend: `ehr/src/component/{PaymentDrawer,PaymentButtonGroup,
  components/GuarantorPaymentTpl}.tsx`, `util/{VerfoneApi,api}.ts`.
- Backend: `webframe/app3/classes/Controller/Verifone.php` (was missing
  from the Makefile — **SZ28307**), `Claim.php` guarantor-pay actions.
- HOBJS: `getguarantorcardlist`, `saveguarantorcard`,
  `getguarantorspayment`, `payguarantorspayment`,
  `saveguarantorspayment{,record}`, `getguarantorpaymentrecordlist`,
  `updateguarantorstatement`. Init: `scripts/InitGuarantorDB.ycql`.

Follow-ups (same family): SZ28351 / SZ28412 (payment bugs), SZ28633
(FRD v2.0), SZ28859 (statement increments in "to pay"), SZ35202
(Payment tab gating: Pre-Service + BNR). Copay/deductible amounts on
pre-service come from the **RTE** payload (InsuranceDetailsCard), not
a local table.

## Bill Pause (5016 v3.0)

- Two independent pauses per sub-BNR: Insurance (no claim create/submit;
  Adjustments-table items stay pending — Unbilled Charges unaffected) and
  Guarantor (no balance move, no statements, dunning suspended +
  rescheduled; aging continues).
- Reasons: predefined ASG list (Insurance verification, Pending
  Documentation, Patient Dispute, Compliance or Regulatory Review, Other +
  required note).
- Entry points: Sub-BNR tab, BNR Overview (multi-select), Guarantor
  Billing Details. Both types can be active at once (v2.0+); status
  display lists Insurance first.
- Status behavior while insurance-paused: early statuses keep progressing
  with "(Bill Pause)" suffix; later statuses (Ready to Bill, Billed,
  Claim Edits, Denied, RA Edits) are pinned (FRD text is ambiguous between
  "BNR Edits" and a "Bill Pause" status — treat `rule.rcf` +
  `HOBJS/bnrstatus` as source of truth). Un-pause: Discharged re-runs BNR
  rules; other statuses revert to the recorded pre-pause status when all
  pauses are removed.
- Storage: DBI 22186 `insurance_bnr_pause`, 22187 `guarantor_bnr_pause`
  (vdata JSON: reason, notes, user, start time, prior status); choice
  `bill_pause_reason`; rules `BNRRules/BillingPause`, `None/GuarantorPause`.
- UI: `BillPauseButton`/`BillPauseDialog` (ChargeServices/util) in the
  Billing tab Overview header; BNR statuses Closed / Cancelled /
  "Closed (BD with Agency)" disable pause ops; chips show Insurance
  first.
- Known hazard: dual-daemon (test + campus) BNR status races during
  pause/resume — the pre-pause recorded status is what gets restored.
