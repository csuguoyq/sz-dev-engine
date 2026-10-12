# Developer gotchas

Learned from the FRD threads and the 2026 SZ digests. Grep this file for
the symptom before changing code.

## Concept traps

1. **"Claim Edits" is a flagging feature, not editing.** The editing
   feature is Quick Fixes (5021). "An edit" = a flagged issue.
2. **FRD typo**: ERP US-0300 cites posted amount = "CLP104"; the paid
   amount is CLP04 everywhere else.
3. **Bill Pause status ambiguity**: FRD text wavers between "BNR Edits"
   and a literal "Bill Pause" status for paused late-stage BNRs. The
   `rule.rcf` + `HOBJS/bnrstatus` code is the source of truth.
4. **"Claim Edits" vs "CH Edits"**: same BNR status in the 277U FRD (two
   names for one state).
5. **ERP v6.0 doc body contradicts its own revision history** on the
   Payments table columns (Expected Reimbursement/Balance) — trust the
   revision note + the implementation.
6. **Figma links live in the FRD body**, often not in the SZ comments.
7. **Insurance card balance** = sum of claim balances where Payer = the
   card's payer (250-20-5020 US-2000); it only refreshes after the
   `submitClaims` job runs. After a void with a received remit, the card
   shows a negative balance (credit) — that is correct.
8. **999 treats W as rejected; 277U only treats U.**
9. **Raw 277U/999 files are not stored**; only parsed messages are.
10. **CAS loop rule**: CAS in Loop 2100 overrides Loop 2110 CAS.

## Money / claim-lifecycle traps

11. **Secondary billing guard**: create the secondary claim only when
    totalCharges > payments; use the secondary payer's contract (a real
    historical bug reused the primary payer).
12. **Bill Pause pending items = Adjustments table only**; Unbilled
    Charges is unaffected.
13. **Dual-daemon BNR status race** (test + campus daemons) is the classic
    Bill Pause test failure — the pre-pause recorded status is what gets
    restored.
14. **Permission production numbers (238/239/240) do not match the v1.0
    FRD numbers**; use `appli_perms.m`.
