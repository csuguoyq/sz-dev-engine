# Coding — Manual Coding Entry (Diagnosis / Procedure / DRG)

> Companion to `skills/ehr-workflow/charge/SKILL.md`. Read this file when your task is **entering or editing coding** (diagnosis / procedure / DRG) on the BNR tab's **Coding** subtab.
> Prerequisite: reach the BNR tab first — see [charge-patient.md](charge-patient.md) (login → Charge Services → Account Lookup → patient tab → BNR Overview → `Open` link → BNR tab → `Coding` subtab).
> Verified live on SDMC `fbch34`, 2026-09-13/14 (Playwright MCP).

## 1. Where this screen is (code map)

- `ehr/src/Charge/ChargeServices/ChargePatient/CodingView.tsx` — the Coding subtab: **Begin/Resume/Recoding session dialog**, the coding tabs, header actions (Add/Remove/Add Note/Hold/Complete), Coding History + Notes tables.
- `ehr/src/Charge/ChargeServices/ChargePatient/coding-view/manual/useManualMode.tsx` — manual-mode **Add `<type>` button + drawer** (`SimpleDrawer`), per-tab dynamic forms, save (`useSaveManualCodingMutation`), remove.
- `coding-view/manual/forms/blocks/*FormBlock.tsx` — `DiagnosisFormBlock`, `ProcedureFormBlock`, `DRGDynamicFormBlock` (shared DynamicForm from `@cci-monorepo/common`; field config `FORM_CONFIG`, declarative validation in `coding-view/manual/forms/validation_rules/*.json`).
- `coding-view/manual/forms/custom_inputs/*SearchInputComponent.tsx` — server-searched comboboxes (ICD-10 CM for diagnosis, ICD-10-PCS/CPT for procedure, DRG lookup).
- Constants: `ehr/src/Charge/ChargeServices/constants/coding.ts` — `CODING_MODE` (`3M` AI coder | `manual`), `CODING_VIEWS` (inpatient/outpatient), `CODING_TABS` (`DRG | Diagnosis | Procedure | ADT | History | Notes`), `CODING_STATUS` (`Complete | On Hold | In Progress | Errored`).
- ICD-10 search API: `charge/getProblemList` (`ChargeServices/util/ChargeServicesData.ts` `getProblemList` → POST `baseUrl + "/index.php/charge/getProblemList"`, body `{matchStr (dots stripped), start, pageSize}` → `icd10.chcs: [[description, code], …]` + `numMatches.numMatches`).

## 2. Start the coding session (Begin dialog)

Entering the Coding subtab for a BNR shows the session dialog (`data-testid="begin-coding-session-dialog"`) with a title by prior state: **`Begin Coding`** / **`Resume Coding`** / **`Begin Recoding`** (recoding = a prior completed session exists for this BNR). Click **Begin** — `data-testid="begin-coding-session-dialog-begin-button"` (Cancel = `…-cancel-button`). After Begin, `Coding_Status = In Progress` and the screen shows:

- Coding tabs: **`DRG | Diagnosis | Procedure | ADT | Coding History | Coding Notes`** — starting tab is **DRG** for inpatient BNRs, **Diagnosis** for outpatient.
- Header actions: **`Add <Tab>`** (only on Diagnosis/DRG/Procedure tabs; enabled while status ∈ {In Progress, Errored}), **`Remove`**, **`Add Note`**, **`Hold`** (`data-testid="coding-hold-button"`), **`Complete`** (`data-testid="coding-complete-button"` — runs `codingRules.isValid()` first; on failure it opens the `CodingErrorDialog` and does not complete).

## 3. Add a Diagnosis (verified flow)

1. Select the **Diagnosis** tab; click **`Add Diagnosis`**. A **docked drawer** (`MuiDrawer-docked`, title `Add Diagnosis`) opens with the diagnosis DynamicForm:
   - **`ICD 10-CM Code`** (required; searchable combobox, placeholder `Search ICD 10 - CM Code`)
   - **`POA Indicator`** (choice list), **`HAC`** / **`CC`** / **`MCC`** (yes/no) — inpatient-only fields
   - **`Code Date`** (date), **`ICD 10-CM Code Description`** (disabled, auto-filled from the selected code), **`Type of Diagnosis`** (disabled, auto-assigned), **`Code Set Source`** (disabled, `I10`)
   - Only `ICD10_CM_Code` is required (see `validation_rules/diagnosis.json`: `NOT_EQUAL ""`).
