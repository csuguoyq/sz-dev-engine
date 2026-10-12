# Claim Module SZ History

Full changelog of SZs touching `ehr/src/Charge/Claim/` (main directory),
from git history. One line per SZ (first commit date). `*` = FRD-carrying
SZ (family in the last column); prior-art for a key SZ is fetched on
demand from softzilla MCP (`bug_info` / `bug_comments`), not for every
`*` row.
Source: `git log` on `ehr/src/Charge/Claim/` @ commit of last sync.

Type is guessed from the title (feat/bug) — trust the title, not the tag.

Last synced: 2026-08-19 (latest commit in scope). 145 SZs, 145
commits, 2024-05-20 to 2026-08-19. Verified against the current
branch (ee-branch) on 2026-09-01: two rows from an earlier sync of
another branch (SZ28539, SZ35158) were dropped.

## 2026 (46)

| SZ | Date | Type | Title | FRD family |
| -- | ---- | ---- | ----- | ---------- |
| SZ32728 | 01-02 | feat | Resolve eslint warnings.(Part 3) - Charge |  |
| SZ32831 * | 01-26 | feat | - [SD411629][Registration] True Self Pay FRD: US100 | True Self Pay US-100 |
| SZ32837 | 01-26 | feat | Avoid using import * as React from 'react' |  |
| SZ32959 | 01-26 | feat | console warning of Claim.tsx, Fee.tsx, and ChargeServicesHooks.tsx |  |
| SZ32964 * | 01-26 | bug | Insurance Card Calculations Not Reflecting Insurance Adjustment | 5020 card calc |
| SZ32967 * | 01-26 | feat | Post-Service Payments reference | BNR Post-Service |
| SZ32979 | 01-26 | feat | consolidate handlebars helper functions in a single place |  |
| SZ33029 | 01-26 | bug | missing ref when call React.forwardRef... |  |
| SZ33057 * | 01-26 | feat | 277 Response File Messages Corrections | 5035 277U |
| SZ33128 * | 01-26 | bug | Billing Tab - Adjustments Section Issues | 5020 Adjustments |
| SZ33127 * | 02-09 | feat | BNR and Claim Status Updates | Status model |
| SZ33162 * | 02-09 | feat | True Self-Pay US-120: Accepting Payments for True... | True Self Pay US-120 |
| SZ33214 * | 02-09 | bug | Unable to Add to BNR, Dropdown Clear Data,... | 5020 Adjustments |
| SZ33228 * | 02-09 | feat | The 277 messages need to be displayed from newest to oldest | 5035 277U |
| SZ33301 * | 02-10 | bug | Void-Resubmit-Replacement Claims Issues | 5014 Void/Resubmit |
| SZ33346 * | 02-10 | bug | UI Issues with Payment Details View | 5006 835 (v8.0) |
| SZ33348 * | 02-10 | bug | Automated Self Pay Discount - issues in UI and... | 5020 Self Pay |
| SZ33286 * | 02-13 | feat | AR Management and Visibility | 3034 AR Management |
| SZ33489 * | 02-26 | bug | Replacement Claim Issues | 5014 Replacement |
| SZ33479 * | 02-27 | bug | Issues with AR Management and Visibility | 3034 AR Mgmt (GoLive) |
| SZ33564 * | 03-02 | bug | Claim form opens as blank | 5020 blank form |
| SZ33597 * | 03-03 | bug | Claim form opens as blank in CEF | 5020 blank form (CEF) |
| SZ33579 * | 03-10 | feat | Coverage Effective/Termination Dates Linking to BNRs Correcly | Coverage/BNR |
| SZ33570 | 03-11 | feat | All Date and Time Pickers Should Allow Server Time |  |
| SZ33510 * | 03-12 | bug | Void Claim Issues | 5014 Void |
| SZ33643 * | 03-13 | bug | On Billing Tab, Multiple Insurance Coverages cause UI Resizing Error | 5020 CardList UI |
| SZ33658 * | 03-25 | feat | Add ability to add Remittance Actions on the line level or claim level | 5009 Remittance Actions |
| SZ33678 * | 03-25 | bug | Issues with HIM Deficiencies displaying in the... | HIM Deficiencies |
| SZ33738 * | 03-25 | feat | After HyperJump to Charge... | 3034 HyperJump |
| SZ33512 * | 04-01 | feat | Improve Transaction Code Table and Balance Updates | TC Table v2.0 |
| SZ33801 * | 04-01 | feat | Clearinghouse Status Messages Display as x12 Language, UI Updates | 5035 277U |
| SZ33968 * | 04-08 | bug | Clearinghouse Status Messages Display as x12 Language, UI Issues | 5035 277U |
| SZ34132 * | 04-22 | bug | Transaction Reversal Limited by Acct Balance Amount | 5020 Reversal |
| SZ34109 * | 05-01 | feat | Add new "Statement Review" rule to Statement Edits | 5007 Statement Review |
| SZ34059 * | 05-13 | feat | Billing Tab should show always Insurance... | 5020 Insurance Card |
| SZ34744 * | 06-03 | feat | Prevent empty translated claims rejection messages | 5014/277 parser |
| SZ33602 * | 06-05 | feat | Server-Side Enforcement of Application Access with Persistent Audit Logging | Server-side perms |
| SZ34581 * | 06-05 | feat | - GoLive feedback - Changes to User Notes sections | Notes/GoLive |
| SZ34825 * | 06-10 | feat | Charity Not Linking to Encounter | 5020 Charity |
| SZ34775 * | 06-12 | bug | Balancing Issues - Transactions Not Linked to Claim Invoice | 5020 Balancing |
| SZ34925 * | 06-23 | bug | Claim page loads blank with console error when navigating via... | 5020 blank form |
| SZ34943 * | 06-24 | bug | The Insurance Card displays incorrectly when there are multiple insurances | 5020 Insurance Card |
| SZ34926 * | 06-25 | bug | Incorrect Timestamp in Patient Admit/Discharge Activity on BNR Billing Tab | 5020 Timeline |
| SZ35088 * | 07-10 | bug | Start Billing does not work well for late charge | 5014 Late Charge |
| SZ35202 * | 08-04 | feat | - [SD416960] Transaction Payments Only Enabled After Going to Insurance First | Transactions/Payments |
| SZ34080 * | 08-19 | bug | Insurance with Termination Date in the past is not displayed in Historical View | Registration/Insurance |

