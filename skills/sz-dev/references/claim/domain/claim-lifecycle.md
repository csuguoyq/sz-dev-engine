# Claim lifecycle — flows, statuses, transaction codes, formulas

Read this whole file for anything on the claim side: generation, edits,
submission, status responses, void/resubmit/late charges, COB, XR, and the
numbers that come out of it. Grep `gotchas.md` for the symptom before
changing code.

## Flows

### Claim generation & edits (5005, 5015, 5021)

- BNR Ready to Bill -> claim generated; charges move from Unbilled
  (Posted area) onto the claim. Late-arriving charges: if the claim is
  Created/Ready to Submit/Errored it is updated in place; if Submitted or
  remittance received, the charge is a "Late Charge" (see below).
- Claim Edits = rule-engine flagging, NOT editing. Rule true -> BNR
  "Claim Edits", claim "Errored" (02), worklist item, "Outstanding Edits"
  entry in Claim Details. Resolution happens in the source module
  (Registration etc.); re-evaluation updates only claims in status 02/03.
  All edits clear -> claim Ready to Submit, BNR Billed, worklist item
  auto-completed.
- Quick Fixes (5021) = direct field editing on the claim form for a limited
  field list (HBNR: patient name/address, condition/occurrence codes,
  accident state/date, responsible party, value codes, member ID, group
  name/number, employer, POA indicator, remarks; PBNR: member ID, patient
  name/address, condition-related flags, group number, other claim ID,
  unable-to-work dates, resubmission ref). On save: validate -> re-run
  rules -> regenerate 837 -> write back to source modules (DBI 22019
  Billing Condition, 22095 patient_employment, 22018 condition codes,
  27001 group name Surescripts-only). Already-created/submitted claims are
  NOT retroactively updated. Fields 80/19/PBNR-19 are 837-only, not
  persisted.

### Electronic claims submission (5005)

- Overnight batch at a configurable time compiles ALL Ready to Submit
  claims (all payers, H+P) into one 837 text file (5-digit random file
  ID) and sFTP-transfers it to the clearinghouse (FTP config: username,
  password, file location, server URL). Claim -> Submitted.
- Manual submission (Billing Tab v3.0, SZ31750): submit one claim
  immediately, or force-bill past BNR/Claim Edits with a logged reason —
  see `billing-ui-ar.md`.

### Claim status responses (5035, 5039)

- 277U/999 are pulled daily at a configurable time (default 21:00 EST),
  deduped, matched to claims, and each response message is recorded in the
  BNR Billing tab Claim Details ("CH/Payer Edits" section, above
  Outstanding Edits) with timestamp.
- Reject (277U STC03=U; 999 IK501/AK901 in {M,R,W,X}) -> claim Rejected,
  BNR "CH Edits" (a.k.a. Claim Edits), one worklist row per message in
  "CH EDI - Rejected". User acknowledges per row; when all are complete,
  BNR -> Ready to Bill and claim -> Ready to Submit.

### Replacement / corrected / void / late charges (5014)

- Frequency code (CLM05-03) types: 0 non-payment, 1 admit-discharge,
  2-4 interim, 5 late charges only, 7 replacement, 8 void/cancel, 9 final.
- **Void**: never submitted -> original flips to Void (23, final),
  charges back to Unbilled. Already submitted -> a Void/Cancel claim
  (frequency 8, new number, REF*F8 = original) is created; the original
  becomes Void only when that claim is Submitted.
- **Resubmit/Replacement** (frequency 7): void/cancel + new replacement
  claim with original + new charges, rules-evaluated, new claim number.
- **Resubmit (SZ32655 semantics)**: submitted but rejected
  pre-adjudication -> original zeroed + marked Complete (NOT void), new
  claim keeps the SAME claim number, Ready to Submit, batched normally.
  Voided/resubmitted originals: no kebab actions, excluded from totals.
- **Late charges** (inpatient only, BNR Billed): per-payer rule decides
  late-charge-only claim (frequency 5, NTE explains) vs auto void +
  replacement (frequency 7); below ASG dollar/time threshold -> auto
  write-off TC 4000, charges marked "Adjusted".

### Secondary billing / COB (5012)

- Coverages billed strictly one at a time. Primary claim lists all other
  payers in 2330B. Payer order comes from majorIT 22152 (JSON per coverage
  category), filtered by the encounter's Guarantor Type.
- Next claim created when: preceding claim Closed (12), BNR Billed,
  unbilled coverage remains, and the payer did NOT forward (CLP02 not in
  {19,20,21,23} and no NM101=TT). New invoice number, visually distinct.
