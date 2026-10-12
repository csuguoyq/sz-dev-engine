# Selecting a Random Patient in Patient Control & Opening the Chart

> Companion to `skills/ehr-ui/patient-control/SKILL.md`. Read this file when your task needs a **patient chart open from the Patient Control landing** — in particular when you must **pick a random patient** (e.g. from an OR/unit census) and open their record before launching a module screen (Flowsheets, MAR, I&O, …).
> Environment/entry rules: `skills/ehr-ui/browser-testing/SKILL.md`. App-bar navigation: `skills/ehr-ui/navigation/SKILL.md`. Once the chart is open, launch the target module per its own skill (e.g. `skills/ehr-workflow/flowsheet/SKILL.md` §4 → click the **Flowsheets** button).

## What the screen is (verified 2026-09-09, fbch19 SDMC demo)

- After logon, `/webframe/index.php/Cps` is the **Patient Control** landing. Left side: **Patient Lists**, **Recent Patients**, and a **Unit List** tree — each unit row is `tr.x-grid-row` whose visible text is `UNIT(COUNT)`, e.g. `OR(166)`, `ICU(10)`, `4SOUTH(18)`, `ED(17)`.
- Clicking a unit loads a **patient census grid** in the same view: rows are `tr.x-grid-row`, columns `BED | Name | PendingOrd | Code Status | EDIPN | ADMIT DATE | PHYSICIAN | …`; paged ~40 rows/page (`Page <n> of <N>`, footer `Displaying items x - y of Z`).
- **Double-clicking a census row opens the patient chart**: URL gains `gotoscreen=default&gototab=Patient+Overview` (patient header shows name / unit / DOB / account & MRN).

## Procedure

1. **Log on** (browser-testing skill): `https://<HOST>/webframe/index.php/logon?ctrl=cps`, `demo`/`123`, confirm page title becomes `USER, DEMO CliniComp|EHR - …` (logged in).
2. **Pick a unit** (only if not given):
   - If the task names a unit (e.g. "patient in OR unit"), match its row text `OR(166)` and click it.
   - If you may pick freely, choose a **real, active patient unit** (e.g. OR/ICU/…), not a discharge/holding bucket like `DISCH`/`NOBED`; simplest is a random pick among unit rows whose count ≥ 1.
3. **Click the unit row** — works via `tr.x-grid-row` text match:
   ```js
   document.querySelectorAll('tr.x-grid-row')  // find row whose text startsWith 'OR(' → el.click()
   ```
   Wait for the census grid to load (rows appear in the right grid).
4. **Pick a random patient from the census.** ⚠️ The grid is **paged (~40/page)** — a pick limited to the currently displayed page is only random within that page. For a whole-unit random pick, first jump to a random page, then pick a random row on it (paging: `Page` spinbutton / Next-page arrow). A page-1-only pick is acceptable when the unit fits one page or the task does not demand whole-unit randomness.
   ```js
   // after the target page is loaded: collect census rows (bed cell non-empty + patient name present)
   var rows=document.querySelectorAll('tr.x-grid-row');var cands=[];
   rows.forEach(function(r){var t=(r.innerText||'').replace(/\s+/g,' ').trim();if(/^[A-Z0-9-]+ .+/.test(t)&&!r.innerText.includes('No data to display')){cands.push(t)}});
   // pick = cands[Math.floor(Math.random()*cands.length)]  → keep its full row text as the chosen identity
   ```
   Filter to rows whose bed cell is populated (empty `OR-HD` rows and header rows are not patients).
5. **Open the chart with a REAL double-click** (⚠️ a synthetic `dispatchEvent(new MouseEvent('dblclick'))` does **not** fire Ext JS grid handling — verified). Use a Playwright double-click on the row:
   ```js
   page.getByRole('row', { name: '<full row accessible name>' }).dblclick()
   // or: page.locator('tr.x-grid-row:has-text("<unique patient id/name>")').dblclick()
   ```
   The accessible row name = all visible cell texts concatenated (e.g. `OR-2 35462_dll3, 35462_dll3 09/08/2026`) — the patient name portion is unique enough to target by `:has-text`.
