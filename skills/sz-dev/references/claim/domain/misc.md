# Misc — end-to-end cycle, glossary, module conventions

Sections are independent — read only the one you need.

## End-to-end revenue cycle (quick picture)

```text
Encounter (ADT) -> charges in Unbilled -> BNR created (HBNR/PBNR)
  -> BNR: Created -> Active/Discharged -> [hold period]
  -> overnight BNR rules: BNR Edits | Ready to Bill
  -> claim generation 837I/837P -> overnight claim rules:
     Errored + BNR Claim Edits | Ready to Submit + BNR Billed
  -> nightly 837 batch -> Submitted -> 999 (reject: Rejected + CH Edits)
  -> 277U (reject: same) -> payer accepts -> 835 remittance
     -> auto-post payments (2000/2100) + adjustments (4000/4001/4100/4101)
     -> remittance actions per CARC
     -> Closed | Denied (CLP02=4) | Remit Review
  -> COB: next coverage's claim when primary Closed
  -> guarantor: balance move -> statements -> dunning (4th = bad-debt)
     -> guarantor payments (1000/1001)
  -> BNR Closed: balance $0, all claims Closed/Void, guarantor $0
```

Cross-cutting: Bill Pause, Replacement/Corrected/Void/Late Charges,
Reimbursement Estimation (XR), AR Management, Revenue Cycle Permissions
(gates everything).

## Glossary

- **BNR** — Billing Number Record; the patient account. **HBNR** =
  hospital (UB-04/837I/claims 11x), **PBNR** = professional
  (CMS-1500/837P). An account aggregates sub-BNRs per coverage.
- **Claim / invoice** — the bill sent to a payer. Claim number format:
  `H100000000101` = H:org-type, 100:org, 00000:unique counter, 01:BNR
  counter, 01:invoice counter (resubmits increment the invoice counter).
- **Guarantor** — the person/entity responsible for patient
  responsibility; may cover many patients. "True self-pay" patients skip
  the claim workflow entirely.
- **ERA / 835** — Electronic Remittance Advice; payer's payment
  explanation. One file can cover many claims/patients.
- **Clearinghouse** (Availity in this deployment) — intermediary that
  scrubs 837s, forwards to payers, passes back 999/277U/835.
- **CARC** — Claim Adjustment Reason Code; the CAS segment in an 835
  (CAS01 group PR/CO/OA; reason in CAS02/05/08/11/14/17; amount CAS03).
  **RARC** = Remittance Advice Remark Code (MIA/MOA/LQ segments).
- **XR / Expected Reimbursement** — what the payer is expected to pay,
  computed from contract pricing terms.
- **Remittance action** — the action taken for a CARC (worklist add, or
  write-off/adjustment transaction). Rule engine proposes; user can
  override before posting.
- **Transaction code (TC)** — the posting type on the BNR.
- **Rule engine** — daemon-evaluated rule sets (`rule.rcf` under
  `util/ycql/ruleengine/`, run by `ruleexecd` + `trigger/trigger.rcf`).
  Rule types: BNR, Claim, Remittance-Action (RA).
- **Worklists** — `worklist.db` (`t_worklist`, `t_workitem`); e.g. "HB
  Claim Denials", "CH EDI - Rejected", "Late Charge".
- **ASG** — administration settings. **DBI / vdata** — data bus items /
  versioned data tables (DBI 22073 = parsed 835 JSON, 22278 =
  `billing_info`, 22227 = `billing_activities`, 22155 =
  `guarantor_payment`, majorIT 22152 = coverage
  priorities). **Choices** — `HOBJS_webess/choices/*` lookup tables.
- **WRHH** — White Rock Health (client); several behaviors are client-
  specific.

## Module working practices (ehr frontend; condensed from
ehr/src/Charge/CLAUDE.md)

- **Where files go**: `Claim/context/` holds BOTH jotai atoms AND React
  Context — a naming trap. `Claim.tsx`/`Fee.tsx`/`Payment.tsx` are
  legacy top-level files; **new Claim UI goes in `Claim/components/`**.
  `ChargeAdmin/` is the clean template; `ChargeServices/` keeps its own
  atoms/constants/types/util/contexts separate from top-level `Charge/`.
- **State management** — three mechanisms: jotai atoms (use for new
  global state), React Context+useReducer (NOT the pattern to build on),
  react-query via existing hooks. No new Context+reducer; no direct
  axios/fetch from components.
- **Validation**: two mechanisms (JSON rules + CodingRules.ts) in the
  coding-view area, neither shared with Registration. Don't invent a
  third.
- **Reuse**: check `ehr/src/common` before building generic things.
  Avoid importing directly from sibling feature modules; in coding-view
  the real field logic lives in `blocks/*FormBlock.tsx`, not the
  top-level `*DynamicForm.tsx` wrappers.
- **TypeScript**: heavy legacy `any` (incl. `FC<any>`); avoid `any` in
  new code where reasonably avoidable, but don't drive-by-cleanup legacy
  files.

## Post-review packaging (colist + tar)

After code review passes, package the changed files for submission:

1. In the `ccsrc` directory, list the changed files with **git** (NOT
   `anyfiles` — that lists the whole tree):

   ```text
   git diff --name-only | sed 's|^|./|' > colist
   ```

   Format: ccsrc-relative paths, `./`-prefixed. Untracked NEW files are
   not in `git diff` — append them to `colist` by hand.
2. Package with `tar` directly (`ptall` has no name option — its output
   name is derived from `pwd`):

   ```text
   # stage package — one per stage (plan / implementation / test fixes), for easy restore
   tar zcvf ~/sz/SZ<code>_<YYYYMMDDHHMM>.tar.z $(cat colist)
   # final submission package — bump v1 -> v2, v3 ... if code changes again
   tar zcvf ~/sz/SZ<code>_ccsrc_v1.tar.z $(cat colist)
   rm colist
   ```

Gotchas:

- `colist` is **not** git-ignored — `rm colist` after packaging so it
  doesn't leak into the commit.
- `colist` is the base for the other dev tools (coall / cmall / ptall);
  `colist -g` incrementally appends new files to an existing colist.