- 837 build remaps payer from 2330 to 2010 and folds in the preceding 835
  (EAF/CLP04, A8, D, CAS, MOA, DTP 573/BPR16, REF F8/CLP073, SVD).
- Guard: only create the secondary claim when totalCharges > payments.
  The secondary claim must use the SECONDARY payer's contract for 837 and
  XR (a historical bug reused the first payer).
- Tertiary claim only after the second claim is Closed (or crossover).

### Reimbursement estimation / XR (5003)

- Contract Management table: one row = one Pricing Term (contract
  name/ID, type, payer/plan, TIN/NPI/location, effective dates, BNR type,
  encounter type, billing type, DRG, revenue code, HCPCS/CPT, payment
  methodology, payment type, rate, fee schedule Table ID). Fee schedules:
  MS-DRG Relative Weight table, Custom Fee Schedule (OPPS/CLAB unified),
  Physician Fee Schedule.
- Matching at claim creation: required criteria (payer, effective window
  around DOS, plan/encounter/billing type/TIN/NPI/location) then
  situational hierarchy (IP: DRG, then null-DRG methodology rows;
  non-IP: rev code+CPT, rev code, CPT, catch-all). No match -> XR "N/A".
- Display: Reimbursement Breakdown card per matched term; total XR in the
  Insurance Claims table. Timing ASG per facility: "At billing" posts TC
  4001 right after claim creation; "At payment" posts nothing and relies
  on 835 posting.
- SI modifiers (OPPS Table A, CMSPFS Table B) can zero or re-route line
  payments; PIA lines are exempt from SI modifications.

## Status models

### BNR (account/sub-BNR) status

```text
Created -> Active (PBNR) / Discharged (HBNR)
  -> [hold period, overnight BNR rules]
     -> BNR Edits (rules true) | Ready to Bill (rules false)
  -> claim generated + overnight claim rules:
     -> Claim Edits (BNR level, claim rules true) | Billed (false)
  -> after remittance cycle: Billed / Denied / RA Edits / Remit Review
  -> Bill Pause suspends progression (status shown with "(Bill Pause)"
     suffix or moved to BNR Edits per the Bill Pause FRD)
  -> Closed (balance $0, all claims Closed/Void, guarantor $0)
  -> Cancelled (no charges after configurable ~30 days)
```

BNR status = the sub-BNR needing the **lowest** level of user intervention
(SZ33127). Bad debt: a closed BNR with balance > $0 inside the bad-debt
timeframe displays as Bad Debt until resolved.

### Claim status codes (choice table `claim_state`, 00-24)

```text
00 Created        01 Scrubbed       02 Errored       03 Ready to Submit
04 Submitted      05 Accepted       06 Received     07 Pending
08 Rejected       09 Approved       10 Denied       11 Paid
12 Closed         13 Processed as Primary   14 Processed as Secondary
15 Processed as Tertiary
16/17/18 Processed as P/S/T, Forwarded to Additional Payer(s)
19 Reversal of Previous Payment
20 Not our Claim, Forwarded to Additional Payer(s)
21 Predetermination Pricing Only - No Payment
22 Pass Thru      23 Void           24 Remit Review
```

- 02 was renamed "Error Sending" -> "Errored" during Claim Edits work.
- 19-22 added by Secondary Billing; 23 (Void) added by Replacement/
  Corrected Claims; 24 (Remit Review) added with 835 processing (ERP v6.0,
  SZ29035) — it left exactly three post-835 outcomes (Denied / Remit
  Review / Closed).
- Claim status = the **highest** action in the billing event (SZ33127).
- "CH Edits" (BNR level, from 277U/999 rejections) pairs with claim
  "Rejected".
- `claim_state` is appended, never renumbered — never reorder it.

### Other statuses

- **Statement**: Ready to Submit -> Submitted -> Paid / Partially Paid /
  Unpaid. Dunning cycle = number of times on a statement (1st green,
  2nd/3rd yellow, 4th red = bad-debt eligible; 120-day default cadence).
- **Coding**: Not Started, In Progress, On Hold, Complete.
- **Charge**: Received -> Posted (to a claim) or Adjusted (written off).

## Transaction codes (posting types on the BNR)

Framework FRD: 250-20-5002. **The code set was redefined by the
Transaction Code Table v2.0 (SZ33512, attachment 104633, 2026-03)** —
fetch via softzilla MCP (`bug_info SZ33512`). Credit = positive (increases
balance); debit = negative (decreases).

