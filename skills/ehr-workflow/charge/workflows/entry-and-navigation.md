# Charge — Entry & Navigation

> **Prerequisite for every Charge workflow.** Reach the Charge module from the EHR portal before interacting with its UI.
> The tools referenced below are the **Playwright MCP** tools (`playwright_navigate`, `playwright_evaluate`, `playwright_click`, `playwright_fill`). They map to the `browser_*` tools described in `skills/ehr-ui/browser-testing/SKILL.md` and `skills/ehr-ui/navigation/SKILL.md` — those files own the canonical URL/credential rules and the rail-button strategy; this doc adds the **Charge-verified specifics** and a tool-format gotcha discovered in this environment.

## 0. Where the module lives (code map)

- Main entry chain: `ehr/src/Charge/index.ts` → `export { default } from "./ChargeServices"` → `ehr/src/Charge/ChargeServices/index.tsx`.
- `ehr/src/Charge/ChargeServices/ChargeServices.tsx` — the module **starts at the Account Lookup tab** (confirmed by its header comment).
- `Charge Admin` is a separate EHR app: registered as key **`chargeAdmin`** in `ehr/src/EhrLink.ts` (`["chargeAdmin", ChargeAdmin]`); permission group `CHARGE_ADMIN` (label "Charge Services Admin") in `ehr/src/Charge/config/Perms.ts`.
- `ClinicalChargeTool` is a **separate top-level module** (`ehr/src/ClinicalChargeTool/`); it is a patient-chart drawer/queue, not the Charge Services rail app.
- Dev conventions (folders, state model, validation) live in `ehr/src/Charge/CLAUDE.md` — read it before writing code.

## 1. Login (two-step, via `Cps`)

Follow the base-URL + credential rules in `skills/ehr-ui/browser-testing/SKILL.md`. Charge-verified specifics (SDMC `fbch34`, 2026-09-09):

1. Open `https://<HOSTNAME>/webframe/index.php/logon?ctrl=cps`.
2. The page **defaults to the Smart Card panel**. Click the **"Username/Password Login"** toggle (an `<a class="x-btn auth-pki-btn …">` whose text is exactly `Username/Password Login`) to reveal the credential fields.
3. Fill **sequentially** (parallel `playwright_fill` calls race on the ExtJS form — the username ended up empty and password became `demo123` when done in parallel):
   - `playwright_fill` selector `input[placeholder='Username']` → `demo`
   - `playwright_fill` selector `input[placeholder='Password']` → `123`
   - Verify each `input.value` before continuing.
4. Click the **real** Login button — there are several elements whose text is `Login` (Smart Card login, "Login as a Different User", SSO). The username/password submit is the `<a>` whose class contains **`cci-logon-btn-cls`** and whose text is `Login`. Click that one.
5. Confirm: `document.title` becomes `USER, <USERNAME> CliniComp|EHR - San Diego Medical Center` (login as `demo` → `DRR, Darwin R …`). If the title lacks the `USER, ` prefix, you are logged out — re-run the steps.

## 2. Enter **Charge Services** (the main module)

- The left icon rail is `.home-non-navbtn-panel a`; each button's label is in a child `<span>` (hidden until hover). **Match by `<span>` text, not index** (order varies between portals).
- Click the button whose `<span>` text is exactly **`Charge Services`**. ⚠️ It is **not** labeled `CHARGE` or `Charge` — the exact label is `Charge Services`.
- On success the module loads the **Account Lookup** screen: `Patient` / `Guarantor` tabs and search fields (Patient Name, DOB, Sex, MRN, SSN), with the placeholder message `Please enter a search query.`
- Verification: `document.body.innerText.indexOf('Account Lookup') !== -1`.

Working one-liner (Playwright MCP):

```
playwright_evaluate("var as=document.querySelectorAll('.home-non-navbtn-panel a'); for(var i=0;i<as.length;i++){var s=as[i].querySelector('span'); if(s && s.textContent.trim()==='Charge Services'){as[i].click(); return 'ok';}} return 'no-charge-services';")
```

## 3. Reach a patient's charges (`ChargePatient`)

Verified live on `fbch34` 2026-09-11 (this build has **no** `Patient Records` link — the patient tab *is* the patient records view):