2. **Search mechanics (⚠️ automation gotchas, verified):**
   - The combobox is `SearchableDropdownMenu` → `DropdownMenu` (MUI Autocomplete wrapper, `common/mui-components/.../dropdowns/`). The **listbox opens only on the `Enter` key** (custom `onKeyDown` toggles `open`; there is no `openOnFocus`), and the server search (`useGetDiagnosisChoicelistsQuery` → `charge/getProblemList`, enabled when the input length > 2, debounced) fires per keystroke.
   - **Real keystrokes are required**: setting the input value via React's native value setter + `input` event does NOT reliably drive the Autocomplete state (the listbox never opened that way). Use `playwright_click` to focus, then `playwright_press_key` per character.
   - **Unique-match auto-select**: when the debounced query returns **exactly 1 match**, the field auto-selects it — the input shows `CODE - Description` and the Description field fills automatically. This is the most reliable entry path: type a code specific enough to be unique (e.g. `z136` → `Z13.6`). For multiple matches, press Enter to open the listbox and click the option.
   - **Demo data caveat (`fbch34`)**: the ICD-10 choice list is a **limited subset** — `Z13` returned 25 matches (Z13.0…Z13.8xx + a few T-codes), while `K35.8` / `J18` / `E11` / `C34` returned **0**. Probe with the API before asserting a code exists:
     ```
     fetch('/webframe/index.php/charge/getProblemList', {method:'POST', credentials:'include',
       headers:{'Content-Type':'application/json'},
       body: JSON.stringify({matchStr:'Z136', start:0, pageSize:100})})
     // → {numMatches:{numMatches:"1"}, icd10:{chcs:[["Encounter for screening for cardiovascular disorders","Z13.6"]]}}
     ```
3. **Save** — the drawer's **`Save <type>`** button (e.g. `Save Diagnosis`) is enabled when the form is dirty **and** valid. On save: the drawer closes and a new row appears in the Diagnosis table (`Edit | ICD 10-CM Code | ICD 10-CM Code Description | POA Indicator | HAC | CC | MCC | Code Date | Type of Diagnosis | Code Set Source`).
   - `Type of Diagnosis` is **auto-assigned by position**: first codes get `Admit` / `Principal`, the next get `Secondary` (the drawer title reads e.g. `Secondary Diagnosis 1`).
     - **First-time drawer variant** (empty Diagnosis table, verified 2026-09-13, see [charge-patient.md](charge-patient.md) §5.1): the drawer shows **two blocks — `Admit Diagnosis` and `Principal Diagnosis`** — and `Save Diagnosis` enables only when both hold a valid code. When codes already exist, the drawer is the single-block next-position variant (`Secondary Diagnosis N`, one code required) — the variant verified in this run.

## 4. Verify

- **Diagnosis table** (ChargeReadOnlyTable — plain table rows, NOT a MUI DataGrid, so query `tr` text rather than `.MuiDataGrid-row`): the new row shows your code + description + type + `I10`.
- **Coding History** tab: session log columns `Coding Status | Date Coded | Coding User | Grouper Type | Reason` — your session appears as a new `In Progress` row (grouper e.g. `Medicare` on fbch34). History records **session** events, not per-code adds.
- Screenshot the Diagnosis tab with the new row for evidence.

## 5. DRG (browser-verified) / Procedure (outline)

- **DRG** — verified end-to-end on `fbch34` 2026-09-13 (see [charge-patient.md](charge-patient.md) §5.2 for the field-level detail): **Add DRG** → docked drawer; `DRG` field searches by code or description (`470` → `MAJOR HIP AND KNEE JOINT REPLACEMENT…`, auto-populates `DRG Description/Type/MDC/Weight/ALOS/GLOS` as read-only); **`Severity Illness` + `Risk Mortality` are required** (`1 - Minor`…`4 - Extreme`); `Save DRG` enabled when all three are set. The DRG table row on the verified BNR: `470 | MAJOR HIP AND KNEE JOINT REPLACEMENT OR REATTACHMENT OF LOWER EXTREMITY WITHOUT MCC | SURG | MDC 08 | …`.
- **Procedure** (outline, not yet browser-verified): **Add Procedure** works the same way (docked drawer + dynamic form + `Save Procedure`); fields include `Procedure_Code`, `Procedure_Date_Time`, `Modifiers`, `Quantity`, `Revenue_Code`, `Physician` (`NEW_PROCEDURE_DATA` in `constants/coding.ts`). Verify the search-input specifics (endpoint, auto-select) on first use before asserting.
- **AI Coder** mode (`CODING_MODE.CODER_3M`): the `ai_coder/` panel (Diagnosis/DRG/Procedure tables with a wand icon) — a separate docked drawer; use when the environment's coding mode is 3M. Not browser-verified.

## 6. Notes

- The coding screen keeps a docked **AI Coder** panel and the manual drawer side-by-side — when selecting drawer elements, scope queries to the drawer whose text contains the form title (there can be two `MuiDrawer-docked` elements at once).
- `Complete` runs the full coding rules validation (per-code-type rules in `validation_rules/*.json` + server rules via `useCodingRules`) — with an empty DRG assignment it may refuse to complete; adding a diagnosis alone is a valid partial coding state (status stays `In Progress`).
