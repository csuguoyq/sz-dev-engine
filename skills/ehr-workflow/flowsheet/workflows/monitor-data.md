# Entering Monitor Data (Read / Previous Read / Auto Read Monitor)

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves **importing bedside-monitor data into a flowsheet** — on demand, for a past time range, or automatically.
> Source: EHR Online Help `Working_with_Flowsheets/Entering_Monitor_Data.htm`. Device/ventilator variants: [medical-devices.md](medical-devices.md), [ventilator-data.md](ventilator-data.md).

## Feature setup & general behavior

- **Read Monitor** pulls data from the bedside monitor into the patient record **as determined by your site**. Requirements: the bedside monitor (or other devices) must be **connected to the CliniComp Universal Data Acquisition System (UDAS)** at the bedside, and the flowsheet must have the **Read Monitor functions enabled**.
- Three functions for adding monitor data to a flowsheet (if the patient is connected to a bedside monitor): **Read Monitor** (on demand), **Previous Read Monitor** (specified time in the past), **Auto Read Monitor** (automatic).
- ⚠️ When **any Read Monitor icon** is selected, **all interfaced medical devices** for that open flowsheet load and display their respective data **in italics** in the flowsheet ([symbols.md](symbols.md), [medical-devices.md](medical-devices.md)).

## Read Monitor (on demand)

1. In the **Vital Signs** section, select a **cell in the desired time & date column**.
2. Select the **Read Monitor** icon, **or right-click** and select **Read Monitor**. The **most recent readings** display in the data cells.
3. **Validate the data** or edit as desired, then select the **Save** icon.
4. In the **Validation dialog**, enter your credentials and select **OK**.

## Previous Read Monitor (past time range)

1. In the **Vital Signs** section, select a **cell in the desired time & date column**.
2. Select the **Previous Read Monitor** icon, **or right-click** and select **Previous Read Monitor**. The dialog displays the **current date and time at the top**.
3. Select the **beginning time** in the **Read Over Previous** field.
4. Select the **frequency** in the **Every** field — this determines how much historical data displays across multiple columns.
   > ⚠️ You can only go back **60 minutes** from the selected date/time cell to retrieve monitor data.
5. Select **OK**. **Time columns are added** based on the selected time interval and look-back time.
6. **Validate the data** or edit as desired, then select the **Save** icon.
7. In the **Validation dialog**, enter your credentials and select **OK**.

## Auto Read Monitor (automatic)

> ⚠️ **Permission is required** to use this feature — contact your system administrator.
> ⚠️ When **Auto Read Monitor is on**, **Read Monitor and Previous Read Monitor are unavailable**.

1. First, select **auto Q__ min** (e.g. Q1 min) on the physiologic monitor and **start it**.
2. In the **Vital Signs** section, select a **cell in the desired start time & date column**.
3. Select the **Auto Read Monitor** icon, **or right-click** and select **Auto Read Monitor** → the **Auto Read Monitor dialog** displays.
4. Select the **minute interval to match the monitor** from the **Read Every** field.
5. Select **OK**. Behavior while active:
   - Stays on until selected off, or turns off after a **configured amount of time**.
   - The **Read Monitor icon flashes with a red outline** while Auto Read is on.
   - Data is **automatically saved** using the credentials of the user who enabled the feature.

> ⚠️ Notes on auto read:
> - The flowsheet is **only updated with data while it is open** — closing the flowsheet turns off the auto read monitor function. To open another application without closing the flowsheet, right-click the desired application in the Patient Application Pane and select the desired **pop-up application**.
> - **Out-of-range values are not auto-saved** to the flowsheet. An **Error dialog** displays the out-of-range values that will not be saved. Out-of-range values are **NOT** the same as "abnormal" values — they are **hard stops provided by the manufacturer** preventing erroneous data from being saved to the patient's record.
