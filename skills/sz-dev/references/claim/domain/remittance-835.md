# Remittance & 835 — pipeline, posting, EDI segments

Read this whole file for 835/ERA work, payment posting, remittance
actions, and anything touching EDI parsing/matching (837/835/277U/999).

## 835 pipeline (5006 v8.0) & remittance actions (5009 historical)

- Ingest: FTP pickup at configurable time; validate (CLP count = TS304;
  three-level amount balances); parse/index/store.
- Match: CLP01 = CLM01 + payer N104 = NM109.
- Auto-post: one payment transaction per SVC segment (amount SVC03, no
  post when 0), or one per claim (CLP07/CLP04) when no SVC segments.
  TC 2000 default, configurable by Financial Class/Payer ID; charge link
  via REF*6R REF02, else proportional distribution across unbilled charge
  IDs on the claim. User "System-Generated".
- Remittance actions per CARC: rule engine proposes; user can change the
  dropdown before any transaction is posted; once posted, locked.
  Line/claim-level actions can be edited in Step 2 of the Remit Record;
  "Edit" in BNR Billing Tab > Payment Details navigates back to Step 2
  (SZ33658).
- Statuses: claim Closed (balance $0) / Denied (CLP02=4) / Remit Review.
  BNR Closed when: status in {Billed, Denied, RA Edits}, balance $0, at
  least one charge, all claims Closed/Void (or none), guarantor $0.
  **After 835 receipt a claim can ONLY end up Denied / Remit Review /
  Closed** — any other post-835 status is a bug.
- Payment Details view: raw 835 (header, 1000A/B, 2000/2100/2110 from LX
  above the matching CLP) vs readable toggle; adjustments (CAS),
  adjudication (MIA/MOA — exactly one per invoice), supplemental
  (AMT/QTY); discrepancy list clickable to highlight (flag set per ERP
  v8.0 Table 2 — SZ33346).
- CARC/RARC reference data: attachment 104202 (xlsx, 3 sheets).

Historical layer (5009, superseded): rule engine over DBI 22073 (parsed
835 JSON): denied (CLP02=4) -> "HB Claim Denials"; underpaid (above
`balance.underPaidThreshold`) -> "HB Underpayment Claims" or auto TC 4001
below threshold; overpaid -> "HB Overpayment Claims" or auto TC 4101
below `balance.overPaidThreshold`. BNR status "RA Edits" when a remittance
action needs correction. Folded into 5006's per-CARC dropdown model.

## EDI transactions

| Set | Direction | Purpose |
| --- | --------- | ------- |
| 837I / 837P (005010X222A1) | EHR -> clearinghouse | claims; nightly single batch file, all payers |
| 999 (AKN) | clearinghouse -> EHR | functional acknowledgment of the 837 |
| 276 | clearinghouse (auto) -> payer | claim status query (Availity sends it for us) |
| 277U | clearinghouse -> EHR | unsolicited payer claim status, daily (~20:00 EST) |
| 835 (ERA) | payer -> clearinghouse -> EHR | remittance advice |

Key segments:

- **837**: HL hierarchy, BHT, SBR, CLM (CLM01 = invoice/claim number,
  CLM05-01/03 = bill type on 837i / POS on 837p), REF (D9, 6R = charge ID,
  F8 = original claim number for replacements/voids), HI (DR = DRG, ABK/
  ABF = POA), LX service lines (SV1, SV2 01/02/03/05, DTP 472), NTE,
  2330A/B (other payers), 2400/2420/2430 loops.
- **835**: loops 1000A (payer) / 1000B (payee) / 2000 (TS304 control
  count) / 2100 (CLP, CAS, NM1, DTM, AMT, QTY) / 2110 (SVC, CAS); LX per
  claim. CLP01 invoice, CLP02 status (4 = denied; 19/20/21/23 = forwarded
  by payer), CLP03 billed, CLP04 paid, CLP05 patient responsibility,
  CLP08/09 bill type/POS, CLP11 DRG. CAS01 group (PR/CO/OA). MIA claim-
  level / MOA adjustment-level remark codes (exactly one present per
  invoice). PLB/BPR patient liability summary. REF*6R = charge link.
  Validation balances: 2110 `SVC03 = SVC02 - sum(CAS amounts)`; 2100
  `CLP04 = CLP03 - sum(CAS)`; `BPR02 = SUM(CLP04) - sum(PLB)`.
  CAS-loop rule: if a CAS exists in Loop 2100, ignore Loop 2110 CAS.
- **277U**: match claim by Loop 2200D TRN02 = 837 CLM01; STC03 = U ->
  rejected (STC12 = message text). File dedup by TRN (8-digit) + datetime.
  Messages display newest-first (SZ33228); "Rejected" overrides any code
  mapping (SZ33968).
- **999**: dedup by ISA13 (9-digit) + datetime; CTX01-1 context type;
  IK501/AK901 in {M,R,W,X} -> rejected (999 treats W as rejected, unlike
  277U which only treats U).

Matching 835 -> claim: CLP01 = 837 CLM01 AND 835 Loop 1000A N104 (payer)
= 837 Loop 2010BB NM109. Discrepancy flagging (835 vs 837) is limited to
Payee ID, Bill Type/POS, Total Claim Charge, DRG Code — case-insensitive;
mismatch is a soft error (payment still posts). Flag set per ERP v8.0
Table 2 (SZ33346).

Raw 277U/999 files are NOT stored in the DB (277U moved to a "processed"
folder); 835 data is parsed/indexed per the 5006 mapping (DBI 22073 JSON
for the rule engine). 837 originals live in the patient volume dir
`volx/pxxxxxxxxx/EDI`. Untranslated parser messages must still render as
a fallback (SZ34744) — an empty rejection message is a bug.
