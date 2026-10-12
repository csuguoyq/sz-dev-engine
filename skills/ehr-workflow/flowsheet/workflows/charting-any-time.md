# Charting Data at Any Time (arbitrary date/time column)

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves **charting a flowsheet value into a column for an arbitrary time** — i.e. a time other than "right now" (past backfill or a future time), a time whose column does not already exist, or a specific column on another date. It combines the column mechanics of [rows-columns.md](rows-columns.md) (Enter Time) with the cell-entry mechanics of [data-entry-tips.md](data-entry-tips.md).
> Sources: EHR Online Help `Working_with_Flowsheets/Working_with_Rows_Columns.htm` (Enter Time) and `Flowsheet_Screen_Features/Navigating_Flowsheets.htm` (time navigation). Live-app (DOM) hooks referenced here live in `../SKILL.md` §4 "Live-app implementation notes".

## Mental model

A flowsheet is a grid of **rows (data items) × time/date columns**. Charting = put the value into the **cell at the intersection** of the item's row and the desired time column, then **Save**.

- Live demo columns advance every **5 minutes** — so "any time" that is not an existing column boundary needs its own column created first.
- Charting at an arbitrary time is therefore two steps: **(1) have a column for that exact time/date** (create it with **Enter Time** if it does not exist), **(2) type the value into that column's cell for the item row** and save.

## Which approach to use

| Goal | Approach |
|---|---|
| Current time | The flowsheet shows a now-ish column; click the item's cell and type (see [data-entry-tips.md](data-entry-tips.md)). If no exact now column: **Now Column** icon, or **Enter Time** + the picker's **Now** button. |
| Existing column in the past | Scroll back in time — **Prev** icon, scroll bars, or **Admit Time** button to jump to the Admit column ([navigating.md](navigating.md)) — then click that column's cell. |
| Arbitrary time with **no existing column** (e.g. `06:15`, or a different day) | **Enter Time** → add a column for that exact date/time; the grid adds and jumps to it — then chart into it (procedure below). |

## Procedure — chart at an arbitrary time (verified end-to-end 2026-09-09, VITALS flowsheet)

1. **Open the patient's flowsheet** (entry path per `../SKILL.md` §1/§4) and pick the flowsheet tab (e.g. `VITALS`).
2. **Create the target time column** (skip if the column already exists):
   1. Click the toolbar **Enter Time** button (`a.x-btn`, tooltip `Enter Time`) → the **"Column Time & Date"** dialog opens with the current time pre-filled (`HHmm dd MMM yyyy`).
   2. ⚠️ **Do not type the value into the field** — the Ext date field corrupts typed values (verified: `1015 09 Sep 2026` → `0020 15 Oct 2026`). Use the **calendar trigger** (`div.cci-date-time-field-ic`) beside the field.
   3. In the date-time picker (`div.x-datepicker.cci-datetime-picker`): use the **month arrows** and **day cells** to pick the date; set the time with the **Hour** / **Minute** rows' small **step buttons** (each click changes the value by **1**; Hour row first, then Minute row); optionally use footer **Now**.
   4. Click footer **Done** — commits the date/time **and closes the whole dialog**. The flowsheet **adds the column and auto-scrolls to it** (it may also extend trailing columns).
   > Full DOM detail + pitfalls: `../SKILL.md` §4 "Enter Time" bullet.
3. **Chart the value**:
   1. Locate the item's **row label** on the left (e.g. `td.name` = `Heart rate`) and the new time **column header** (`td.time` / `td.date`).
   2. **Click the data cell** at their intersection → an inline editor opens (live: Webix `div.webix_dt_editor` input).
   3. **Type the value**, press **ENTER** (see [data-cell-types.md](data-cell-types.md) / [data-entry-tips.md](data-entry-tips.md) for cell-type rules — free-text vs dropdown vs date).
4. **Save**: click the toolbar **Save** icon → in the **"Save Changes? … Do you want to save now?"** dialog select **OK**.
5. **Verify**: the cell shows the value; the added column survives **Refresh** with no Unsaved/Discard prompt (commit proof). Optional deep checks: **Edit History** / **Describe Item** ([viewing-data.md](viewing-data.md)), or add an **annotation** ([annotations.md](annotations.md)).

## Notes & constraints

- **Column persistence**: a column added via Enter Time is staged like charted data — it persists only after **Save** ([rows-columns.md](rows-columns.md) ends the Enter-Time flow with Save).
- **Manual vs interfaced data**: manual charting is not bounded to "now" — any column you can create/scroll to can be charted. Time/mode limits in the Online Help apply to **monitor-imported** data, not manual entry: Read Monitor / Previous Read Monitor are limited to **60 minutes back** ([monitor-data.md](monitor-data.md)) and ventilator previous-read cannot cross a Make/Model/Mode change ([ventilator-data.md](ventilator-data.md)).
- **Cell editing rules still apply**: after typing, press ENTER; out-of-range values raise errors / may render in red; changed/deleted stored data shows the black triangle; unsaved entries show the dark outline + tab dot ([symbols.md](symbols.md), [data-cell-types.md](data-cell-types.md)).
- **Time grid is configurable**: 5-minute cadence is this environment's demo config; other sites may differ (see [SKILL.md](../SKILL.md) caveat).

## Related

- [rows-columns.md](rows-columns.md) — add/jump columns, add/start/stop rows (Enter Time mechanics).
- [navigating.md](navigating.md) — Prev/Next, Admit Time, Now Column, time navigation.
- [data-entry-tips.md](data-entry-tips.md), [data-cell-types.md](data-cell-types.md) — entering & saving values.
- [viewing-data.md](viewing-data.md), [symbols.md](symbols.md), [annotations.md](annotations.md) — verifying, reading cues, annotating the charted value.
