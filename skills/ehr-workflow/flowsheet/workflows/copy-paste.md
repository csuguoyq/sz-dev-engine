# Copying Flowsheet Data (Copy Paste)

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves **copying patient data charted in one time & date column and pasting it into another**, then editing as needed.
> Source: EHR Online Help `Working_with_Flowsheets/Copying_Flowsheet_Data.htm`.

> ⚠️ **You must have permission to copy flowsheet data** — contact your system administrator for help with permissions.

## What the feature does / restrictions

- Copy data charted in a **time & date column** and **paste it into another time & date column**, then edit the copied data as needed.
- All copy functionality is **configurable** — it may apply to a flowsheet, a section, or specific environments.
- The copy/paste function lets you **include or exclude the latest values by section or row** for copying/pasting into the corresponding cell.
- **Not copied**: annotations and flags (such as **High (H)** or **Low (L)**) and content such as **orders** that may exist in flowsheets.
- Restrictions:
  - You can only copy/paste **within a patient's chart** — not from one patient's chart to another.
  - If **Same User Copy** is enabled, you cannot copy/paste data **charted by another user**.
  - Depending on site configuration a **look-back time** may be configured — only data within that time period can be copied; data entered before that time cannot.

## Copying and pasting data

> ⚠️ If any section is configured to **not allow copying**, the **Copy Paste** icon / right-click menu option are **disabled**, and that section's data does not display in the Copy Paste dialog. Rows that have been **discontinued at the selected paste time** also do not display in the dialog.

1. **Select the time & date column** and select the **Copy Paste** icon, **or right-click** and select **Copy Paste**.
2. In the **Copy Paste dialog** you can:
   - Select the **Item checkbox in the header** to select/clear all checkboxes.
   - Select the **checkbox in a section header** to select/clear the checkboxes in that section.
   - Select or clear **individual checkboxes**.
3. Select **Paste**.
4. Make any changes to the copied data.
5. Select the **Save** icon.
6. In the **Validation dialog**, **enter your credentials** and select **OK**.
