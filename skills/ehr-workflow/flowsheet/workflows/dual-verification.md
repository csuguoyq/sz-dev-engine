# Charting with Dual Verification

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves **two-person (independent) dual verification** of charted data — charting, editing, or deleting a dual verification.
> Source: EHR Online Help `Working_with_Flowsheets/Charting_with_Dual_Verification.htm`.

> ⚠️ **Always follow your facility procedures for independent dual verification.**

## What dual verification is / when it applies

- An **independent dual verification** requires **two people to separately verify** the dose and administration of a medication, or other clinical information, in flowsheets.
- **Medications**: your site pharmacist can configure specific medications to require dual verification. For those items a **Secondary Verification** icon displays **to the left of the medication name on the MAR**.
- **Flowsheets**: entire flowsheets can be configured to allow dual verification **in any cell**. Such flowsheets do **not** display a Secondary Verification icon next to the item name even though they allow dual verification.

## Charting a dual verification

> **Smart Card note (verifying staff):** when the system is set to require Smart Cards and the terminal supports two Smart Card readers, select the correct card from the **Card** field. If Smart Cards are **optional**, select **Username/Password** and enter a username/password — or note that the button toggles to **Smart Card**; use a Smart Card (if not already inserted, select the button and select the correct card from the **Card** field).

**Nurse or Staff One (charts the data):**
- **Medication administration**: double-click in the data cell → the specific **Administration dialog** displays → enter the time and verify the medication's **infusion rate or dose / order details** and other fields as needed → select **Save**.
- **Flowsheet item** (non-medication): enter the value in the cell → select the **Save** icon.

**Nurse or Staff Two (verifies):**
1. **Right-click in the cell with the stored data** and select **Dual Verification** → the **Dual Verification dialog** displays.
2. If **more than one administration** occurred in that cell, select the correct one in the **To Verify** field menu, and **complete the authentication**.
3. Select **Save**. A **Secondary Verification icon** now displays next to the dual-verified entry.
4. Hover over the cell for administration detail; you can also select the **Describe Item** and **Edit History** icons for edit details ([viewing-data.md](viewing-data.md)).

## Editing a dual verification

(Nurse or Staff Two edits a verification.)

1. **Right-click in the data cell** and select **Dual Verification**.
2. In the dialog, select the **verification to edit** and modify the field.
3. Select **Save**. Result: a **black triangle** displays in the top-right corner of the cell (indicating the stored data was changed — [symbols.md](symbols.md)); hover for administration detail; Describe Item / Edit History icons available for edit details.

## Deleting a dual verification

(Nurse or Staff Two can delete the **second signature** to correct a dual verification error.)

1. **Right-click in the data cell** and select **Dual Verification**.
2. In the dialog, select the verification and select **Delete**.
3. Result: the **Secondary Verification icon is removed** from the entry and a **black triangle** displays in the top-right corner of the cell; hover for administration detail; Describe Item / Edit History icons available for edit details.
