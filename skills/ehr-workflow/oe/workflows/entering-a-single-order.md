# Entering a Single Order

> Companion to `skills/ehr-workflow/oe/SKILL.md`. Read this file when your task involves **placing one individual (non-standard-set) order** for a patient.
> Source: EHR Online Help `EssentrisOnlineHelp/orders/topics/entering_a_single_order.htm`.
> Related (not yet converted): `storing-orders.md`, `using-the-dose-calculator.md`, `entering-standard-orders.md`, `order-editor-dialog-box-samples.md`.

Order details are entered in an **Order Editor** dialog box. **The fields in that dialog vary by order type** — medication orders have Dose and Route fields, lab and radiology orders do not, and IV orders add fields such as Volume, Rate, and Site. Facility order types typically include medications, labs, IV drugs, radiology, dietary, and consults.

## Entry

From the **Patient Control** screen (a patient must be selected). An order can also be started from the MAR flowsheet, but the steps below assume Patient Control.

## Enter a single order

1. **Select the patient** on the Patient Control screen.
2. Click **Orders** in the Applications pane, then click **Order Entry**.
3. On the **Order Entry** screen, click the **New Order** icon.
4. In the **Category** dialog box:
   1. Select the category.
      - **NOTE:** when there are many categories, type a search string in the text entry field at the bottom of the **Category** dialog box to jump to matching categories.
   2. Click **OK**.
5. The **Order Editor** dialog box opens with the cursor in the **Name** field. In it:
   - In **Name**, begin typing a search string (e.g. `ace` for `acetaminophen`), then select the appropriate order from the list that displays.
   - To change the start or stop time, select the value and type a new one, or use the arrows to increase/decrease it.
     - Changing a time or date may cause the system to adjust related times/dates (e.g. the expiration date) once focus moves to another field.
   - For a **medication** order the system may pre-complete **Dose**, **Frequency**, and **Route**; these remain editable.
   - If applicable, use the **Provider** drop-down to select the provider who gave the order — for a provider user this defaults to that user's own name.
   - Select the **V/O** check box for a verbal order.
   - Use the **Comment** text box for indications or special instructions.
   - Complete any other fields as needed (see **Using the Dose Calculator** where dose calculation applies).
6. When finished, either:
   - click the **Assign Order** icon — leaves the **Order Editor** open to enter more orders **in the same category**; or
   - click the **Done** icon — finishes this category and returns to the **Active Orders** tab of the Order Entry screen.
7. The system marks the order with **three asterisks** in selected columns, e.g. **ENT** (Enter).
8. Store the order to persist it (see **Storing Orders**).

## Notes

- **Asterisks → initials:** once the order is stored, the three asterisks are replaced with the user's initials.
- **Auto acknowledge / sign / verify:** if the user holds the Acknowledge, Sign, or Verify permission, the stored order is automatically acknowledged, signed, or verified.
- **Order-type-specific fields** are the main source of form variation — never assume a field exists for a given order type.
- Site configuration governs which categories and order types exist; verify against the live environment before asserting behavior.
