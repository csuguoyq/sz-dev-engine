# Claim Billing — End-to-End Claim Generation Playbook

> Charge-module workflow for **manually producing a billable claim** in the live
> EHR so billing / claim code can be tested. This is the human-driven path that
> feeds the overnight BNR→claim engine: it walks every module in order, then
> **forces** claim generation by back-dating `lgtime` in the BNR-status DB and
> running `updateBNRStatus`.
>
> This file is a **router + sequence checklist**. Each step links to the
> module skill doc that owns the deep detail (selectors, gotchas, verified
> browser recipes) — do not duplicate that here. Read the linked doc before
> doing a step you have not done before. Claim *domain* knowledge (status
> models, transaction codes, formulas) lives in
> `skills/sz-dev/references/claim/domain/claim-lifecycle.md`, not here.

## Why this exists

A claim is not created by a single button. It is the terminal output of a
chain: a registered patient with a guarantor + insurance, an inpatient
encounter that is admitted and discharged, a BNR carrying posted charges that
are coded (Diagnosis + DRG + Complete), and then the nightly BNR rules that
move the BNR to **Ready to Bill** and generate the claim. For testing we
**short-circuit the wait** for the accounting/hold period by back-dating
`lgtime` and invoking `updateBNRStatus` directly.

## Prerequisites

- A reachable demo/test environment (e.g. SDMC `fbch34` / `fbch19`).
- **Log in explicitly** with `demo` / `123` (click **Username/Password Login**).
  Navigating straight to `Cps` can auto-load a limited session that shows
  "patient database is locked" and renders Patient Control empty.
- Reach a patient via `skills/ehr-ui/browser-testing/SKILL.md` → Cps landing →
  **Patient Control** → pick/open a patient (or **Create New Patient** first —
  see `skills/ehr-workflow/registration/SKILL.md`).
