# Flowsheet Symbols & Cell Font Cues

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when you need to **interpret what a cell is telling you** — markers that data was deleted/changed, row started/stopped, unsaved edits, or value provenance (device/auto vs manual, abnormal).
> Source: EHR Online Help `Flowsheet_Screen_Features/Flowsheet_Symbols.htm`.

> ⚠️ **Not all flowsheets use all these symbols**, and your configuration may not include all of them.

## Symbols

| Symbol / cue | Meaning |
|---|---|
| **Blank cell + black triangle** in the top-right corner | Previously entered and stored data was later **deleted**. |
| **Data + black triangle** in the top-right corner | Previously entered and stored data was later **changed**. |
| **Blue left square bracket** `[` | A row was **added**, or charting on that row was **started**. |
| **Blue right square bracket** `]` | Charting on that row was **stopped**. A stopped row **collapses from view** on the current screen; to view data charted in stopped rows, **scroll back in time**. |
| **Dark outline** in the data cell + **black dot** after the flowsheet tab title | **Unsaved data** is present. |
| **Bold red text** | Vital signs and pain scores may be configured to display **abnormal / out-of-range** values in bold red text. |
| **Italicized text** | Auto-populated data using **device management integration** (see [monitor-data.md](monitor-data.md), [medical-devices.md](medical-devices.md), [ventilator-data.md](ventilator-data.md)). |
| Regular font + **italicized calculations** | Manually entered data displays in regular font but can generate **calculations that display in italics** (see [data-cell-types.md](data-cell-types.md) → Calculations). |
| **Icons** in the flowsheet | Symbolize specific actions for that flowsheet type and section — see [icons.md](icons.md), plus the MAR icons and I&O icons documented in their own (non-converted) help sections. |

## Related reading

- Where markers appear during a workflow: black triangles after editing/deleting stored data ([data-entry-tips.md](data-entry-tips.md), [dual-verification.md](dual-verification.md), [treatment-flowsheets.md](treatment-flowsheets.md)); blue brackets when adding/stopping/starting rows ([rows-columns.md](rows-columns.md)); unsaved-data cues & discarding ([data-entry-tips.md](data-entry-tips.md)).
