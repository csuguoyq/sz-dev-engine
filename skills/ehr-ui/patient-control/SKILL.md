---
name: "patient-control"
description: "Patient Control (the Cps landing screen): pick a patient — from a unit census (including selecting a RANDOM patient) or patient lists — and open the patient chart. Invoke whenever a browser task must open a patient's chart from Patient Control before launching a module screen (Flowsheets, MAR, I&O, ...), or when asked to 'select a random patient' in a unit."
---

# Patient Control — Opening a Patient Chart

> Router. Patient Control is where patient charts get opened for module work (the patient record is the prerequisite for screens like Flowsheets). Read the matching workflow file for the exact steps; this file gives the module map, entry, and cross-links.
> Environment/URL/logon rules live in `skills/ehr-ui/browser-testing/SKILL.md`; rail/app-button navigation in `skills/ehr-ui/navigation/SKILL.md`. Module screens beyond opening the chart are covered by their own skills (e.g. `skills/ehr-workflow/flowsheet/SKILL.md`).

## 0. Pick your direction first

| What you are doing | Read |
|---|---|
| **Select a random patient** in a unit and open the chart | [workflow/select-random-patient.md](workflow/select-random-patient.md) |
| Open a **known patient** quickly (MRN / name search) | `skills/ehr-workflow/registration/SKILL.md` → patient-search (Registration search) |
| Understand logon / URL / environment | `skills/ehr-ui/browser-testing/SKILL.md` |
| Move between top-level apps (rail) | `skills/ehr-ui/navigation/SKILL.md` |

## 1. What Patient Control is

- `/webframe/index.php/Cps` after logon = the **Patient Control** landing. It provides the **Unit List** census (unit → patient grid) plus My/Recent patient lists and a patient search box.
- A patient **chart** (record) is opened by double-clicking a patient row; the URL then gains `gotoscreen=default&gototab=Patient+Overview` and the chart header shows demographics.
- Once the chart is open, per-module screens are launched from the patient's **app buttons** (e.g. the **Flowsheets** `a.x-btn` in the `home-non-navbtn-panel` — see the flowsheet skill §4).

## 2. Verified screen facts (fbch19 SDMC demo, 2026-09-09)

- Unit List rows: `tr.x-grid-row`, text `UNIT(COUNT)` e.g. `OR(166)`. Census rows: `tr.x-grid-row`, columns `BED | Name | PendingOrd | Code Status | EDIPN | ADMIT DATE | PHYSICIAN | …`, paged ~40 rows/page (`Page <n> of <N>`).
- Rows must be opened with a **real Playwright double-click** (`getByRole('row', {name}).dblclick()` or CSS `:has-text` locator dblclick). Synthetic `dispatchEvent` dblclicks do **not** work on these Ext JS grids.
- Snapshots of a unit census are very large — prefer `browser_evaluate` row discovery over snapshots.

## 3. Rules for agents

- Log on through `Cps` first (`USER, <name>` page title confirms the session) — see browser-testing skill; do not skip it when a fresh session is detected.
- Report which patient was opened (unit/bed/name, e.g. `OR-HD 19403, mhf dr`) whenever a pick was made.
- Reference code/selectors only by stable hooks (class names, role names, URL params) — never by page-snapshot refs or line numbers.
- Keep workflow detail in `workflow/` files; only summarize here.
