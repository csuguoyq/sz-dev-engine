# Billing/Claim FRD Catalog

Version catalog for the Billing/Claim module FRDs. Use this in Phase 1 to
answer two questions before reading anything:

1. Which FRD family does the SZ belong to?
2. Which version of that FRD is the LATEST — and is the attachment on the
   current SZ that latest version?

Never assume the FRD attached to the current SZ is the latest. Several
families have multiple versions carried by different SZs. The latest
version is authoritative; older versions are read only to understand
evolution (their Revision History tables summarize the deltas).

Attachment IDs below are Bugzilla attachment IDs — no MCP download
tool: fetch them with a web reader (`attachment.cgi?id=<n>`) and
cache under `.sz-dev/SZxxxx/attachment/`.

---

## 1. FRD version catalog

| P/N | Title | Version history (version — SZ — attachment) | Latest |
| --- | ----- | ------------------------------------------- | ------ |
| 250-20-5003 | Reimbursement Estimation | v6.0 — SZ28326 — 93534 (08 Aug 2024); v7.0 (24 Sep 2024); v8.0 — SZ30727 — 98477 (23 May 2025) | v8.0 |
| 250-20-5005 | Electronic Claims Submission | v4.0 — SZ28776 — 94445 (27 Sep 2024) | v4.0 |
| 250-20-5006 | Electronic Remittance Processing (835) | v1.0 (04 Mar 2024); v2.0 (12 Apr 2024); v3.0 — SZ27705 — 92194 (13 May 2024); v4.0 (13 Jun 2024); v5.0 — SZ28118 — 93111 (05 Jul 2024); v6.0 — SZ29035 — 94945 (18 Oct 2024); v7.0; v8.0 — SZ33346 — 104203 (05 Feb 2026) | v8.0 |
| 250-20-5007 | Guarantor Statement | v1.0 — SZ27859 — 92512 (30 May 2024) | v1.0 |
| 250-20-5009 | Remittance Actions | v1.0 — SZ27575 — 91879 (26 Apr 2024). **Superseded**: folded into Electronic Remittance Processing (250-20-5006); the rule-based worklist/write-off layer became per-CARC remittance actions | superseded |
| 250-20-5012 | Secondary Billing (COB) | v1.0 — SZ27972 — 92709 (13 Jun 2024) | v1.0 |
| 250-20-5013 | Guarantor Payments | v1.0 — SZ28113 — 93093 (09 Jul 2024); v2.0 — SZ28633 — 94132 (09 Sep 2024) | v2.0 |
| 250-20-5014 | Replacement and Corrected Claims | v1.0 — SZ28132 — 93150 (12 Jul 2024) | v1.0 |
| 250-20-5015 | Claim Edits | v1.0 — SZ27666 — 92088 (06 May 2024); v2.0 — SZ28074 — 92970 (01 Jul 2024) | v2.0 |
| 250-20-5016 | Bill Pause | v1.0 — SZ28246 — 93359 (29 Jul 2024); v2.0 (02 Aug 2024); v3.0 — SZ28834 — 94519 (23 Aug 2024) | v3.0 |
| 250-20-5020 | Billing Tab | v1.0 — SZ29195 — 95362 (18 Nov 2024); v2.0 — SZ29734 — 96490 (21 Jan 2025); v3.0 — SZ31750 — 100688 | v3.0 |
| 250-20-5021 | Claim Edits Quick Fixes | v1.0 — SZ29198 — 95367 (18 Nov 2024) | v1.0 |
| 250-20-5035 | Claim Status Responses (277U) | v1.0 — SZ30761 — 98583 | v1.0 |
| 250-20-5037 | 277U/999 exception handling | referenced by 277U/999 FRDs; no attachment in this set | n/a |
| 250-20-5039 | Claim Status Responses (999) | v1.0 — SZ30974 — 99042 (18 Jun 2025) | v1.0 |
| 250-20-3016 | Guarantor Billing View | v1.0 — SZ28090 — 93016 (26 Mar 2024) | v1.0 |
| 250-20-3034 | AR Management | v1.0 — SZ33286 — 104114 | v1.0 |
| 250-20-13001 | Revenue Cycle Permissions | v1.0 — SZ28619 — 94093 (03 Sep 2024); Rev 2.0 — SZ28619 — 94555 (27 Sep 2024) | Rev 2.0 |

Referenced but not in this SZ set (locate via the citing FRD's SZ thread
if a task depends on one):

| P/N | Title | Known from |
| --- | ----- | ---------- |
| 250-20-0008 | BNR Structure | cited by 5006, 5016, 5020 |
| 250-20-5001 | Claim generation / Claims UI | cited by 5003, 5014 |
| 250-20-5002 | Transaction Codes | cited by 5003, 5006, 5020. **The code set was redefined by the Transaction Code Table v2.0 (SZ33512, attachment 104633, 2026-03) — 17 codes incl. refunds/transfers; fetch via softzilla MCP (`bug_info SZ33512`)** |
| 250-20-0010 | Medical Coding Ph1 | cited by 5020 |

---

## 2. Supersession and family relationships

- **Remittance/835 family**: Electronic Remittance Processing (5006) is the
  end-to-end 835 pipeline (intake, match, posting, statuses, BNR close).
  Remittance Actions (5009, SZ27575) was the earlier rule-layer SZ; read it
  only for history of the remittance-action concept. SZ27136 implemented the
  original 835 payment posting that 5006 v1.0 builds on.