| Code | Meaning | Type | Applied to | AR Impact | Claim Selection |
| ---- | ------- | ---- | ---------- | --------- | --------------- |
| 1000 | Patient Payment - Pre-Service (copay) | Payment | Pt | Credit | No |
| 1100 | Patient Refund - Pre-Service | Refund | Pt | Debit | No |
| 1001 | Patient Payment - Statement | Payment | Pt | Credit | No |
| 1101 | Patient Refund - Statement | Refund | Pt | Debit | No |
| 2000 | Insurance Payment (primary) | Payment | Ins | Credit | Yes |
| 2100 | Insurance Refund | Refund | Ins | Debit | Yes |
| 3000 | Policy Discount | Adjustment | Ins | Credit | Yes |
| 3100 | Reverse Policy Discount | Adjustment | Ins | Debit | Yes |
| 4000 | Administrative Adjustment | Adjustment | Ins | Credit | Yes |
| 4100 | Reverse Administrative Adjustment | Adjustment | Ins | Debit | Yes |
| 5000 | Bad Debt Write-Off | Adjustment | Pt | Credit | No |
| 5100 | Reverse Bad Debt Write-Off | Adjustment | Pt | Debit | No |
| 5001 | Charity Adjustment | Adjustment | Pt | Credit | No |
| 5101 | Reverse Charity Adjustment | Adjustment | Pt | Debit | No |
| 4001 | Contractual Adjustment (insurance) | Adjustment | Ins | Credit | Yes |
| 4101 | Reverse Contractual Adjustment | Adjustment | Ins | Debit | Yes |
| 0001 | Transfer Pt to Ins | Transfer | Pt | Transfer | Yes |
| 0002 | Transfer Ins to Pt | Transfer | Ins | Transfer | Yes |

Posting notes: 1000/1001 guarantor payments (1001: statement # as invoice
number); 2000/2100 835 auto-posting; 4000 write-offs (prompt pay CO-44,
sequestration CO-253, late-charge below threshold, global billing); 4001
XR "at billing" + underpaid below threshold; 4100/4101 reversals,
overpaid above threshold. Payments counted in a claim's "Payments"
column: TC 2000/2100 tied to the claim's invoice number. System posts use
user **"System-Generated"**; same-day system postings are user-editable.

Known issues recorded in the v2.0 table: 3000/3100/4000/4100/5000/5100/
5001/5101 flagged "not paying attention to the Acct Bal Type"; 4001/4101
"not impacting Ins balance even if balance type is set to Ins". Reversals
must post even when the amount exceeds the current account balance
(SZ34132).

## Key formulas

- **Claim balance (primary, coverage priority "First")**: `Claim Charges
  + Insurance Adjustments (4001/4101) + Administrative Adjustments
  (4000/4100) + Insurance Payments (2000/2100) - Next in Line - Patient
  Responsibility`
- **Claim balance (non-primary)**: same, but `Next in Line Amount from
  preceding claim` replaces Claim Charges.
- Only adjustments referencing the claim's invoice number count. Guarantor
  adjustments/payments are excluded. Next-in-Line is pre-calculated
  (SA95053), not derived from the claim's own adjustments.
- **Insurance card balance** = sum of claim balances where Payer = the
  card's payer (250-20-5020 US-2000); includes insurance adjustments
  (SZ32964, `util/Transform.tsx`).
- **835 Remittance Total** (payment details) = CLP04 + CLP05.
- **XR by payment methodology**: % of Charge `billed x rate`; Per Diem
  `rate x LOS` (inclusive of discharge day); Case Rate `rate`; % of
  Medicare `rate x Medicare Rate`; IPPS `RW x Hospital Base Rate`;
  OPPS/CLAB `Payment Rate x Units`; DRG Base Rate `rate x RW`; % of Fee
  Schedule `rate x payment rate x units`; Conversion Factor
  `CF x (wRVU*wGPCI + PE*pGPCI + MP*mGPCI)`; Carve-Out `payment rate x
  units`. PPS selection: bill type 11X -> IPPS, 13X -> OPPS, POS 81 ->
  CLAB, other POS -> Physician Fee Schedule. PIA beats Per Procedure on
  the same line; Entire Case vs Per Procedure mutually exclusive per
  claim. XR adjustment: TC 4001, amount = `Claim Amount - Total XR`.
- **Secondary billing**: secondary claim charges are informational only
  (never added to account balance); BNR balance IS reduced by secondary
  payments. Created only when `totalCharges > payments`; crossover claims
  (CLP02 in {19,20,21,23} or NM101 = TT) reuse the primary invoice number,
  start "Pass Thru" (22), skip FTP submission and Claim Edits.
- **Balances**: Unbilled and BNR Account Balance are calculated in real
  time (SZ33512); `fixBalances` historically could only repair Guarantor
  Balance.
