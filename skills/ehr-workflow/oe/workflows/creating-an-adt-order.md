# Creating an ADT Order (Admission / Update / Discharge / Transfer)

> Companion to `skills/ehr-workflow/oe/SKILL.md`. Read this file when creating, editing or validating an **ADT order** — Admission, ADT Update, Discharge, or Transfer.
> Source: **code-derived, not an EHR Online Help topic** — `ehr/src/OE/entry/components/forms/ADTForm/FormConfig.ts`, `ADTForm/hooks/useFieldProps.ts`, and `cpoeMasks` in `ehr/src/OE/entry/Constants.ts`.
> ✅ **Verified end-to-end in the live environment** (SDMC `fbch34`, 2026-09-10, user `demo`, patient `24241b, 24241b 24241b`): a **DISCHARGE** order was created, submitted and now shows as **Active** in EXISTING ORDERS (ADT group).
> Field sets below come from code and were confirmed in the browser; see [Verified browser run](#verified-browser-run) for the exact sequence, selectors and gotchas.

An **ADT** order is rendered by `ADTForm` (`ehr/src/OE/entry/components/forms/ADTForm/index.tsx`), which delegates to `BaseForm`. Which form you get is decided by the order's **cpoeMask** (values originate from the choicelist **`CPOE_Mask`**; see `cpoeMasks` in `ehr/src/OE/entry/Constants.ts`). All four ADT masks share `type: formTypes.ADT`:

| cpoeMask | Meaning |
|---|---|
| `ADMISSION` | Admit the patient |
| `ADTUPDATE` | Update existing ADT data |
| `DISCHARGE` | Discharge the patient |
| `TRANSFER` | Transfer (level-of-care change) |

> **How the mask is selected:** pick the **ADT** category in the Category dialog, then choose the specific ADT order in the **Name** field — the chosen order carries its own `cpoeMask`, which is what renders the corresponding form.

## Entering a DISCHARGE order

### Required fields

| API field | UI label | Component |
|---|---|---|
| `provider` | Provider | `ProviderField` |
| `disch_date` | **Discharge Date** | `DischargeDateField` (`CciDatePicker`, `futureDate`) |
| `disch_disposition` | **Discharge Disposition** | `DischargeDispositionField` (`ComboSelectionField`) |

### Displayed but optional

`DischargeDiagnosisField` (`disch_diagnosis`), `SecondaryDischargeDiagnosisField` (`second_disch_diag`), `IntendedDischargeTimeField` (`disch_time`), `CommentsField`, `ConditionalField`, `OrderQuestionsSection`, plus right-panel `WebLinksField` / `OrderingInstrField` / `OrderConfigSection`.

### Steps (verified 2026-09-10)

1. With a patient selected, click **ORDER ENTRY** in the left icon rail (`.home-non-navbtn-panel a`, match the child `<span>` text). The URL becomes `?gotoscreen=cpoe_psat&gototab=CPOE`.
2. In the **NEW ORDERS** panel click **Browse** → the **BROWSE ORDERS** dialog opens with a Categories tree on the left.
3. Expand **ADT** and click the **Discharge** category node. The right-hand list filters to the Discharge orders.
4. Tick the **checkbox** of the Discharge order (e.g. `Discharge patient`) — the Add button counter increments to `Add (1)`.
5. Fill the pre-Add **required** fields in the panel below the list: **Starting at** (pre-filled with now), **Order Mode** (pre-filled `Default`), and **Authorizing Provider** (**required**, empty by default).
6. Click **Add (1)**. The Browse dialog closes and the order lands in **NEW ORDERS**.
7. Click the order row to expand the **Order Details** editor and fill the remaining required fields (**Discharge Disposition**, plus **Override Reason** when a Drug-Allergy warning banner is shown).
8. Click **Done** — the order stays in NEW ORDERS with `Remove Order` / `Submit`.
9. Click **Submit** (`[data-testid="cpoe-submit-btn"]`). If a **Medication Warnings** dialog appears (**drug orders only** — a plain ADT order goes straight to the Validation Dialog), pick an Override Reason chip → **OK**, then Submit again.
10. The **Validation Dialog** ("Are you sure you wish to Save order(s)?") appears. ⚠️ It carries **Username** (pre-filled, e.g. `DEMO`) / **Password** (empty) fields: **OK with the password empty is a silent no-op** — enter the password (e.g. `123`) first, then click **OK**. A **MUI "Save Order"** dialog ("Order(s) has been printed to COMPROOM with status=1") follows → **OK**. The order is then saved and appears under **EXISTING ORDERS**.

### Notes & gotchas

- **Discharge Date is a `CciDatePicker`** configured with `futureDate={true}` and `allowEmpty={true}`, and it is accompanied by quick-pick **SelectionButtons** driven by `payload.dischDateSuggestions` — prefer the suggestions or the picker over typing raw text.
- **`disch_date` is persisted as a unix timestamp** (`moment(...).unix()`); display formatting comes from `payload.dischDateFormat`.
- **Discharge Disposition is a combobox** whose options come from `cpoeChoices.discharge_disposition` — the value must be picked from the list, not free-typed.
- **Order Questions is displayed for `DISCHARGE` but is NOT required.** This differs from `ADMISSION`/`ADTUPDATE`, where `order_questions` **is** in `requiredList` (Medicare 2-midnight questions — a common save blocker there, not here).
- **Diagnosis fields are server-matched as you type** (`options: []` in `useFieldProps`, filled by the server on keystroke) — type to search; do not expect a static option list.
- **Cross-order**: when `isCrossOrder(cat, subcat)` is true, `order_timing`, `expected_date` and `expires` are additionally required (fields `OrderTimingField`, `ExpectedDateField`, `ExpiresField`).

## Other ADT masks (quick reference)

| cpoeMask | Required API fields | Extra vs. others |
|---|---|---|
| `ADMISSION` | `provider`, `attd_provider`, `admt_service`, `primary_adm_diag`, `level_of_care`, `patient_class`, `order_questions` | add `second_adm_diag` when `SecndAdmisnDiagMandatory === 1`; `order_questions` required |
| `ADTUPDATE` | same as `ADMISSION` **+ `new_patient_class`** | `order_questions` required |
| `TRANSFER` | `provider`, `level_of_care`, `new_level_of_care` | no diagnosis/patient-class fields |

All masks share `formLowerLeftFields: ["CommentsField"]`, `formBottomLeftFields: ["ConditionalField"]`, and right panel `["WebLinksField", "OrderingInstrField", "OrderConfigSection"]`.

## Browser-automation notes

- All browser steps run **through the Playwright MCP directly** (AGENTS.md rule) — never delegate to a browser sub-agent.
- **`DischargeDateField` and `DischargeDispositionField` do not set an explicit `data-testid`.** Locate them by their **label text** (`Discharge Date:`, `Discharge Disposition`). The module's testid convention is `cpoe2-entry-<component>-<element>` (see `ehr/src/OE/docs/patterns/naming-conventions.md`), so prefer a label-anchored lookup and fall back to a `cpoe2-entry-*` id only when one is actually present in the DOM.
- The **Category** dialog is the **BROWSE ORDERS** modal opened by the **Browse** link — not a separate "New Order" icon.
- After **Submit**, verify the new order appears under **EXISTING ORDERS** (the ADT group count increments).

## Verified browser run

Recorded 2026-09-10 on SDMC `fbch34` (`$HOSTNAME`, `10.2.2.34`), user `demo` (displays as **DRR, Darwin R**), patient `24241b, 24241b 24241b` (unit OR).
(`.../webframe/index.php/cps?gotoscreen=cpoe_psat&gototab=CPOE` — the `dbpath` is per-patient; select the patient in Patient Control first, then open Order Entry. Log in explicitly with `demo`/`123` via the **Username/Password Login** link, not the auto-loaded session.)

### Verified selectors

| Target | How to locate |
|---|---|
| Order Entry app | `.home-non-navbtn-panel a` whose child `<span>` text is `ORDER ENTRY` (⚠️ **two** such buttons exist; both reach CPOE) |
| Browse Orders | click the `Browse` link in the **NEW ORDERS** panel |
| ADT → Discharge category | the `<div>` whose text is exactly `Discharge` inside the categories tree |
| `Discharge patient` checkbox | `#checkbox-ADTDC301` |
| Add button | element whose text starts with `Add (` (counter shows selected count) |
| Submit button | **`[data-testid="cpoe-submit-btn"]`** |
| Authorizing Provider | pre-Add panel combobox labeled `Authorizing Provider:*` (type-to-filter; `ttest ttest`, `Jessie test`, … valid on `fbch34`) |
| Validation Dialog password | `input[type=password]` inside the ExtJS `.x-window` (empty by default — must be filled before OK) |
| Validation Dialog | ExtJS `.x-window` titled `Validation Dialog`, body `Are you sure you wish to Save order(s)?` |

### Verified field values

- **Discharge Date** — pre-filled with today (`09/10/2026`), with `Today` / `Tomorrow` quick buttons.
- **Discharge Disposition** — combobox, 12 options: `Alternative home`, `Discharged to rehab services`, `Expired/Deceased`, `Home or self-care`, `Home with assistance from home health care agency`, `Left against medical advice (AMA)`, `Other`, `Transferred to a skilled nursing facility (SNF)`, `Transferred to another hospital`, `Transferred to hospice care`, `Transferred to long-term care`, `Transferred to psychiatric facility`.
- **Override Reason** (only when the Drug-Allergy banner `Manual Review Required` is shown) — 6 options: `Benefits Outweigh Risk`, `Dose Requires Adjustment`, `Inaccurate Warning`, `Patient Previously Tolerated`, `See Comments`, `Will Monitor and Take Precautions`.
- **Order Questions** (`Reason for Early Discharge`) — rendered but **not required**; the order saved without it, confirming the `DISCHARGE` mask does not put `order_questions` in `requiredList`.

### Gotchas hit during the run

- ⚠️ **MUI autocompletes (Authorizing Provider, Discharge Disposition, Override Reason) only open on a real mouse focus/click.** `playwright_fill` alone sets the DOM value but does **not** open the list; typed text is then rejected as invalid. Click the input first, then pick from `[role=option]`.
- ⚠️ **A sticky `x-mask` (`div.x-mask[data-sticky]`) overlays the page** and makes `playwright_click` on Submit time out with "intercepts pointer events". Dispatch the click from JS instead: `document.querySelector('[data-testid="cpoe-submit-btn"]').click()`.
- ⚠️ **Submit must be confirmed twice**: first the **Medication Warnings** dialog (choose an Override Reason chip → `OK`), then the **Validation Dialog** → `OK`. Clicking only the first leaves the order sitting in NEW ORDERS.
- ⚠️ The **Validation Dialog** is an ExtJS window, not an MUI `.MuiDialog-root` — a MUI-only popup scan misses it.
- ⚠️ `playwright_evaluate` takes a **plain expression**, not an arrow-function body: use an IIFE `(function(){ … return x; })()`; a bare top-level `return` throws `Illegal return statement`. Inside the script, build newlines with `String.fromCharCode(10)` (a literal `\n` breaks argument parsing).
- ⚠️ Patients belonging to an **undefined remote campus** (seen: `dod`) make the module fail with `Remote campus dod … not defined in master_campus_list.cf` + HTTP 500 — pick a local-campus patient before starting.
- Console noise to expect (not blockers here): `Invalid birthday: 1/15/2000`, `Can not get patient's registration info.`
- ⚠️ **Log in with `demo`/`123` *explicitly*.** Navigating straight to `Cps` can auto-load a *limited* session that shows "patient database is locked / no UNLOCK permission" and renders Patient Control empty (no patient lists → OE cannot start). On the logon page click **Username/Password Login** and enter `demo` / `123`; Patient Control then loads fully. (The `demo` account displays as **DRR, Darwin R**.)
- ⚠️ **The Order Details editor opens from the new-order card's warning (⚠️) icon** (or by clicking the card body) — it does *not* open automatically after Add. The required **Discharge Disposition** is a type-to-filter autocomplete: click it, type a substring (e.g. `Home`), then pick from `[role=option]` (`Home or self-care`, …). Free-typed values are rejected.
- **Authorizing Provider** is also a type-to-filter autocomplete; the pre-Add field shows a magnifier and is empty/required until you pick one (`testmd`, `ttest ttest`, `Jessie test`, … are valid on `fbch34`).
- ⚠️ **Validation Dialog requires the password re-entered** (observed 2026-09-10, `fbch34`): Username is pre-filled but Password is empty; clicking OK with it empty does **nothing** (dialog stays open, no save, no visible error — verified twice, JS and real clicks). Set the `input[type=password]` value (e.g. `123`) via `input`+`change` events, then OK.
- **No Med Warnings for plain ADT**: a DISCHARGE with no drug orders goes straight Submit → Validation Dialog (no override chips needed).
- **Checkbox id drift**: `#checkbox-ADTDC301` was **absent** in the 2026-09-10 evening run (plain MUI checkboxes with generic ids). Robust: find the BROWSE-ORDERS row whose text starts with `Discharge patient`, click its `.MuiCheckbox-root`; confirm via the `Add (1)` counter.
- **Pre-Add comboboxes**: the required one is the combobox labeled `Authorizing Provider:*` (empty until picked); the neighbor with placeholder `No Cosigner Required` is **Send for Cosign** (optional) — don't fill the wrong one.
- ⚠️ **The category-tree selection needs a REAL (trusted) click** (re-verified 2026-09-17, `fbch34`): synthetic `el.click()` on `.MuiTreeItem-content` / `.MuiTreeItem-label` — even a full `pointerdown/mousedown/pointerup/mouseup/click` sequence — does **not** select the category (no `Mui-selected` state on the tree, order list stays unfiltered). Tag the label with a `data-*` attribute and use a real `playwright_click`; the list then filters and the chosen category is echoed in the list header (e.g. `Medications | Non-Meds | Discharge`).
- ⚠️ **Authorizing Provider may be pre-filled** (observed 2026-09-17): the field arrived carrying `ttest ttest`, and typing appended to it (`ttest ttesttttest` → zero matches). Read the input's current value first; if pre-filled with a valid provider you can keep it, otherwise clear it (native value setter + `input` event) before typing.

### Result

EXISTING ORDERS → ADT group went **0 → 1** for this patient (patient `24241b` had no ADT orders before), new row `Discharge patient / Active / 0234 10 Sep / Discharge Disposition: Home or self-care`; NEW ORDERS returned to its empty placeholder.

> **Why this order matters (cross-link):** the **Active DISCHARGE order is what Registration's Encounter Discharge action consumes.** Registration's discharge UI is order-gated (`adtOrderRequired && isDischarge && !editing` → `missingOrder` disables Save); when the order is Active it shows **"Order in Place"** and auto-fills **Discharge Date/Time** + **Disposition** from the order. So the discharge workflow is two-step: (1) place the DISCHARGE order here in OE → (2) complete it via **Encounters → open encounter → Discharge → Discharge Patient** in Registration (see `ehr-workflow/registration/workflows/encounters.md`, "Discharge an inpatient encounter"). The order's `disch_disposition` value is the one that flows into the encounter Disposition.