1. **Account Lookup search**: one search field, `input[placeholder="Search by BNR, MRN, etc."]` (accepts BNR, MRN, Encounter #, Patient Name, SSN, DOB, SEX). Type the query, press **Enter**. Results render as an MUI table (`Patient Name | DOB | Sex | MRN | SSN`).
2. **Open the patient tab**: the **patient-name cell is a link** — an `<a>` inside the first `<td>` of the result row (e.g. text `35048test1L, 35048test1F`). A single click opens a new module tab labeled with the patient name. (Clicking the row/other cells does nothing.)
3. **Patient tab → subtab `BNR Overview`** (first, auto-selected; `PatientBNRTable.tsx`). It shows the patient's BNR table (`Billing Number BNR | Admit Date | Discharge Date | Encounter Type | Encounter ID | … | Balance | Total Charges | Account Status`), a `Show Closed` checkbox, a `Search Billing Number Records` field, and a `Bill Pause` button.
   - Base BNR rows show a +/− expand icon (`data-testid="bnr-overview-plus-button"` / `bnr-overview-minus-button`).
   - The **`Open` action link** (bold MUI `<Link>`, `<a>` text exactly `Open`) is rendered **only on non-base (child) BNR rows** (see `BNROverviewTable.tsx` first column: `isBaseBNR(bnr) ? null : <Link>`). Clicking it runs `addPatientTransactionTab(bnr.bnrId)` → opens the **BNR tab**.
4. **BNR tab**: header switches to BNR details (`BNR ID`, `BNR Status`, `Financial Class`, `Account Balance`, admit/discharge). Subtabs: **`Account Summary | Charges | Coding | Registration | Billing`** (rendered only once the BNR info query resolves — `ChargePatientTabs.tsx` returns empty otherwise).
5. **`Charges` subtab** = `PatientChargeAppForChargePatient` → inner tabs **`Add Charges` / `View Charges`** (`AddChargesTab.tsx`), toolbar `Review Needed by <user> at <dt>`, `Hold`, `Complete`, and the `<BNR> - Charge Transactions` grid. The surface is long — after actions the tab bar can scroll out of view; the scroll container is `data-testid="charge-services-patient-transactions"`.
- The patient/BNR view code lives in `ehr/src/Charge/ChargeServices/ChargePatient/` (`ChargePatient.tsx`, `ChargePatientTabs.tsx`, `PatientBNRTable.tsx`). Its `coding-view/manual/forms/*DynamicForm.tsx` are thin wrappers; the real form render/validation is in `blocks/*FormBlock.tsx`, which uses the shared `@cci-monorepo/common` DynamicForm (see `ehr/src/common/components/forms/DYNAMIC_FORM.md`).

⚠️ **Orphan billing records (verified 2026-09-11)**: the Account Lookup index can contain patients that have **no Registration patient record**. Symptoms once the tab is open: header says `New Patient` with `DOB: ()` / `MRN: N/A` / `Plan Name: N/A`, and the BNR table shows `None` **even with Show Closed checked**. Cause: `useGetPatientInfoQuery(mrn)` cannot resolve a `regid`, so the BNR/insurance queries are empty. You **cannot create a BNR** for such a patient — Registration's `Create BNR` dialog (`Accounts (BNRs)` tab, `data-testid="accounts-create-bnr-button"`) requires a `regid` plus an existing **base BNR** (`useCreateBNRMutation` → `registration/createXBNR {encdbpath, bnrtype}`). Verify a patient exists by searching the same MRN in the **Registration** app before opening their charges, and prefer a patient whose BNR Overview lists rows.

## 4. Charge Admin (config)

- App key **`chargeAdmin`** (`ehr/src/EhrLink.ts`); perm group `CHARGE_ADMIN` ("Charge Services Admin") in `ehr/src/Charge/config/Perms.ts`.
- In the SDMC portal observed here it is **not** a direct rail button. Launch it from the **Enterprise Application** hub (rail button `Enterprise Application`) → the Charge Services / Charge Services Admin deep link, or via its module URL. ⚠️ Confirm the exact launcher by clicking through and update this section once verified (the launch path may differ per environment).

## 5. Clinical Charge Tool (professional capture)

- Separate top-level module `ehr/src/ClinicalChargeTool/` (drawer + queue + transactions). It opens from the **patient-chart context** (drawer), not from the Charge Services rail button. Treat it as its own entry point; document its flow in `clinical-charge-tool.md` when built out.

## 6. ⚠️ Browser-automation script-format gotcha (verified this session)

`playwright_evaluate`'s `script` is run as a **page script**. Keep these rules to avoid silent tool-call failures in this environment:

- **Avoid `||`, arrow `=>`, and ternary `? :` inside the script string** — they break the MCP tool-call argument parsing (the call returns "missing required argument arguments" and never runs). Use `function(){}` (not `() => {}`), `===` / `!==` / `&&`, `if/else`, and `*` for arithmetic instead.
- `<` / `>` are fine (used in `for` loops). IIFE bodies ending in `return <expr>` work.
- Prefer `playwright_click` / `playwright_fill` for normal elements; reach for `playwright_evaluate` only when the target has no accessible ref (ExtJS cells, plain `div`s, MUI wrapper `div`s whose inner `input` must be set via React's native value setter).

## 7. Verification checklist

- Login: `document.title` starts with `USER, ` (e.g. `DRR, Darwin R …`).
- Charge Services entered: body contains `Account Lookup`.
- Patient opened: a patient-name tab appears and its `BNR Overview` subtab renders a BNR table (or `None`).
- BNR opened: a `BNR <type><id>` tab with subtabs `Account Summary | Charges | Coding | Registration | Billing`; the `Charges` subtab shows the `Add Charges / View Charges` tabs.

> Patient → BNR → Charges navigation details: see [charge-patient.md](charge-patient.md). Charge entry/submit/verify: see [charge-edit.md](charge-edit.md).
