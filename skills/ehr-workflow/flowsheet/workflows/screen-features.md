# Flowsheet Screen Features (common layout)

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves the **shared structure/features of any flowsheet screen** (toolbar, rows/columns & cell selection, sections, Summary Grid, Plot, tab overflow) or when orienting yourself before charting/reading data.
> Source: EHR Online Help `Flowsheet_Screen_Features/Flowsheet_Screen_Features.htm`.

Flowsheet content varies, but all flowsheets share these common elements and features:

## Toolbar & right-click menu

- The **flowsheet toolbar** includes **icons** that vary by flowsheet for working with the flowsheet — see [icons.md](icons.md).
- **Right-click in a field** displays a menu with available functions; some of these also exist as toolbar icons.

## Data cells, rows, and columns

- Patient data is charted in **data cells** arranged in **rows** and **time & date columns**.
- When you **select a data cell**, the selected **row and column are highlighted in yellow**, and the **intersecting cell is highlighted in gold**.
- Depending on configuration, the **first column may be labeled `ADMIT`**, with a green background and white text listing the admit date and time.
- Rows are grouped into **sections**. In some cases, sections are added when orders are acknowledged or entered by nurses (see [navigating.md](navigating.md)).
- Rows labeled as a **Weight** row display the patient's **latest weight**.

## Summary Grid

Some flowsheets have a **Summary Grid** that shows summarized data from rows and columns:

- You may need to select the **Expand** icon following the **last visible flowsheet column** to view the Summary Grid.
- Depending on configuration, the grid may contain **current and previous day** information, indicate **shifts**, and the **start of day** specific to your site.
- There may be **multiple tab views** in the grid (e.g. two Summary tabs); each section of a flowsheet can be configured differently.
- Some Summary Grids include **calculated sections** showing current and previous day information in ranges or measures such as **latest, highest, lowest, all, and totals** for data charted in the flowsheet.
- Tab views:
  - **Summary** tab — summarized data by date.
  - **Labels** tab — the data name and the units used.
  - **OBS** tab (depending on the flowsheet) — observation entries (see [observations-narratives.md](observations-narratives.md)).

## Plotting values

- Certain flowsheet values can be **plotted** as line graphs showing data trends.
- **Select a gray row header** on the left (e.g. `HR`) → the **last 24 hours of results** display in a **Plot dialog**.
- Use the Plot dialog's **Forward** / **Back** icons to move forward/back through the data.
- Selecting **additional row headers** adds additional data to the same Plot dialog.

## Flow sheet tabs (overflow)

- If there are too many **flowsheets tabs** to fit the screen, select the **Scroll Forward** icon following the last flowsheet tab to scroll to and select a flowsheet; select the **Scroll Back** icon before the first tab to scroll back.
