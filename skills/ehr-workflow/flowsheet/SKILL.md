---
name: "flowsheet"
description: "Clinical Flowsheets application guide — invoke when a task is about flowsheet clinical workflows (charting/viewing clinical data in spreadsheet-style flowsheets), OR about developing/browser-testing the live Flowsheets app: flowsheet screen features, icons, symbols & navigation; charting data (annotations, observations & narratives, cell types, entry tips, rows & columns, copy/paste, charting at any arbitrary time); monitor / ventilator / medical-device data; treatment flowsheets; I&O split pane and 10-day totals; dual verification; fetal-strip split pane. Content converted from the CliniComp EHR Online Help 'Flowsheets' section."
---

# Flowsheets (Clinical Charting Workflows)

> Load this file first to get the module map. It is a **router**: pick your direction below, then read ONLY the file you need so unrelated detail stays out of context.
> This skill is a conversion of the **Flowsheets** section of the CliniComp EHR Online Help (`/fbch/htdocs/documentation/EHR_Documentation/EHR_Online_Help/Flowsheets/`, content version v213.03.0036, last updated 28 Nov 2023). There is **no matching `ehr/src/Flowsheets` React module yet** — treat these guides as the clinical-workflow spec of the live application (for browser-level testing per `ehr-ui/browser-testing`) and as behavioral reference when flowsheet-like code is written.
> Every feature here is **site-configurable**: flowsheets, icons, sections, and permissions vary by facility/environment — verify against the live environment before asserting behavior.

## 0. Pick your direction first

| What you are doing | Read |
|---|---|
| 🔍 Looking up a specific **workflow** (charting/viewing a kind of data) | the matching row in the workflow index below |
| 🧭 Understanding **screen structure / layout / selection** | [workflows/screen-features.md](workflows/screen-features.md) |
| 🖼️ Naming a **toolbar icon** (toolbar / data-cell / split-pane) | [workflows/icons.md](workflows/icons.md) |
| 🔤 Interpreting **cell symbols & font cues** (triangles, brackets, italics, red text) | [workflows/symbols.md](workflows/symbols.md) |
| 🗺️ **Navigating** by sections / subtabs / time columns | [workflows/navigating.md](workflows/navigating.md) |
| 🧑‍💻 Writing flowsheet-like **code** (no module yet) | see §4 below; nearest analog `ehr/src/AnesFS` (intra-op anesthesia flowsheet) |
| 🧪 **Browser-testing** the live Flowsheets app | `skills/ehr-ui/navigation/SKILL.md` + `skills/ehr-ui/browser-testing/SKILL.md`, then the matching workflow file |

## 1. What the module is (per the source documentation)

`Flowsheets` is the clinical app where patient data is **charted and viewed in a spreadsheet-like format** (rows = data items, columns = time & date). Flowsheets are configured per facility/environment; types include **Vital Signs, Labor & Delivery, Medications (MAR), Intake & Output (I&O), Respiratory, Invasive Device, Assessment, and Treatments**.

- **Data origins**: manually charted in the CliniComp system; populated from notes; pulled from a patient's bedside monitor automatically or on demand (see `monitor-data.md`, `ventilator-data.md`, `medical-devices.md`); sections added when orders/order sets are added and acknowledged/entered by nurses; imported from interfaces such as the lab system.
- **Clinician customization**: rows can be added per patient need (e.g. add a Swan Ganz Catheter row on Vital Signs) and stopped/started as needed.
- **Entry** (per the docs): double-click a patient in the **Patient Pane** to open the patient record → select the **Flowsheets** icon in the **Patient Application Pane** → the Flowsheets application displays all flowsheets chartable for that patient → select a **flowsheet tab**.
- **Screen literacy** (shared by all flowsheets): common layout/features, icons, symbols and navigation are documented in `screen-features.md`, `icons.md`, `symbols.md`, and `navigating.md` — read those first for any flowsheet task.

## 2. Workflow index — READ ONLY WHAT YOU NEED (on-demand)

