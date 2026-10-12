# Common Data Cell Types

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves **entering values into different kinds of flowsheet data cells** — free-text, calculated, dropdown, weight, date/time cells — and their entry mechanics.
> Source: EHR Online Help `Working_with_Flowsheets/Common_Data_Cell_Types.htm`.

> Flowsheets look different from each other, but share some **data cell types**; not all flowsheets have all the types covered here.

## Free-text

- A **free-text data cell** lets you **type text**.
- When finished: press **ENTER**, press an **arrow key** to move to another cell, or **select another data cell**.
- Free-text cells may **limit the number of characters**; some allow only letters, only numbers, or both.

## Calculations

- A **calculation data cell** calculates using a configured formula and adds a value based on entries you make in other data cells defined by that formula.
- Example: type a patient's temperature in the **TempF** data cell and press ENTER → the system calculates and adds the temperature in **Celsius** to the **TempC** data cell.
- Calculated results display **in italics** even when generated from manually entered values ([symbols.md](symbols.md)).

## Dropdowns

- A **dropdown data cell** lets you select from a list; depending on the cell you can select **one or multiple** items.
- Select a data cell, then make a selection one of these ways:
  - **Select from the list**, then select **OK** or **double-click** to move to the next cell.
  - **Type the dropdown number** in the cell. For multiple selections, press the **+** key between selections (e.g. `1+2+3`), then select **OK** or press **ENTER**.
  - **Double-click your selection** to add it and exit the cell.
- Press **ESC** to close the dropdown.
- Multiple selections display separated by a **semicolon** (see [data-entry-tips.md](data-entry-tips.md)).

## Weights

- **Weights** can be added and modified in multiple flowsheets, as well as in notes and Order Entry.
- If a weight is changed to **0 (zero)**, or **differs by a preconfigured percent change** from the patient's last **Dose Calc WT** (or other last weight value), a **warning** displays asking you to double-check the entry:
  - Select **No**, press **ESC**, or **close the dialog** → revert to the previous weight.
  - Select **Yes** → keep the value.

## Dates and times

- **Date data cell**: select the **Calendar** icon to open a calendar and choose the date; alternately **type in the date**.
- **Time & date cell**: select the **Calendar** icon and select the date and time, **or press CTRL+T** to add the current date/time.
