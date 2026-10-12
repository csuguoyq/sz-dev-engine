# Code map by area

Where each family actually touches. The block marked **VERIFIED** was
checked against the repository on 2026-09-02 (claim main-directory
scope); the rest is historical orientation — verify against the current
repository before use. Scope the change from the FRD + Figma, not from
any SZ's committed file list (hard rule 2).

## VERIFIED 2026-09-02 — Claim frontend (ehr/src/Charge/Claim/)

```text
Fee.tsx          Billing tab hub (per BNR): CustomTabs (multi-invoice
                 tabs) + Overview = CardList (summary cards) + 5 sections
                 (UnbilledCharges / InsuranceClaims / GuarantorBalance /
                 Payments / Adjustments) + TimeLine sidebar.
                 One submit flow, 4 submitTypes: toBill / Submit /
                 BNREditToBill / ClaimEditToBill -> manuallySubmitBill /
                 manuallySubmitClaim / forceSubmitBill. WebSocket
                 bill_data_changed -> cross-session refetch. Dirty guard
                 via ChargeDirtyDataContext + CciUnsavedDataDialog.
Claim.tsx        Claim form (per-invoice tab): Handlebars template render
                 + 13 React edit components in components/edits/*;
                 dirty tracking cps-helpers/dirty.js + ClaimAtom;
                 getClaimPage/saveClaimPage/printClaim/resolveClaim.
Payment.tsx      Payment details tab (835 raw vs readable).
Billing/         InsuranceClaimTable, PaymentTable, AdjustmentTable,
                 GuarantorBalanceTable, UnbilledChargeTable, TimeLine
                 (activity types: Admitted/CheckIn/Complete/In Progress/
                 Warning/Error + claim statuses + Notes with pin/edit/
                 delete; chips All/Activity/Status/Notes/Pinned).
components/      CardList (summary cards, filingStatusView,
                 getDeadlineDays), AdjustmentDialog, BNRDialog,
                 BNRRangeBox, BNRForceReason, DeleteConfirm, Service-
                 DetailGrid, Custom* (Panel/Tabs/Header/DatePicker/
                 SearchInput/DetailPanelToggle), edits/* (13 quick-fix
                 fields).
context/         NAMESPACE TRAP: holds BOTH jotai atoms (BillingAtom,
                 ClaimAtom) AND React Context (BillingContext,
                 TabContext). BillingAtom = cards/BNR range/submit state;
                 ClaimAtom = dirty/pages/claim error/refresh flags.
util/            ClaimData.ts = 26 endpoint wrappers, ALL -> claim/<action>
                 (postData/getData, axios); ClaimHooks.tsx = react-query
                 (useGetBillingActivities, useGetAllClaims); Transform.tsx
                 = convertClaimDataFromDB; ClaimUtil.ts = formatters.
```

Cross-module hooks used by Claim (do not duplicate):
`ChargeServices/util/ChargeServicesHooks.tsx` (useGetBNRInfoQuery,
useGetPatientEncounterQuery, useGetEntityCodeMap, ...),
`Registration/util/QueryHooks` + `DataHooks` (insurance, encounter,
true-self-pay).

## Backend (webframe)

```text
webframe/app3/classes/Controller/Claim.php
                 44 action_* methods; each maps 1:1 to a HOBJ via
                 Model_Ycql::ycqlQuery({hobj: 'claim/<name>', ...}).
                 Actions include: getClaimData, saveClaimData,
                 getClaimList, voidClaim, resubmitClaim,
                 replacementClaim, getAdjustmentsData, saveAdjustmentData,
                 deleteAdjustment, getBillingActivities, saveBillActivity,
                 delBillActivity, saveBillPause, manuallySubmitBill,
                 manuallySubmitClaim, forceSubmitBill, saveRemittance-
                 Action, approveStatement, getGuarantorList,
                 getGuarantorStatementDetail, getPaymentData,
                 getTransactionCodeData, ...
```

## Data access (ycql)

```text
HOBJS/claim/             52 HOBJs: getclaimlist, getpaymentdata,
                         getpaymentlist, getREdata, getadjustmentsdata,
                         getchargelist, getstatuslist,
                         getoutstandingedits, getbillingactivities,
                         getbnredit, savebillinfo, savebillactivity,
                         savebillpause, deletebillactivity, forcebill,
                         manuallysubmit, voidclaim, resubmitclaim,
                         savedata, genguarantorstatements, getguarantor-
                         list, getguarantorstatement{detail,list},
                         getguarantorcardlist, getguarantorpaymentrecord-
                         list, getguarantorspayment, payguarantor-
                         spayment, saveguarantorcard,
                         saveguarantorspayment{record},
                         saveremittanceaction, gettransactioncode,
                         getpastpaymentlist, getpaststatementlist,
                         getpatientsummaryresult, resolve277,
                         fixbalances, fixadjustment, fixstatement, ...
HOBJS/bnrstatus/         BNR status init
HOBJS_hopd/bnrStatusUpdate/  BNR status update daemon (hopd)
HOBJS/lib/               evaluateRules.fun, billpause.fun,
                         billInsurance.fun, genTransactionID.fun
HOBJS/worklists/         worklist data access + status updates
HOBJS/registration/      getbnrinfo, getbnrs, getencounter,
                         getpatientinsurance, savepatientinsurance,
                         getguarantorinfo, saveguarantor
```