6. **Verify the chart opened**: URL contains `gotoscreen=default` and `gototab=Patient+Overview`; the patient header shows the expected name (e.g. `19403, mhf dr`). Record which patient was chosen (unit/bed/name) for reporting.
7. **Proceed to the module** you need (e.g. click **Flowsheets** in the patient's app bar per the flowsheet skill).

## Quirks & pitfalls (verified)

- **Synthetic events fail on these grids** — always use real Playwright clicks; double-clicks via `getByRole('row', …).dblclick()` or CSS-locator dblclick work.
- **Accessibility snapshots are huge** (a 40-row census or a 167-patient unit floods the snapshot and may be truncated) — prefer targeted `browser_evaluate` queries for row discovery and reserve snapshots for verification.
- **Row text matching**: census row `innerText` concatenates all columns; for unit rows the text is exactly `OR(166)`; match carefully so `OR-HD …` patients (holding) aren't confused with the `OR(166)` unit row.
- **Same-patient repeatability**: the census order/content can change between sessions (new admits/transfers); for a *specific* patient prefer searching by MRN/name (registration skill) instead of a census position.
- Column header text `PendingOrd`, `Code Status` etc. belong to the grid header row, not patients — exclude rows with empty name cell.
- **No real double-click available in the harness** (e.g. an MCP whose `click` tool has no `doubleClick` option, verified 2026-09-10 on `fbch34`): a synthetic `dispatchEvent` dblclick — even with `detail:2`, `bubbles:true` and real coordinates — still does not open the chart. Working fallback, all via page JS:
  1. Get the patient's record: Patient Control's own search box (`input[placeholder='Search Patient, Physician, etc']` + Enter) lands the single result in the `patient-selection-grid` (`Ext.ComponentQuery.query('patient-selection-grid')`, record via `getSelectionModel().select([rec], true, true)`; the record's `data.dbpath` is the per-patient key).
  2. Get the controller: `Cci.RunTime.getController('Cps.controller.home.PatientInfoController')`.
  3. Open the chart exactly as the grid's `itemdblclick` handler does for an inpatient (`rec.data.type === "active"`): `Cci.util.RunTime.showCpsMainLoadMask(); ctrl._onLaunchScreen(rec);` → URL becomes `.../index.php/cps?dbpath=<dbpath>&gotoscreen=default&gototab=PatientOverview`.
    4. ⚠️ **`_onLaunchScreen` can fail with the ExtJS "No encounters found." error** (verified 2026-09-14 on `fbch34`): the patient context never gets established (`Cci.Patient.getPatInfo()` stays `Id:-1`, `dbpathInfo.last` visitkey/admitkey stay 0, `mvisitEncInfo` has no dbpath) and the chart never loads — dismissing the error and retrying does not help. **Working fallback, direct URL navigation**: `https://<HOST>/webframe/index.php/cps?dbpath=<dbpath>&gotoscreen=default&gototab=PatientOverview` (the record's `data.dbpath`, slashes unencoded are fine). A full page load lets the server establish the patient context; the chart opens with the patient loaded (header name/MRN, encounter info, no error). Using the direct URL **as the first attempt** (skipping the `_onLaunchScreen` try) is fine — done so on 2026-09-17 and it opened the chart cleanly on the first load. Also note the census record fields are **capitalized** (`Name`, `Bed`, `Unit`, `type`, `dbpath`, `MRN`, `AdmitDate`) — match records on `rec.data.Name`, not `rec.data.name`.
  (The real double-click binding lives on the grid **view**'s `itemdblclick` Ext event — `gridview[itemId=patSelectionViewConfig]` — wrapped in an Ext dispatch closure, so it cannot be re-fired directly; calling `_onLaunchScreen` reproduces the verified end state.)