- You will drive the browser **through the Playwright MCP directly** (AGENTS.md
  rule #4). Most patient sub-tabs (Guarantors, Insurance, Encounters, Accounts)
  are hidden from the accessibility snapshot until selected — use the
  side-effect `.click()` pattern from
  `skills/ehr-workflow/registration/workflows/guarantors.md` (match the tab
  text against `[role=tab], .MuiTab-root`, click, re-snapshot).
- Shell access (`.dosu`, `ycql`, `updateBNRStatus`) for the final two DB steps.
  You need the patient/encounter **`dbpath`** (the per-patient DB path used in
  BNR-status lookups) and `$CCRUN`.

## Sequence at a glance

```text
1. Register        → create patient (Registration / Demographics)
2. Guarantor       → add guarantor, Save and Close
3. Insurance       → add + save a payer plan (primary coverage)
4. Encounter       → create Inpatient Acute encounter (Planned) -> Admit
5. BNR             → Admit the encounter → Hospital child BNR auto-created
                     (or Create BNR manually if none exists)
6. Charge          → post a charge to the BNR (Quick/Manual Charge → Submit)
7. Coding          → Diagnosis + DRG + Complete (Coding Status → Complete)
8. OE              → place an ACTIVE DISCHARGE order
9. Discharge       → Encounters → open encounter → Discharge Patient
10. DB (lgtime)    → back-date lgtime 4 days (simulate accounting period)
11. Trigger        → .dosu $CCRUN/bin/updateBNRStatus  → claim generated
12. Verify         → claim appears; BNR → Billed / Ready to Bill
```

---

## 1. Register (create the patient)

Open **Registration** → **Create New Patient** (or use an existing patient from
Patient Control). Fill required demographics (name, DOB, SSN, address, …) and
save. After save you land on the patient's **Demographics** sub-tab; the other
sub-tabs are not yet exposed to the snapshot.

- **Search gating**: **Create New Patient** is disabled until the search form is
  dirty + valid — the fastest way is to fill **only MRN** (`90001`); the screen
  flips to *"No results have been found…"* when the button enables.
- **Dialog** (`create-patient-*-field` testids): fill First/Last (+timestamped
  Last Name), SSN (date-encoded random), Address/City/Zip, then D.O.B. via the
  MUI X DatePicker calendar, then Sex / State / Citizenship comboboxes.
  Submit = `create-patient-create-button` → toast *"Patient Creation Successful"*
  (auto-dismisses) → new patient tab opens on Demographics.

Deep detail + verified recipe: `skills/ehr-workflow/registration/workflows/patient-creation.md`.
The patient must be a **real** Registration patient (not an orphan billing record —
see `skills/ehr-workflow/charge/workflows/charge-patient.md` §6) or no BNR can be
created later.

## 2. Guarantor

On the patient tab strip, reach the **Guarantors** sub-tab via the side-effect
click pattern (text match `/guarantor/i`).

1. **Guarantor Overview** → **Add Guarantor** (`guarantor-overview-add-guarantor-button`).
2. **AddGuarantorDialog**: pick **Relationship to Patient = Self** (default).
3. At the bottom of the results list click **`+ Create New Guarantor`** → opens
   a **New Guarantor** tab. For **Self**, the form auto-populates from patient
   demographics.
4. Fill required fields, then **Save and Close**
   (`guarantor-form-save-and-close-button`) → toast
   *"Successfully created new Guarantor, and associated to Patient"* (this toast
   auto-dismisses fast — confirm via the persistent state instead: the
   `New Guarantor` tab closes, `Guarantor Overview` returns, and a new row with
   `Relationship To Patient = Self` / `Status = Active` appears).

Deep detail + verified recipe: `skills/ehr-workflow/registration/workflows/guarantors.md`.

## 3. Insurance

Reach the **Insurance** sub-tab (side-effect click, text match `/insurance/i`).

1. **Insurance Overview** → **Add Insurance** (`insurance-add-insurance-button`)
   opens the blank tab **and** the plan dialog together.
2. In **AddInsuranceDialog**, search a payer/plan (`add-insurance-lookup-search-field`,
   min 3 chars, e.g. `68888` → BCBS PPO). Select the plan radio → submit
   (`add-insurance-dialog-submit-button`, disabled until a plan is chosen).
3. The New Insurance form prefills from the plan. Set **Relationship to
   Subscriber = Self** (`insurance-insured-relationship-field`) so the Subscriber
   section auto-fills. On `fbch34` also set **Member ID** (`insurance-memberId-field`)
   and **Effective Date** (they are required there before Save).
4. **Save** → tab renames to the payer, status line gains an `Unverified …`
   timestamp, and the coverage appears in the Overview grid. (Verify Manually /
   E-Verify optional.)

Deep detail + verified E2E recipe (add → save → verify → reorder → delete,
env-specific required fields):
`skills/ehr-workflow/registration/workflows/insurance.md`.

## 4. Encounter (Inpatient Acute)

Reach the **Encounters** sub-tab (side-effect click, text match `/encounter/i`;
verified id `simple-tab-4`).

1. **Create New Encounter** (`encounters-new-encounter-button`).
2. Pick a **Facility** first (`encounters-facility-field`) — the `type` field is
   disabled until a facility is chosen.
3. Pick a **type** that exercises the plain **Create Encounter (CENC)** flow:
   **Inpatient Acute** (an outpatient type would switch to the ambulatory
   Check-In path). 
4. Set **status** (Planned/Arrived). For an ADT inpatient the effect sets it to
   `Planned`.
5. Fill ADT required extras: **Admit Type** (`encounters-admitType-field`, e.g.
   `Elective`), **Expected Date/Time** (`#encounters-expDatetime` — click the
   input, the picker auto-fills *now*, then click **OK**), and for a billable
   type also **Guarantor Type** (`encounters-guarantorType-field`) + **Guarantor**
   (`encounters-guarantor-field`). ⚠️ **These two are context-dependent**: once
   step 2 has created a **Self / Medical** guarantor, the type dropdown offers
   **only `Medical`** (not `Entity`/`Person`) and the Guarantor dropdown lists
   **that patient's own guarantor** — the `Entity → "Mini Reg Guarantor"` pair
   applies only to a patient that has *no* guarantor yet.
6. **Create Encounter** (`encounters-form-save-button`) → toast
   *"Encounter Created"* (auto-dismisses). A **Planned** ADT encounter lands in
   the **Scheduled Encounters** table (Start Date/Time = the Expected Date/Time),
   **not** Active — it moves to Active only after Admit (step 5).

> ⚠️ **Dropdowns**: a real Playwright click on an MUI Autocomplete `input`
> (type/facility/guarantorType/guarantor/…) reverts the whole Registration view
> to the bare Cps landing. Drive these with the synthetic dispatch protocol
> (pointerdown→mousedown→pointerup→mouseup→click, then click the
> `li[role=option]` in a *separate* evaluate call) from
> `skills/ehr-workflow/registration/workflows/encounters.md`.

Deep detail + verified recipe: `skills/ehr-workflow/registration/workflows/encounters.md`
("Create New Encounter").

## 5. BNR (account)

A Hospital child BNR is **auto-created on Admit** (`H<baseId>01`); you normally
do not need a separate create. If the encounter is still `Planned` and you need
a BNR first, **Admit** the encounter (encounters.md "Admit an inpatient
encounter") to trigger the auto-create, or use **Create BNR** manually:

- **Admitting** (verified fbch34 2026-09-16): open the Scheduled row → **Admit**
  → fill Admit Details in `dependsOn` order (**Point of Origin / Means of Arrival
  → Level of Care → Admit Unit → Room/Bed**) via the synthetic dropdown protocol
  → **Admit Patient** → toast *"Patient Admitted"*; the form title flips to
  **"Inpatient Encounter - In Progress"**, the row moves **Scheduled → Active**,
  and the actions become **Transfer** / **Discharge**. ⚠️ **HIPAA Consent does
  NOT default to `Yes`** (left untouched its raw `1` is recorded as **`No`**) —
  select `Yes` explicitly when consent is required, and read the
  `encounters-admit-<field>-summary` nodes to confirm what was actually saved.

- **Accounts (BNR)** sub-tab → **Create BNR** (`accounts-create-bnr-button`) →
  **CreateBnrDialog**: select a **Base BNR** radio, pick **BNR Type** chip
  (`Hospital | Professional | Research/Other`), then **Create BNR** →
  `doRegAction("CBNR")`. On success the app navigates into the new BNR's edit
  form.
- For claim testing pick **Hospital** type. Professional/Research BNRs get no
  BNR Details card.

Verify a BNR exists (child row, `Open` link) in either Registration's
**Accounts (BNRs)** tab or Charge's **BNR Overview**. If the patient shows
`None`, you have an orphan record — pick a different patient (charge-patient.md §6).

Deep detail + verified recipe: `skills/ehr-workflow/registration/workflows/accounts-bnr.md`.

## 6. Charge entry

Open **Charge Services** → Account Lookup → patient tab → **BNR Overview** →
click **`Open`** on the Hospital child BNR row → BNR tab → **Charges** subtab →
**Add Charges**.

1. **Quick Charge** is the default mode. Click a charge-code row in the bucket
   tree (e.g. `Injection (Non-Chemo)` → `96372`) → it appends to the **Charge
   Queue** (`charge-queue-data-grid`).
2. **Submit** (`charge-queue-submit-button`, disabled while empty) → queue
   empties and the charge posts.
3. Verify in **View Charges**: the code appears with today's date/time,
   **Status `In Process`**, and the BNR header **Account Balance** updates.

(Use **Manual Charge** chip when you need fields not in the bucket tree.)

Deep detail + verified recipe: `skills/ehr-workflow/charge/workflows/charge-edit.md`
and `skills/ehr-workflow/charge/workflows/charge-patient.md` (§3–§4 navigation).

## 7. Coding (Diagnosis + DRG + Complete)

On the same BNR tab, open the **Coding** subtab.

1. If **Coding Status** is not `In Progress`, click **Begin Coding**
   (`begin-coding-session-dialog-begin-button`).
2. **Diagnosis** tab → **Add Diagnosis** → drawer: for the first-time run it
   shows **Admit Diagnosis** + **Principal Diagnosis** blocks; `Save Diagnosis`
   enables only when both hold a valid `ICD 10-CM Code` (search by **term**,
   e.g. `diabetes`; unique match auto-selects). Save → rows in the Diagnosis
   table.
3. **DRG** tab → **Add DRG** → drawer: search `DRG` (code or description, e.g.
   `470`), which auto-fills Description/Type/MDC/Weight/ALOS/GLOS. Set the two
   **required** fields **Severity Illness** + **Risk Mortality**
   (`1 - Minor` … `4 - Extreme`). **Save DRG** → row in the DRG table.
4. **Complete** (`coding-complete-button`) — disabled until **both Diagnosis and
   DRG** exist; click it → **Coding Status → Complete** (timestamped).

> ⚠️ MUI Autocomplete for DRG/Diagnosis needs **real keystrokes** (Playwright
> `fill` does not trigger the async search). For DRG use the native-value-setter
> + `input` event trick; for Diagnosis use `click` to focus then `press_key` per
> character, then Enter to open the listbox. See
> `skills/ehr-workflow/charge/workflows/coding.md` §2–§3.

Deep detail + verified recipe: `skills/ehr-workflow/charge/workflows/coding.md`
and `skills/ehr-workflow/charge/workflows/charge-patient.md` §5.

## 8. OE — place an ACTIVE DISCHARGE order

The Encounter **Discharge** action is order-gated: it needs an Active DISCHARGE
order, otherwise Save stays disabled ("missingOrder"). Place it first.

1. Patient Control → open the patient → left rail **ORDER ENTRY** (`?gotoscreen=cpoe_psat&gototab=CPOE`).
2. **NEW ORDERS** → **Browse** → expand **ADT** → click the **Discharge**
   category → tick the **Discharge patient** order → **Add (1)**.
3. In the pre-Add panel set **Authorizing Provider** (required; type-to-filter
   autocomplete, e.g. `ttest ttest`) and **Starting at** / **Order Mode**
   (pre-filled).
4. In the expanded Order Details set **Discharge Disposition** (required
   combobox, e.g. `Home or self-care`) — this value flows into the encounter
   Disposition at discharge.
5. **Submit** (`cpoe-submit-btn`) → confirm the **Validation Dialog** (re-enter
   password, e.g. `123`, then OK). A plain ADT order skips the Med-Warnings step.
6. Verify the order appears under **EXISTING ORDERS** (ADT group) as **Active**.

Deep detail + verified recipe + gotchas (sticky `x-mask`, password re-entry,
checkbox-id drift):
`skills/ehr-workflow/oe/workflows/creating-an-adt-order.md`.

## 9. Discharge the patient (Encounters)

Return to **Registration** → patient → **Encounters** sub-tab → open the Active
encounter row (`tr:has-text("Inpatient Acute")`) → the right panel shows
`… Encounter - In Progress`.

1. Click **Discharge** → the Discharge Details section expands. With the Active
   DISCHARGE order present it shows **"Order in Place"** and auto-fills
   **Discharge Date/Time** + **Disposition** (from the order).
2. Click **Discharge Patient** (`button:has-text("Discharge Patient")`) →
   `useEncounterMutation(..., "DISCH")`.
3. Verify: panel reads **"Patient Discharged"**, **Encounter Status → Finished**,
   the encounter moves from **Active** to **Historic Encounters**, and the
   Active Encounters table reads **None**.

Deep detail + verified recipe: `skills/ehr-workflow/registration/workflows/encounters.md`
("Discharge an inpatient encounter").

## 10. Back-date `lgtime` (simulate the accounting/hold period)

The nightly BNR rules only move a discharged BNR to **Ready to Bill** /
generate a claim after its hold/accounting window elapses. For testing, shift
`lgtime` back **4 days** so the window is already past. Get the patient's
`dbpath` (the value used in BNR-status rows) and run:

```bash
echo "update bnrstatus set lgtime = lgtime - 4 * 24 * 3600 where dbpath like '%$dbpath';" \
  | .dosu ycql $CCRUN/workdir/bnrStatus/bnrStatus.db
```

- `$dbpath` — the per-patient/encounter DB path stored in the `bnrstatus` table
  (use a trailing `%` LIKE match so you don't need the full path).
- `$CCRUN` — the environment's run directory (e.g. `$CCRUN/workdir/bnrStatus/bnrStatus.db`).
- `lgtime` is a unix timestamp; subtracting `4 * 24 * 3600` = 4 days back-dates
  the accounting trigger so `updateBNRStatus` sees the BNR as eligible.

## 11. Trigger claim generation

Run the BNR-status processor, which re-evaluates eligible BNRs and generates
the claim(s):

```bash
.dosu $CCRUN/bin/updateBNRStatus
```

This is the same engine the overnight batch uses; running it now (after the
`lgtime` shift) produces the claim immediately instead of waiting for the
scheduled run.

> ⛔ **Environment constraint (verified fbch34 2026-09-16, re-verified 2026-09-17):
> steps 10–11 may be un-runnable from the dev shell.** The BNR-status DB
> `/fbch/workdir/bnrStatus/bnrStatus.db`,
> its directory, and `/fbch/log` are owned `nobody:cis` with the `cis` group
> **read-only**, so the shell user (in group `cis`) can `SELECT` but not write —
> the `lgtime` UPDATE fails (`ycql` reports
> `Error: near line 1: attempt to write a readonly database`). The `SELECT` of
> the patient's row still works and is worth doing anyway (confirms the BNR
> row exists, e.g. state `Discharged` after step 9). `sudo` is also genuinely broken (`/usr/bin/sudo` +
> `/etc/sudo.conf` owned by `nobody`, no setuid), so the `.dosu` wrapper
> (`sudo -H -u cis`) cannot execute at all; and there is no running CliniComp
> daemon to drive. When this blocks the natural path, go straight to the
> **Force Bill fallback (§11b)** — that is the expected action, not a failure.

> ⚠️ **If the BNR stays in "BNR Edits" after `updateBNRStatus`** — i.e. the
> BNR rules evaluate as *true* (e.g. **HB Claims Edits – Registration Related**,
> triggered by missing Admission Order / H&P / Discharge Summary documents) —
> the natural path will **not** auto-bill. The BNR never reaches **Ready to
> Bill**, so no claim is generated. In that case use the **Force Bill** fallback
> below to produce the claim for testing.

### 11b. Force Bill fallback (when BNR is in Edits)

When the BNR is parked in **BNR Edits** and you only need the claim to exist for
downstream billing/claim testing (you do not need to resolve the underlying
registration documentation edits), generate the claim directly from the BNR's
**Billing** subtab:

1. **Charge Services** → patient BNR → **Billing** subtab → **Start Billing** →
   **Bill Now** → **Force Bill**. The Force Bill screen shows the **HIM Pending
   Deficiencies** (the open registration-related edits — e.g. `Missing Admission
   Order`, `H&P Missing Within 24 Hours of Admission`, `Discharge Summary Note
   Missing` — that will resurface as the claim's edits) plus the payer card.
   Fill the **justification**: it is a **`<textarea>` with placeholder
   `Give a justification`** (dynamic id, e.g. `:rsb:`; set it via the native
   textarea value setter + `input` event, e.g.
   `test claim, override registration edits`). The **submit** is the **second
   `Force Bill` button** (the first occurrence is the screen entry/title) — it is
   **disabled until the justification is non-empty** → submit.
2. The claim is created and surfaces in the Billing list immediately, **bypassing**
   the BNR/Claim Edits gate.

This produced a valid, testable claim even though the BNR never left Edits. In the
verified run (2026-09-16) the claim surfaced in the Billing list with status
**`Created`** (payer BCBSTX) and the **Billed** milestone set, while the BNR — and
the DB row `bnrstatus.status` — stayed **`Claim Edits`**; some runs instead surface
the claim in an **Errored (02)** state. All are valid test fixtures (the claim is
in the DB and drivable by claim code). Example ids from that run: encounter
`1650345231` → Hospital BNR `H100165034523101` → claim `H10016503452310101`.
A second full run (2026-09-17, same host): encounter `1650345362` → Hospital BNR
`H100165034536201` → claim **`H10016503453620101`** (BCBSTX, $511.00) — it first
surfaced as **`Created`** and then **settled to `Errored`** (02) within seconds,
labeled **`HB Claims Edits – Registration Related`**, while the BNR header read
**`Billed`** (Billed milestone `Billed – Claim Edits: Today`) and the `bnrstatus`
DB row read **`Ready to Bill`** — i.e. the claim status, BNR state and DB state
can all move a step forward after creation; re-check the Billing list after a
pause before judging the end state.

## 12. Verify the claim

- **Charge Services** → patient BNR → **Billing** subtab (claim/fee billing):
  the new claim should appear. With the natural `updateBNRStatus` path the BNR
  reads **Billed** / **Ready to Bill** (terminal states). With the **Force Bill**
  fallback the claim exists regardless — verified **`Created`** (with the
  **Billed** milestone) on fbch34 2026-09-16, seen as state **Errored (02)** in
  other runs, and on 2026-09-17 seen starting `Created` and settling to
  **Errored** (02) while the BNR header read **Billed** and the `bnrstatus` DB
  row read **Ready to Bill**. The BNR itself may stay at **Claim Edits** or
  advance to **Billed**. All are valid test fixtures. See
  `skills/ehr-workflow/charge/SKILL.md` (Claim billing) and
  `skills/sz-dev/references/claim/domain/claim-lifecycle.md` for the status model.
- Cross-check the BNR-status DB / worklist: the BNR is no longer in "edits" and
  the claim row exists with a claim number.
- For downstream testing (submission, remittance, secondary/COB), continue from
  `skills/sz-dev/references/claim/` (FRD catalog, domain map).

## Notes / common failures

- **No claim after `updateBNRStatus`** → usually the `lgtime` shift didn't
  match (wrong `dbpath`/LIKE), the encounter was never Discharged, coding was
  not `Complete`, or there are no posted charges on the BNR. Re-walk steps 6–9.
  If instead `updateBNRStatus` ran but left the BNR in **BNR Edits** (rules true,
  e.g. registration-related documentation edits), the natural path will **not**
  bill — use the **Force Bill** fallback (§11b) to generate the claim.
- **Force-Billed claim lands in state Errored (02) / BNR stays `Claim Edits`** →
  expected when the BNR is still in Edits (open registration docs: Admission Order
  / H&P / Discharge Summary). Verified 2026-09-16 the Billing list showed status
  **`Created`** with the Billed milestone while `bnrstatus.status` = **Claim
  Edits**; 2026-09-17 showed the claim settling to **Errored (02)**
  (`HB Claims Edits – Registration Related`) while the BNR read **Billed** and
  `bnrstatus` read **Ready to Bill**. The claim is still valid for testing in
  every variant; resolve the underlying edits only if you need a clean `Billed`
  claim. Note the claim status can change **after** first appearance — allow a
  short pause and re-check the Billing list before concluding.
- **Steps 10–11 fail with a write/permission error** → the `bnrStatus.db` is
  `nobody:cis` **read-only** and `sudo`/`.dosu` is broken in the dev shell (§11
  constraint). Use the **Force Bill** fallback (§11b); this is an environment
  limitation, not a data problem.
- **Discharge Save disabled** → no Active DISCHARGE order (step 8) or
  `adtOrderRequired` path not satisfied.
- **Orphan patient (BNR `None`)** → the MRN has no Registration record; the
  claim chain cannot start. Pick a real patient (charge-patient.md §6).
- Keep module-specific selectors/gotchas in their **own** skill docs; this
  playbook only sequences them.