| If your task is about... | Read |
|---|---|
| Common screen elements (toolbar, cells/rows/columns, Summary Grid, Plot) | [workflows/screen-features.md](workflows/screen-features.md) |
| Toolbar & cell **icons** (reference list) | [workflows/icons.md](workflows/icons.md) |
| **Symbols/font cues** in cells (deleted/changed data, row brackets, italics, unsaved) | [workflows/symbols.md](workflows/symbols.md) |
| Navigating by **sections / subtabs / time** (Prev/Next, Now Column, Enter Time, Admit Time) | [workflows/navigating.md](workflows/navigating.md) |
| Adding / editing an **annotation** on a data cell | [workflows/annotations.md](workflows/annotations.md) |
| **Observations & narratives** (Edit Observations / Narrative dialogs) | [workflows/observations-narratives.md](workflows/observations-narratives.md) |
| **Dual verification** charting (two-person verification / edit / delete) | [workflows/dual-verification.md](workflows/dual-verification.md) |
| **Data cell types** (free-text, calculations, dropdowns, weights, dates/times) | [workflows/data-cell-types.md](workflows/data-cell-types.md) |
| General **entry/save tips** (ENTER, clearing cells, refresh/discard) | [workflows/data-entry-tips.md](workflows/data-entry-tips.md) |
| **Copying & pasting** charted data between time/date columns | [workflows/copy-paste.md](workflows/copy-paste.md) |
| **Monitor data** (Read / Previous Read / Auto Read Monitor) | [workflows/monitor-data.md](workflows/monitor-data.md) |
| **Rows & columns** (add/start/stop row, jump to or add a column) | [workflows/rows-columns.md](workflows/rows-columns.md) |
| **Charting at an arbitrary time** (Enter Time → column for any date/time → chart) | [workflows/charting-any-time.md](workflows/charting-any-time.md) |
| **Viewing** data (annotations, edit history, Describe Item, Vitals Snapshot, comments) | [workflows/viewing-data.md](workflows/viewing-data.md) |
| **I&O 10-day totals** dialog | [workflows/io-10day-totals.md](workflows/io-10day-totals.md) |
| **Medical device** sections & make/model (device-driven flowsheets) | [workflows/medical-devices.md](workflows/medical-devices.md) |
| **Treatment flowsheets** (respiratory med/treatment orders, x1 treatments) | [workflows/treatment-flowsheets.md](workflows/treatment-flowsheets.md) |
| **Ventilator data** (universal ventilator flowsheet) | [workflows/ventilator-data.md](workflows/ventilator-data.md) |
| **Fetal strip** split pane at the bottom of a flowsheet | [workflows/fetal-strip.md](workflows/fetal-strip.md) |
| **I&O split pane** at the bottom of a flowsheet | [workflows/io-split-pane.md](workflows/io-split-pane.md) |

> Rule: read exactly the matching file(s); do not dump all workflow files into context at once.

## 3. Cross-cutting conventions (read before any flowsheet task)

- **Save + validate**: charted data is not stored until the user selects **Save** and confirms (per configuration a **Validation dialog** asks for credentials — see `copy-paste.md` / `monitor-data.md`). Unsaved edits show a dark cell outline and a black dot on the flowsheet tab (`symbols.md`); select **Refresh** or exit without saving to discard them (`data-entry-tips.md`).
- **Icons are config-driven**: not all flowsheets have all icons; icons are **disabled (gray)** where not appropriate; several functions also live in the **right-click menu** of a field/cell (`icons.md`).
- **Split panes are exclusive**: only **one split-pane feature works at a time** — while the I&O split pane is active the Fetal Strip split pane is disabled, and vice versa (`io-split-pane.md`, `fetal-strip.md`). Save also works **separately per open pane**.
- **Read Monitor family**: selecting *any* Read Monitor icon loads data from **all interfaced medical devices** of the open flowsheet and displays it **in italics** (`monitor-data.md`, `medical-devices.md`, `ventilator-data.md`).
- **Permissions**: some features require permission (e.g. Copy Paste, Auto Read Monitor) — contact the system administrator.
- **Only-in-this-skill cross-links**: MAR icons / I&O section / Fetal Strips / pop-up applications from the Patient Application Pane are covered by other (non-converted) EHR Online Help sections; when needed they are referenced by name only.

## 4. Notes for code / browser-testing work

- No `ehr/src/Flowsheets` module exists yet in this repo. The nearest flowsheet-like React code is `ehr/src/AnesFS` (intra-operative anesthesia flowsheet: grid, sections, stacking, device data) — **do not equate it with the generic Flowsheets app** documented here; use it only as implementation inspiration.
- Browser entry to flowsheets per the source docs goes through the **patient record**: open the patient chart first (dedicated skill: `skills/ehr-ui/patient-control/SKILL.md` — Patient Control unit census incl. random patient; alternative: `skills/ehr-workflow/registration` patient search), then select the **Flowsheets** icon in the Patient Application Pane. All browser page testing is done through the Playwright MCP directly, per `skills/ehr-ui/browser-testing/SKILL.md`.
- Reference code (when it exists) only by **file path + stable symbol names**, never line numbers.

### ✅ Live-app implementation notes (verified 2026-09-09 on fbch19 SDMC demo, flowsheet `fs` screen)

These are concrete hooks for browser tests / future code; the Online Help docs describe behavior, not DOM.

