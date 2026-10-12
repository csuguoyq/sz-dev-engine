# Working with Ventilator Data in Flowsheets

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves the **universal ventilator flowsheet** — populating ventilator data via monitor import or manual charting.
> Source: EHR Online Help `Working_with_Flowsheets/Working_with_Ventilator_Data_in_Flowsheets.htm`. Generic monitor import: [monitor-data.md](monitor-data.md); devices: [medical-devices.md](medical-devices.md).

> ⚠️ When you select **any Read Monitor icon** in a flowsheet, **all interfaced medical devices** in that open flowsheet load and display their respective data in the flowsheet ([medical-devices.md](medical-devices.md)).

## Display & features

- Depending on configuration, universal ventilator flowsheet data is a **distinct flowsheet** or **combined** with other data types (vital signs, respiratory assessments, respiratory treatments).
- The system **automatically detects the ventilator make, model, and mode** and **opens/closes the appropriate rows** needed for documentation based on them — so only relevant data elements populate from the ventilator data interface, and ventilator changes are viewable from a **single** universal ventilator flowsheet.
- Features:
  - **Labeled sections** categorized by **settings, measurements, and alarm limits** to discern ventilator data types.
  - Data entered using **any Read Monitor icon** displays **in italics**.
  - **Red font** highlights values outside of normal ranges set by your site.
  - **Each cell allows an annotation** ([annotations.md](annotations.md)).
  - A **vertical gray indicator bar** displays across all sections when the ventilator **Make/Model or Mode** fields are changed. Rows **no longer relevant** to the current ventilator settings display with a **gray background** and remain editable/viewable in the grayed-out cell.
- Universal ventilator flowsheet data may **also display** in configured notes, summary screens, and the **Early Warning Dashboard**.

## Populating ventilator data

Before data entry, ventilator sections may appear **collapsed**; the appropriate rows display data **in italics** once the data acquisition device detects the ventilator **make, model, and mode**. Depending on configuration, out-of-range values are highlighted in **red italics**.

### Populating current values
1. Select the **Read Monitor** icon → the appropriate rows open with data populating the flowsheet **in italics**.
2. Select the **Save** icon → the Save Changes dialog displays; select **OK**.

> ⚠️ If **Ventilator Tracking** is not the first section in the flowsheet, select either the **Make/Model** or **Mode** cell in the desired time & date column **before** selecting the Read Monitor icon.

### Populating values for a time range in the past
1. Select the desired **end time column** and select the **Previous Read Monitor** icon → the **Previous Read Monitor dialog** displays.
2. Select the desired intervals in the past, completing the **Read over Previous** and **Every** fields — the selection determines how much historical data displays across multiple columns.
   > ⚠️ You can only go back **60 minutes** from the selected date/time cell to retrieve monitor data **within the same mode**. The system does **not** allow Ventilator Make/Model and Mode modification.
3. Select **OK** → time columns with data are added based on the selected time interval and look-back time.
4. Validate the data or edit as desired, then select the **Save** icon → the Save Changes dialog displays; select **OK**.

### Auto-populating current values
1. Select the **Auto Read Monitor** icon → the **Auto Read Monitor dialog** displays.
2. Select the minute interval **to match the monitor** from the **Read Every** field, and select **OK**.
3. While active: stays on until selected off or until a configured amount of time passes; the **Read Monitor icon flashes with a red outline**; data is **automatically saved** using the credentials of the user who enabled the feature.

> ⚠️ The flowsheet is **only updated while it is open** — closing it turns off auto read. To open another application without closing the flowsheet, right-click the desired application in the Patient Application Pane and choose the desired **pop-up application**. **Out-of-range values are not auto-saved** (an Error dialog lists them); these are manufacturer **hard stops**, not "abnormal" values.

## Manually charting ventilator data

Manually entered values display in **regular font**; out-of-range values are highlighted in **red font** (per configuration):

1. **Double-click in the Ventilator Tracking section** → the **Ventilator Tracking dialog** displays.
2. Complete the **Make/Model** and **Mode** fields:
   - Ventilators **not supported** by the CliniComp Universal Data Acquisition System (UDAS) display **toward the end** of the make/model dropdown list **with brackets**.
   - Unsupported ventilators **not listed** may be autodetected and populate a Make/Model and Mode of **"{Other Ventilator}"** and **"{Other}"** respectively; the **Other Make/Model (free-text entry)** and **Other Mode (free-text entry)** fields display for manual completion.
3. Select **Apply** to close the dialog.
   - To add more detail to **Other Make/Model (free-text entry)**, select the field and enter the make/model of the ventilator.
   - To add an **optional annotation**, right-click in the same field, enter a comment in the dialog, and select **Accept** → an **Annotation icon** displays (hover to review).
4. For rows **not automatically populated**, select the row to add; or modify a value if you wish.
5. Select the **Save** icon → the **Save Changes dialog** displays → select **OK**.
   - Values entered **outside normal ranges** receive **system error dialogs** about the range discrepancy; select **OK** and the values display in **red font**.

> ⚠️ Previously entered data can be modified and displays **indicators (black triangles)** in each cell's upper right corner ([symbols.md](symbols.md)).