- **Claim lifecycle family**: Claim Edits (5015) flags errors after claim
  generation; Quick Fixes (5021) is the direct field-editing feature;
  Replacement and Corrected Claims (5014) covers void/resubmit/late charges;
  Electronic Claims Submission (5005) covers the nightly 837 batch;
  277U (5035) and 999 (5039) cover clearinghouse/payer status responses.
- **Guarantor family**: Billing View (3016) is the guarantor-level back
  office; Statement (5007) generates patient statements + dunning;
  Payments (5013) posts guarantor payments (v1.0 **SZ28113** is the
  EasyPay/Verifone foundation; latest FRD is v2.0 **SZ28633**). A
  single guarantor may cover many patients/BNRs.
- **Money math**: Reimbursement Estimation (5003) computes expected
  reimbursement (XR) at billing time and posts TC 4001 proactively;
  Electronic Remittance Processing (5006) posts actual payments and defines
  claim balance; Secondary Billing (5012) handles COB sequencing.
- **Cross-cutting**: Bill Pause (5016) can stop the insurance and/or
  guarantor side per sub-BNR; Billing Tab (5020) is the UI hub for all of
  it; AR Management (3034) adds visibility/reporting; Revenue Cycle
  Permissions (13001) gates every action.

---

## 3. Flowchart and supplemental attachments

| Attachment | SZ | Content |
| ---------- | -- | ------- |
| 92107 / 92105 | SZ27575 / SZ27666 | BNR & claim status flowcharts (image) |
| 93360 | SZ28246 | Insurance Bill Pause diagram (image) |
| 93961 | SZ28538 | Claim Balance diagram (image) |
| 99344 | SZ30727 | XR matching logic flowchart (image) |
| 98659 | SZ30761 | Claim Information Flow (277/999) (image) |
| 103687 | SZ33127 | BNR and Claim status diagram (image; most detailed) |
| 104202 | SZ33346 | CARC/RARC code library (excel) |
| 102682 | SZ32655 | Screenshot: resubmit-claim requirement |
| 105178 | SZ33510 | Insurance card balance requirement |
| 104992 | SZ33658 | Remittance Actions updates illustration |
| 104633 | SZ33512 | Transaction Code Table v2.0 (excel, 17 codes — authoritative TC set) |
| 104634 | SZ33512 | TC Table + Add Adjustment mapping (docx, image-based) |
| 103916 | SZ33127 | BNR/Claim status update examples (png) |
| 103842 | SZ33127 | Initial status-update code package (tgz, not a spec) |
| 93093 | SZ28113 | Guarantor Payments FRD v1.0 (superseded by v2.0 att 94132) |
| 93094 | SZ28113 | EasyPay usage guide |
| 93095 | SZ28113 | EasyPay REST API QuickStart |
| 93096 | SZ28113 | EasyPay REST Postman collection (JSON sample) |
| 93147 | SZ28113 | EasyPay Encryption Key Provisioning — fetch if decrypting; **do not copy keys into skill docs** |
| 93148 | SZ28113 | EasyPay Jquery Middleware Responses |
| 93149 | SZ28113 | Jquery Verifone sample |
| 93234 | SZ28113 | Insurance Details Card (RTE copay/deductible source) |
| 93485 | SZ28113 | EPVerifone middleware installer (`3rdparty/Windows/`) |

Image attachments are often not parseable by the text pipeline. When an
image matters, read the citing SZ's comment thread — the discussion there
usually restates the diagram's content — or fetch the FRD text section that
references the figure.

---

## 4. Related non-FRd SZs (frequently cited in threads)

| SZ | What it is |
| -- | ---------- |
| SZ28307 | Add `Verifone.php` to the Makefile (follow-up of SZ28113; not in Claim/ git log) |
| SZ28351 | Enhancements for Guarantor Payments (5013) |
| SZ28412 | Issues with guarantor payments (5013) |
| SZ28859 | Statement increments listed in "Statements to Pay" (5013 follow-up) |
| SZ27136 | Original 835 payment posting (pre-5006) |
| SZ26840 | Original reimbursement estimation (pre-5003) |
| SZ27076 | RCM rule engine (ruleengined) |
| SZ26744 | Worklist application |
| SZ28538 | Claim balance work |
| SZ33127 | BNR/claim status rules (lowest-intervention BNR, highest-action claim) |
| SA95053 | Next-in-Line pre-calculation source |
| SA100594 | Authorizations FRD (worklist example) |
| SZ33512 | Transaction Code Table v2.0 + real-time balance calcs |
| SZ34132 | Reversal no longer blocked by account balance |
| SZ34059 | Billed insurance stays visible even if terminated |
| SZ33510 | Void claim balance / insurance card balance |
| SZ33214 | Add Adjustment: BNR-level posting + Balance Type required |
| SZ33579 | Consecutive-DOS coverage linking + financial class in header |
| SZ35088 | Start Billing for late charges |
| SZ35202 | Transaction payment tab gating (Pre-Service + BNR) |
| SZ33968 | Rejected overrides status mapping; full timestamps |
| SZ33228 | 277 messages newest-first |

---

## 5. How to use this catalog in Phase 1

1. Read the SZ. From title + comments, identify the FRD family.
2. Look the family up above. Note the LATEST version and its SZ/attachment.
3. If the SZ's own attachment is not the latest version, say so to the
   human and read the latest version as authoritative.
4. Read the latest FRD fully; read older versions' Revision History tables
   only for evolution context.
5. Fetch the citing FRDs' P/Ns from the latest FRD's References table.
6. Code scope comes from the FRD use cases + Figma — not from the SZ's
   or sibling SZs' committed file lists (C-3PO "Checked in" messages)
   or MRs, which are not implementation reference (hard rule 2).