## 2025 (38)

| SZ | Date | Type | Title | FRD family |
| -- | ---- | ---- | ----- | ---------- |
| SZ29523 | 01-14 | feat | Need to be able to edit the claim form without popping out the boxes |  |
| SZ29605 | 01-14 | bug | Blank white screen is displayed when clicking on claim form |  |
| SZ29703 | 01-23 | feat | should not handle src/Charge/Claim/Claim.css in ccsrc/ehr/Makefile |  |
| SZ29734 | 02-06 | feat | Enhancement for the Billing Tab | 5020 Billing Tab (v2.0) |
| SZ29868 | 02-14 | bug | Issues with the Billing tab and new edits to claim form |  |
| SZ29937 | 02-26 | bug | Issue with field 8b of 837 claim form cannot update to the original name. |  |
| SZ30178 | 04-02 | feat | Refactor Demographics to use Dynamic Form Config |  |
| SZ31035 | 06-30 | bug | Admit, Disch, and Encounter type display blank on Claims form |  |
| SZ31100 | 07-03 | bug | The claim chart is displayed as blank if the clearinghouse is set to Waystar |  |
| SZ31112 | 07-03 | feat | Print Insurance Claims shows empty printout |  |
| SZ31166 | 07-09 | bug | Account balance is calculated incorrectly |  |
| SZ30974 * | 07-12 | feat | Claim Status Response (999) FRD | 5039 999 |
| SZ31227 | 07-15 | feat | Place of Service being displayed for... |  |
| SZ30761 * | 07-17 | feat | Claim Status Response Files (277U) FRD | 5035 277U |
| SZ31303 | 07-24 | feat | Need to update claim scripts (837to835, submitClaims,... |  |
| SZ31360 | 07-24 | feat | - [RCM][WRHH] Certain DT Fields in RCM Need to Be Adjusted for Differences Between Server/Local Machine Time |  |
| SZ31469 | 07-31 | bug | Incorrect insurances indicated in Billing tab |  |
| SZ30727 * | 08-11 | feat | Enhancements for Reimbursement Estimation (v8.0) | 5003 XR |
| SZ31750 * | 09-15 | feat | Billing Tab v3.0 | 5020 Billing Tab (v3.0) |
| SZ31990 | 09-23 | bug | The status in the Paid Amount box shows wrong Claim Status |  |
| SZ31976 | 09-24 | bug | ][WRHH][SD411976][Claim] Issues with the Billing Tab |  |
| SZ31919 | 09-29 | feat | Expected Reimbursement shown as NA |  |
| SZ32045 | 10-01 | feat | Need to update Claim Invoice Numbering System |  |
| SZ32141 * | 10-15 | feat | Billing Tab UIUX Feedback | 5020 Billing Tab |
| SZ32232 | 10-17 | feat | Guarantor Balance Delay |  |
| SZ32295 | 10-24 | bug | Force Submit does not log in Billing Activities |  |
| SZ32398 | 11-06 | feat | Remove the loop and segment information from CH/Payer Edits |  |
| SZ32379 | 11-10 | feat | Guarantor force bill and adjustments are not updated |  |
| SZ32434 | 11-12 | bug | Issues with voided claims |  |
| SZ32544 | 11-13 | feat | Billing Tab tables should be collapsed by default |  |
| SZ32438 | 11-17 | feat | [SD412596][WRHH][Claim] Improve Resubmit and Replacement claims |  |
| SZ32588 | 11-18 | feat | Insurance Cards Include Inactive Payers |  |
| SZ32650 | 12-08 | bug | Issues with Adjustments section of the Billing tab |  |
| SZ32655 | 12-08 | bug | Issues with Resubmit Claim Action |  |
| SZ32661 | 12-08 | bug | Issues with 277 EDI Messages |  |
| SZ32753 | 12-29 | feat | Need to see all 835 remits associated with the... |  |
| SZ32787 | 12-29 | feat | - [SD411480][Registration][WRHH] Insurance Change Updates FRD: US-220 Deleting a Coverage |  |
| SZ32906 | 12-29 | feat | When adjustment is added from claim table, the... |  |

