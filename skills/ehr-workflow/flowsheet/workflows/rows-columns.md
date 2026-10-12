# Working with Rows and Columns

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves **adding/starting/stopping rows** or **jumping to / adding a time & date column** on a flowsheet.
> Source: EHR Online Help `Working_with_Flowsheets/Working_with_Rows_Columns.htm`. Time navigation in general: [navigating.md](navigating.md).

You can **add a row or group of rows**, **stop and start a row**, and **jump to or add a column**.

## Adding a row or group of rows

Flowsheets are configured with rows for data commonly documented for most patients; **Add Row** lets you add an **optional row or group of rows** to a section. Row options vary by flowsheet section.

1. Select the **Add Row** icon in the toolbar, **or right-click in a time & date column data cell** and select **Add Row**.
2. To search: start typing in the **Keyword Search** field; matching items display.
   - Selecting a row highlights it in the **Rows pane** and selects the corresponding **group radio button** in the **Group pane**.
3. To add, select the **group** in the **Group pane** to see its sections and rows in the **Rows pane**:
   > ⚠️ Depending on your site configuration, selecting **individual rows may be restricted**, only allowing **group selection**.
   - To select **all of a group's rows**, select the **Rows** checkbox.
   - To add **only some rows**, select the checkbox for each row.
   - **Deselect** a checkbox to remove a selection.
4. Selected rows are added to the **Selected pane**. To remove rows before adding them to the flowsheet, select the **Delete** icon for the row.
5. Select **Apply**. The rows are added to the appropriate sections; each row shows a **blue left square bracket** in the time/date column where it was added ([symbols.md](symbols.md)).
6. Select the **Save** icon.

> ⚠️ A row may belong to several groups. **Duplicate rows are automatically removed** from subsequent groups added to the flowsheet.

## Stopping and starting a row

- **Stop Row** stops charting on a row that is no longer needed. Stopped rows **collapse from view** on the current screen when time columns shift them to the left; to view data charted on stopped rows, **scroll back in time**.
- **Start Row** continues charting on a row that was previously stopped.
- Stop/start can also be used to **emphasize and denote a section** of the documentation.
- ⚠️ If a stopped row has **dropped off the flowsheet**, use the **Add Row** feature to add the row again.

**To stop a row:**
1. Select the data cell in the appropriate **time & date column**.
2. Select the **Stop Row** icon, **or right-click** and select **Stop Row**.
3. A **blue right square bracket** is added to the data cell and, if configured, the cursor moves to the next row.
4. Select the **Save** icon.

> ⚠️ If patient data is charted on the flowsheet and then Stop Row is performed **in a column before** the charted information, **the charted data remains**.

**To start a row:**
1. Select a data cell in the appropriate **time & date column**.
2. Select the **Start Row** icon, **or right-click** and select **Start Row**.
3. A **blue left square bracket** is added to the data cell.
4. Select the **Save** icon.

## Jumping to or adding a column

### Using the Now Column icon
Depending on flowsheet configuration, the **Now Column** icon either:
- **Jumps** to the top of the hour column for the current time (e.g. in the MAR at 0917 → the 0900 column), or
- **Creates a column** for the current time including hour and minutes (e.g. in the Vital Signs flowsheet at 0917 → adds a 0917 column).

### Using the Enter Time icon
1. Select the **Enter Time** icon.
2. In the **Column Time & Date** dialog, change the time and date by **typing it in** or by selecting the **Calendar** icon.
3. Select **Done** → the new time & date column is added to the flowsheet.
4. Select the **Save** icon.