- **Opening the patient chart is not flowsheet-specific** — Patient Control entry (Unit List → census → double-click a row, incl. picking a *random* patient) is covered by the dedicated `skills/ehr-ui/patient-control/SKILL.md` (+ its `workflow/` guide). Return to this skill once the flowsheet screen is loaded (`gotoscreen=fs`).
- **Launching Flowsheets (verified):** once the patient chart is open, the patient app icons live in the **same `home-non-navbtn-panel` container** as the top-level rail; the **Flowsheets** button is an `a.x-btn.home-navbtn` whose label span is visible (`textContent==='Flowsheets'`) — click it → URL gains `gotoscreen=fs` and a flowsheet tab (e.g. `gototab=VITALS`) is preselected.
- **Grid tech:** each flowsheet is a **Webix datatable** (`div.fs_webix`, container id `FsWebixContainer_<fs pane>`, id `#treetable…`) inside an Ext panel. Left column = row labels `td.name` (display names, e.g. `Heart rate`) inside `table.labelcell`; time columns are rendered 5-min apart with per-column header `table.nospacing.timeheader` (`td.time` = `23:25`, `td.date` = `8 Sep`).
- **Charting (verified):** single-click a data cell (`div.webix_cell` in the center body) opens a Webix inline editor (`input` in `div.webix_dt_editor`); type the value + **ENTER**; the cell text updates. Then click the toolbar **Save** button (`a.x-btn`, tooltip `Save`) → message box **“Save Changes? … Do you want to save now?”** → **OK**. Toolbar tooltips (`Save`, `Refresh`, …) are on `a.x-btn[data-qtip|title]`. **Refresh** (`tooltip Refresh`) reloads from server; absence of an Unsaved/Discard prompt after refresh confirms the entry was committed.
- Horizontal scrolling: set `scrollLeft` on `.fs_webix .webix_ss_hscroll` (or `.webix_hs_center`) — header and body stay synced; recompute cell geometry from header/row rects after scrolling (columns far right are off-viewport and `elementFromPoint` returns null).
- **Enter Time (verified 2026-09-09):** toolbar `a.x-btn` tooltip `Enter Time` → dialog **“Column Time & Date”** (Ext `div.x-window.fs-entertime`) with one text field pre-filled current time as `HHmm dd MMM yyyy` (e.g. `2351 08 Sep 2026`) + `OK / Cancel`. ⚠️ **Typing into the field corrupts the value** (mask/parse quirk: `1015 09 Sep 2026` became `0020 15 Oct 2026`) — use the **calendar trigger** `div.cci-date-time-field-ic` beside the field instead. It opens `div.x-datepicker.cci-datetime-picker` (date grid + time sliders): month arrows `a.x-datepicker-prev/next`, day cells `td.x-datepicker-active a.x-datepicker-date`, footer **Now / Done** (`a.cci-datetime-picker-btn`). Time area (`#cci-slider-time-picker-*`): visible `Time:` text field (`input.cci-time-pickers-slider-label-text`, not reliably typeable), `Hour:`/`Minute:` rows each with small **step buttons** `a.cci-time-picker-slider-small` (`.cci-time-pickers-slider-left-btn-icon` = −1, `-right-` = +1; Hour and Minute both step by **1**). Select day, set hour/minute, click **Done** — commits the datetime **and closes the whole dialog** (no separate OK needed). Grid then **adds the column and auto-scrolls to it** (may also extend trailing columns); header check: `table.nospacing.timeheader` with `td.time=06:15`, `td.date=9 Sep`; column count on `.webix_ss_header … timeheader` grows (576 → 577 in test). **Save** afterwards persists the column (verified via Refresh). Docs (`navigating.md`/`rows-columns.md`) say the dialog button is “Done” — live it is Done inside the picker, OK/Cancel on the dialog.
- **Annotations (verified):** right-click a data cell (`div.webix_cell` / `td.data`) opens the Ext context menu (`div.x-menu.x-menu-cps-context-menu`) with items `Add Row / Start Row / Stop Row / Read Monitor / Previous Read Monitor / Auto Read Monitor / Annotation / Copy Paste / … / Describe Item` (matches `icons.md` right-click note; a *left* click would open the value editor instead). **Annotation** opens a dialog titled with the item display name + `Time/Date: <col time> <date>` + `Stored By` + buttons `Accept / Reset / Cancel` and a `textarea`; type text → **Accept** → dialog closes. In-cell annotation icon = `<img class="img12x12" src="../web/resources/icons/annotation.svg">` in the cell's second `td` (`td.aligntop.fs-padding`), shown after Accept and persisting through Save + Refresh; **hover** the icon (slow move + ≥2s) shows an Ext tooltip with the annotation text. Save flow identical to charting (toolbar `Save` → “Save Changes?” → OK).

Full source documentation tree this skill converts (keep in sync if re-converting):
`/fbch/htdocs/documentation/EHR_Documentation/EHR_Online_Help/Flowsheets/` → `Flowsheets_Overview.htm` (→ §1 above), `Flowsheet_Screen_Features/{Flowsheet_Screen_Features,Flowsheet_Icons,Flowsheet_Symbols,Navigating_Flowsheets}.htm`, `Working_with_Flowsheets/*.htm` (each remaining file maps to the workflow files above in §2, by title).