## Config / choices (HOBJS_webess/)

```text
claim/                   cms-1450.{conf,tpl} (UB-04/837i),
                         cms-1500.{conf,tpl} (837P), 837to835.js
choices/                 claim_state (00-24), frequency_type,
                         bill_pause_reason, rarc, place_of_service,
                         claim_note_status, claim_owning_area
```

## C utilities

```text
util/EdiAvaility/        837/835/277/999 parsers: AvailityUtil.c/.h,
                         AvailitySection{,837i,837p}.c, ClaimParser.c,
                         EdiParser.c, BaseParser.h, ediAvaility835.c,
                         ediAvaility837.c, ediAvaility277.c,
                         ediAvaility999.c, Edi277Parser.c,
                         Claim999Parser.c, CsrParser.c, FtpManager.c,
                         resumePaused835.c, claim.rcf
ruleExec/                ruleexecd.C (rule daemon; util/RuleEngine/
                         ruleengined.C was merged into ruleExec,
                         SZ28007)
trigger/                 trigger.rcf
util/ycql/ruleengine/    rule sets per rule type: BNRRules/, ClaimRules/,
                         ChargeRules/, AuthRules/, AutoClaimRules/,
                         RegistrationRules/, RemittanceActionRules/,
                         None/<edit-reason>/ (GuarantorPause,
                         BNRBalance, Missing*, ...) — each a rule.rcf
util/reimbursement/      XR loaders: loadReimbursementDb.py,
                         reimbursement*.yaml, XR_Tables*.xlsx
cclib/cds/               rule engine C library
```

## Guarantor Payments (5013) — orientation

Verify in the current repo; C-3PO file lists are not the spec.

```text
ehr/src/component/   PaymentDrawer, CciButtonGroup / PaymentButtonGroup,
                     components/GuarantorPaymentTpl.tsx,
                     context/DrawerAtoms.tsx, util/{VerfoneApi,api}.ts
                     (filename is VerfoneApi — missing "i")
Registration/        components/guarantors/GuarantorFormToolbar.tsx
                     (US-0010 Pay from Registration, cost center 7900)
ChargeServices/      Guarantor/tab-views/billing-details/* (US-0020),
                     util/guarantor/transforms.ts
Claim/Billing/       PaymentTable, GuarantorBalanceTable, AdjustmentTable
Claim/Fee.tsx        BNR Billing Tab Pay (US-0030, cost center 8300)
webframe/.../        Controller/{Verifone,Claim}.php
HOBJS/claim/         getguarantorcardlist, saveguarantorcard,
                     getguarantorspayment, payguarantorspayment,
                     saveguarantorspayment{,record},
                     getguarantorpaymentrecordlist,
                     updateguarantorstatement
HOBJS_webess/        preService/data.json
scripts/             InitGuarantorDB.ycql
3rdparty/Windows/    EPVerifoneSetup_E2E_1039.exe (+ README)
DBI 22155            guarantor_payment (vdata, SD406448)
```

## Frontend — the rest

```text
Charge/ChargeServices/   ChargePatient (BNR overview, tabs),
                         Guarantor/** (guarantor view), util/
                         {BillPauseDialog,BillPauseButton,
                         BillPauseStatus,ChargeServicesHooks}.tsx
RemittanceAdvice/        manual remittance entry app (SZ33658)
Registration/            write-back targets: guarantors/*, accounts/*,
                         demographics, encounter, insurance
RuleEngine/              rule builder UI
Worklists/               worklist UI (ContextPanel)
common/modules/perms/    permission framework
Charge/config/Perms.ts   feature -> permission wiring
```

## Scripts / web

```text
scripts/                 submitClaims.sh (837 batch job),
                         InitWorkListDB.ycql, UpdateWorkListDB.sh,
                         InitGuarantorDB.{sh,ycql}, genGuarantor-
                         Statements.sh, InitCSRDB.sh, appli_perms.m
webframe/app3/classes/   Controller/{Claim,Registration,Charge,
                         Verifone}.php, Model/*,
                         Model/edi/{EDI_835_Generator,RemittanceData-
                         Converter,RemittanceForm}.php
webframe/webframe.rcf    ASG (thresholds etc.)
$CCSISDYR/claim.rcf      CSR FTP config
```