15. **EasyPay/Verifone quirks** (SZ28113): silent JSON POST needs
    `eSubmission: "0E11"` and the callback is read from the POST
    **InputStream**, not the query string. `PostURL` must be reachable
    from the US region (non-US hosts 502'd). AES-256 on widget params:
    `EINDEX` `"317"`; before decrypt, replace SPACE with `+` in Base64.
    Card-on-file duplicate check = last-4 + exp date. SAVE CARD
    (`Index2.html`) validates and returns ConsentID only — it does
    **not** authorize an amount; charge a stored card via EasyPay REST.
    New PHP controllers need a Makefile entry (`Verifone.php` was
    missing — SZ28307).
16. **Next-in-Line is pre-calculated** (SA95053) — don't derive it from
    the claim's own adjustments.
17. **Crossover claims** share the primary's invoice number and skip FTP
    + Claim Edits entirely (Pass Thru, 22).
18. **Resubmit keeps the same claim number**; replacement/late-charge
    claims get new numbers. Voided/resubmitted originals lose kebab
    actions and must be excluded from table totals.
19. **Void is final** and only flips the original when the Void/Cancel
    claim (frequency 8) is actually Submitted.
20. **Late charges are inpatient-only** and require BNR status Billed.
21. **Initiate billing suppresses** the late-charge auto-claim behavior;
    out-of-range charges stay Unbilled and block BNR closure.
22. **Worklist primaryUser/supervisor = the rule creator** (per-user
    worklist assignment not implemented).
23. **Quick Fixes fields 80 (Remarks), PBNR 19 (Additional Info) are not
    persisted anywhere**; field 72 (POA) is claim/837-only and must not
    override DBI 21996 `med_coding_result`.
24. **Client-specific (WRHH/White Rock)**: remittance-action landing step,
    no auto write-off of CO codes. Check the SZ for client scoping.
25. **Rule engine deployment**: new rule dirs under
    `conf/ruleengine.template/` must be copied to `conf/ruleengine/` in
    the install (see the Bill Pause IN28246 example).
26. **`claim_state` choice list is appended, never renumbered** (23, 24
    were added at the end) — never reorder it.

## 2026 SZ digests (billing tab & corrections)

27. **Reversals must post even when the transaction amount exceeds the
    current account balance** (SZ34132) — don't add balance checks to
    reversal paths.
28. **A billed insurance must stay visible in the Billing tab** even if
    its termination date changes or it is inactivated (SZ34059) —
    CardList filters by billed status, not coverage validity.
29. **Claim form opens blank** is a recurring CEF/resize bug in
    CardList/Claim (SZ33564, SZ33597, SZ34925) — verify fixes in BOTH
    Chrome and CEF; it is resolution/size-dependent.
30. **Insurance card grows/shrinks on hover** with multiple valid
    coverages (SZ33643) — CardList layout issue; also check SZ34943
    (multi-coverage card display).
31. **Resubmitted claims must be "Ready to Submit" on creation**
    (SZ33301).
32. **"Rejected" overrides the status mapping**: if the claim is Rejected,
    show Rejected regardless of what the code maps to; always show the
    full timestamp of the response (SZ33968).
33. **277 messages display newest-first** (SZ33228).
34. **timelyFilingDays must match the insurance termination date**
    (SZ33479) — the 90-day default has to reconcile with the DB value,
    or the counter shows the wrong number of days.
35. **Self-pay discount**: display in parentheses and include it in the
    Adjustments Total (SZ33348).
36. **Charity added after the claim was generated**: Billing tab did not
    show the other insurance options (SZ34825) — insurance list derives
    from encounter data, re-check when charity/insurance changes late.
37. **Start Billing failed for late-charge scenarios** (SZ35088) and for
    diagnosis display (same SZ) — the initiate-billing path has
    late-charge-specific branches.
38. **Add Adjustment: "Balance Type" is required, but BNR-level
    adjustments** (no claim, no guarantor) must still post (SZ33214) —
    also: dropdown clear-date bug was in the same fix.
39. **Permission checks are now server-side enforced too** (SZ33602) —
    client-side `cci.cfg.perms` alone is insufficient for new entry
    points.
40. **Statement Review (SZ34109)**: Approve should move "Review Needed"
    -> "Approved"; a test env using a different HOBJS dir made it land on
    "Submitted" — check the test HOBJS dir before doubting the code.
41. **ruleexecd calling updateDeficiency too frequently locks
    worklist.db** (SZ33678) — deficiency timeline/worklist failures can
    be DB-lock related, not code logic.
42. **Insurance adjustments recorded without a linked claim break
    claim/insurance-level balancing** (SZ34775) — data repair path
    exists; new postings must always link to the claim.
43. **Insurance card calculation must include insurance adjustments**
    (SZ32964, `util/Transform.tsx`).
44. **Admit/Discharge activity timestamps** come from the
    `getbillingactivities` query field, not the encounter field
    (SZ34926).
45. **Consecutive dates-of-service coverage**: the active coverage shown
    on the BNR must respect DOS; financial class displays in the BNR
    Billing header (SZ3579).
46. **Remittance actions are editable at line/claim level in Step 2 of
    the Remit Record**; "Edit" in Payment Details navigates to Step 2,
    then Save & Continue proceeds to Step 3 (SZ33658).
47. **True self-pay data structure changed** (`insuranceDatas.
    selfPayDetails...`) — old "TODO TSP" references were removed in
    SZ33162; don't reintroduce the old shape.
48. **Transaction payment tab gating** (SZ35202): selecting Pre-Service +
    a BNR enables the Payment tab; "No BNRs available to pay" is a real
    state, not always a bug.
49. **Guarantor payment PCI** (SZ28113 / DBI 22155): never store full
    PAN or CVV. EasyPay callback `CardNumber` is last-4. Sean initially
    disallowed expiration; Clinical later allowed the listed callback
    fields (including `ExpireDate`) — verify the current `guarantor_payment`
    schema in the repo before adding columns.
50. **Pre-service copay/deductible** (SZ28113 US-0070/US-0010) come from
    the **RTE** payload (`InsuranceDetailsCard`, att 93234), not a local
    table. Service Type can change which RTE amounts display.