## 2024 (61)

| SZ | Date | Type | Title | FRD family |
| -- | ---- | ---- | ----- | ---------- |
| SZ27635 | 05-20 | feat | Migrate charge and registration projects... |  |
| SZ27672 | 05-20 | bug | Unable to match the revenue code to the Contract Management file |  |
| SZ27705 | 05-22 | feat | Enhancement for Payment Posting | 5006 835 |
| SZ27666 | 05-31 | feat | Implementation for Claim Edits | 5015 Claim Edits |
| SZ27736 | 05-31 | feat | Common Directory Refactor with EHR Folder Migration |  |
| SZ27575 * | 06-21 | feat | Implementation for Remittance Actions | 5009 Remittance Actions |
| SZ27859 * | 06-29 | feat | Guarantor statement | 5007 Statement |
| SZ27864 | 07-03 | feat | subtask of SZ27864 -- Resolve existing Config.ts files in ehr |  |
| SZ27871 | 07-03 | feat | subtask of SZ27864 -- Resolve existing Config.ts files in ehr |  |
| SZ28070 | 07-05 | feat | Dollar Amounts Differ In Multiple Locations |  |
| SZ28074 * | 07-09 | feat | Enhancements for Claim Edits | 5015 Claim Edits |
| SZ28094 | 07-09 | feat | make more sense to have the sub-apps define only a single sub-config object |  |
| SZ27870 | 07-11 | feat | Refactoring EHR Registration/shared directory into EHR common |  |
| SZ28051 | 07-12 | feat | Update ccsrc/ehr/src to consistently use esmodule format instead of cjs format |  |
| SZ28090 * | 07-12 | feat | Guarantor Billing View  (encounter-based approach) | 3016 Billing View |
| SZ28118 | 07-15 | feat | Enhancement for Payment Posting (part 2) | 5006 835 |
| SZ28119 | 07-17 | bug | Issues with claim edits and claim view |  |
| SZ28138 | 07-17 | bug | Issue with Guarantor Billing View  (encounter-based approach) |  |
| SZ27972 * | 07-18 | feat | Secondary Billing | 5012 COB |
| SZ28135 | 07-22 | feat | Clean up import statements for @mui/system in ccsrc/ehr |  |
| SZ28177 | 07-24 | bug | Mismatch of payer and missing financial class |  |
| SZ28230 | 08-01 | bug | Can't move away from Billing tab |  |
| SZ28132 * | 08-02 | feat | Replacement and Corrected Claims | 5014 Repl/Corrected |
| SZ28250 | 08-05 | feat | Unexpectedly kicked out of EHR to Screenlock - Login Screen |  |
| SZ28113 * | 08-06 | feat | Guarantor Payments | 5013 Payments |
| SZ28253 | 08-06 | feat | Service line number should not be displayed if the... |  |
| SZ28296 | 08-08 | bug | Outstanding Edits link points to the wrong source |  |
| SZ28264 | 08-09 | feat | Registration Reset Patient State when Tab Closed |  |
| SZ28351 | 08-12 | feat | Enhancements for Guarantor Payments | 5013 Payments |
| SZ28365 | 08-12 | feat | The variable name compiledTemplate  and parent function name are confusing |  |
| SZ28352 | 08-14 | feat | When Guarantor has a balance, the claim form disappears |  |
| SZ28392 | 08-15 | feat | When multiple patient tabs are open, current patient data is NOT retained |  |
| SZ28412 | 08-19 | bug | Issues with guarantor payments | 5013 Payments |
| SZ28315 | 08-20 | feat | Modify Guarantor Type to Allow for Multiple Types |  |
| SZ28476 | 08-22 | bug | Getting MUI console error when trying to make payment in Billing tab |  |
| SZ28492 | 08-22 | feat | The Billing tab is crashed due to HOBJ claim/getGuarantorList |  |
| SZ28475 | 08-23 | feat | Balance on the claim is unaffected by the transaction |  |
| SZ28482 | 08-23 | feat | Allways show all payment records |  |
| SZ28457 | 08-26 | feat | Not able to jump into the specific areas... |  |
| SZ28449 | 08-27 | feat | Detail page cache improvement for Claim |  |
| SZ28504 | 08-29 | bug | BNRs not displayed in Payment Transactions when the... |  |
| SZ28558 | 09-02 | bug | Issue with multiple patient tabs open that retaining each others BNR info |  |
| SZ28246 | 09-13 | feat | The implementation for Bill Pause feature | 5016 Bill Pause |
| SZ28538 * | 09-13 | feat | When adding an adjustment and saving, the Billing tab is not updating | 5020 Billing Tab (balance) |
| SZ28677 | 09-20 | feat | Claim is not being generated after Bill Pause is disabled |  |
| SZ28660 | 09-23 | bug | Getting console errors when clicking on guarantor... |  |
| SZ28674 | 09-23 | feat | Need additional context for claim edit resolution |  |
| SZ28633 * | 09-24 | feat | Enhancements for Guarantor Payments (FRD v2.0) | 5013 Payments |
| SZ28665 | 09-24 | feat | Toggling between two BNRS retains the first BNRs info |  |
| SZ28326 | 09-25 | feat | Enhancements for Reimbursement Estimation (CLAB and APC services) | 5003 XR |
| SZ28736 | 09-26 | feat | Data in Claim Overview tab will lost when toogle between "claim details" tab |  |
| SZ28728 | 09-29 | feat | When Bill Pause is active, the “Enable Bill Pause” .. |  |
| SZ28619 * | 10-09 | feat | revenue cycle permissions | 13001 Permissions |
| SZ28834 * | 10-11 | feat | Enhancements for Bill Pause | 5016 Bill Pause |
| SZ28776 * | 10-14 | feat | Add Remit Review claim state to the BNR and Claim status flowchart | 5005 Submission |
| SZ28859 | 10-14 | feat | Each Statement increment needs to be listed within Statements to Pay | 5013 Payments |
| SZ29035 | 11-12 | feat | Enhancements for Payment Posting (v6.0) | 5006 835 |
| SZ29268 | 12-07 | bug | Issues with Replacement and Corrected Claims |  |
| SZ29195 * | 12-12 | feat | Billing Tab Overhaul | 5020 Billing Tab (v1.0) |
| SZ29198 * | 12-16 | bug | Claim Edit Quick Fixes | 5021 Quick Fixes |
| SZ29413 | 12-18 | feat | Account Balance and Insurance Claim Balance are zero... |  |
