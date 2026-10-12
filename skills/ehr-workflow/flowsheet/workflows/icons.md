# Flowsheet Icons (reference list)

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when you need to **name / identify a flowsheet icon** (toolbar icon, in-cell icon, or split-pane icon) from its label or description — or when a workflow file refers to an icon by name.
> Source: EHR Online Help `Flowsheet_Screen_Features/Flowsheet_Icons.htm`.

- Your system configuration may have **split buttons or separate icons**; the list below shows separate icons.
- **Not all flowsheets have all these icons.** Icons are **disabled (gray)** where not appropriate for use.
- Some features are also available via the **right-click menu** (see [screen-features.md](screen-features.md)).
- Toolbar-specific behavior of several icons is expanded in [navigating.md](navigating.md), [rows-columns.md](rows-columns.md), [monitor-data.md](monitor-data.md), [viewing-data.md](viewing-data.md), [copy-paste.md](copy-paste.md), [annotations.md](annotations.md), [fetal-strip.md](fetal-strip.md), and [io-10day-totals.md](io-10day-totals.md).

## Toolbar icons

| Icon (name as used in this skill set) | Description |
|---|---|
| **Now Column** | Depending on flowsheet configuration: either jump to the **top of the hour column** for the current time (e.g. selecting it in the MAR at 0917 goes to the 0900 column), or **create a column** for the current hour and minutes (e.g. selecting it in the Vital Signs flowsheet at 0917 adds a 0917 column). See [navigating.md](navigating.md) / [rows-columns.md](rows-columns.md). |
| **Enter Time** | Insert a **new time & date column** for a specific time into the flowsheet. |
| **Add Row** | Create a new row / group of rows. See [rows-columns.md](rows-columns.md). |
| **Start Row** | Open a row (denoted by an **open/left bracket**) to allow charting in that row. |
| **Stop Row** | Indicate the **end of charting** for that row (also lets the row drop off the flowsheet and, if configured, moves the cursor to the next row). |
| **Read Monitor** | Import, **on demand**, monitored data from the bedside device into a cell in the selected time column. |
| **Previous Read Monitor** | Open the **Previous Read Monitor dialog** (choose beginning time + frequency) to import monitored data for a specified **period in the past**. |
| **Auto Read Monitor** | **Automatically** import physiologic monitored data from a bedside device into a selected time-column cell. |
| **Annotation** | Enter a **textual comment** in a cell. An in-cell Annotation icon displays once an annotation is added. |
| **Copy Paste** | Copy feature that includes/excludes the **latest values by section or row**, pasting them into the corresponding cell(s). |
| **Calendar** | Open a calendar to **choose the date and the time**. |
| **Vitals Snapshot** | Open the **Vitals Snapshot dialog** with a configured list of vitals; the date range is adjustable. |
| **Hide Empty Rows** | Hide uncharted (empty) rows. (Pair: **Show Empty Rows** — see [navigating.md](navigating.md).) |
| **Show Fetal Strip** | Split the pane to show the patient's **fetal strip** at the bottom of the flowsheet (with the option to view a second patient's strip). See [fetal-strip.md](fetal-strip.md). |
| **I&O Up to 10-Day Totals** | Display a 10-day snapshot of I&O totals in the **I&O Up to 10-Day Totals dialog**. See [io-10day-totals.md](io-10day-totals.md). |
| **I&O Split Pane** | Display the **I&O split pane** below a flowsheet. See [io-split-pane.md](io-split-pane.md). |
| **Previous** | View data for the page **prior** to the one currently displayed. |
| **Next** | View data for the page **following** the one currently displayed. |
| **Describe Item** | Display a database item's **full name, display name, internal name**, reference information (e.g. configured age range and vitals range), when the data was charted, and **by whom**. |
| **Edit History** | Display the complete **edit history** for the cell in a separate window. |
| **Refresh** | Check for and display any **newly added data** on the selected flowsheet, or **discard unsaved data**. |
| **Save** | **Save** new data and changes to a flowsheet. |
| **Subtabs menu** | Displays when there are **too many subtabs** to fit the screen. Select to see and choose a subtab name; select elsewhere on the screen to close the menu. |
| **Expand** (two variants) | Open a **section** or view the **Summary Grid**. |
| **Collapse** (two variants) | Close a **section** or the **Summary Grid**. |
| **Admit Time** (button) | Jump to the **Admit column** (see [navigating.md](navigating.md)). |

## In-cell icons

| Icon (name as used in this skill set) | Description |
|---|---|
| **Annotation** (in data cell) | Displays when there are **annotations** in the cell. Hover to show the tooltip with the annotation. |
| **Narrative** (in data cell) | Displays when there is a **narrative** in the cell. Hover to show a tooltip with the narrative. |
| **Observation** (in data cell) | Displays when there is an **observation** in the cell. Two variants: a **heart-shaped** icon (configured for **maternal** patients) or a **round** icon (other patients). Hover to show a tooltip with the observation details. |
| **Secondary Verification** | Indicates an item that **requires dual verification** or **has been dual verified**. See [dual-verification.md](dual-verification.md). |
