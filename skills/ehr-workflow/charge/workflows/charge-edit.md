# Charge Edit — Creating & Submitting a Charge (ChargeEdit)

> Companion to `skills/ehr-workflow/charge/SKILL.md`. Read this file when your task involves **entering a charge** in `ChargeEdit` (Quick Charge or Manual Charge), building the **charge queue**, **submitting** the queue, or **verifying posted charges in View Charges**.
> Prerequisite: reach the BNR's Charges subtab first — see [entry-and-navigation.md](entry-and-navigation.md) (login → Charge Services → Account Lookup → patient tab → BNR Overview → `Open` link on a child BNR row → BNR tab → `Charges` subtab → `Add Charges`).
> Browser-automation rules (URL, credential, `playwright_evaluate` script-format gotcha) also live in `entry-and-navigation.md` §6.

## 1. Where this screen is (code map)

- `ehr/src/Charge/ChargeServices/ChargeEdit/` — charge lookup, edit, queue, reverse, buckets, search toolbar.
- The patient charge view (`ChargePatient`) hosts the **Add Charges** surface with two modes: **Quick Charge** (bucket tree of charge codes) and **Manual Charge** (form-based entry). The charge **queue** and **Submit** live on this surface.
- Posted charges are reviewed in **View Charges** (separate tab in the same module).

## 2. Two entry modes

| Mode | What it is | When to use |
|---|---|---|
| **Quick Charge** | Pick charge codes from a collapsible **bucket tree** (e.g. ED Nurse, Injection, Push, Infusion). Clicking a code row adds it to the queue. | Fast capture of known charge codes. |
| **Manual Charge** | Fill a charge entry form (code, qty, modifiers…). | When you need fields not exposed by the bucket, or to edit a queued item. |

Switch between modes via the **Quick Charge / Manual Charge** chips (MUI toggle) on the Add Charges surface — implemented in `ChargeEdit/ChargeSearchToolbar.tsx` (labels `["Quick Charge", "Manual Charge"]`; availability gated on the `AQC` / manual-charge virtual perms). **Quick Charge is the default mode** (`manual=false`), so the bucket tree renders on entry to the Add Charges tab without clicking anything.

> Verified on SDMC `fbch34` on 2026-09-09 and again 2026-09-11 (second run: patient `35048test1L, 35048test1F`, BNR `H100165034458001`): the **Quick Charge** path.

## 3. Quick Charge flow (verified)

1. On the patient **Add Charges** surface, ensure **Quick Charge** is selected (it is the default).
2. The left area shows a **bucket tree** of charge-code groups. **Buckets verified on `fbch34` (2026-09-11):** `ED Nurse`, **`Injection (Non-Chemo)`** (codes `96372`, `96373`), `Push (Non-Chemo)` (`96374`–`96376`), `Infusion (Non-Chemo)` (`96365`, `96366`), under a `Select Buckets` header. The groups appear expanded by default — code rows are directly clickable.
3. **Click the charge-code row** (the code cell — the leaf `<p>` element whose text is exactly `96372`; the click bubbles to the row handler). It is appended to the **Charge Queue**.
   - The queue is a MUI DataGrid: `data-testid="charge-queue-data-grid"`.
   - Each clicked code becomes a row. A default bucket item (e.g. `35000`) may pre-populate the queue.
4. Repeat for additional codes; each click appends another row.
5. **Submit** — `data-testid="charge-queue-submit-button"`. It is **disabled while the queue is empty** and **enabled once ≥1 row exists**.
6. On success: the error dialog does **not** appear, the queue clears (`queueRows → 0`), and the charges post.

> ⚠️ A submission error dialog (`data-testid="charge-submission-error-dialog"`, text "Error Submitting…") **retains the queue** for correction. A bug surfaced and was fixed this session — submitting `96372` now posts cleanly with no error dialog.

## 4. Verify posted charges in View Charges (verified)

1. Click the **View Charges** tab (a `BUTTON` inside the `MuiTabs-flexContainer` of the Charges module). ⚠️ After Submit the surface can scroll, leaving the `Add Charges / View Charges` tab bar **above the viewport** — scroll the container `data-testid="charge-services-patient-transactions"` to the top (or `scrollIntoView` the tab) before clicking.
2. The posted-charges grid (`<BNR> - Charge Transactions`) lists each charge with columns (verified row, 2026-09-11): **Date/Time, Status, Post Date, Charge #, CDM Code, CDM Description, Qty, Charge Type, HCPCS/CPT, Rev Code, Modifiers, Edit** — e.g. `09/11/2026 03:01 | In Process | 09/11/2026 03:01 | 9300069 | THERAPEUTIC PROPHYLACTIC/DX INJECTION SUBQ/IM | 1 | Facility | 96372 | 450`.
3. Confirm the just-submitted code appears with today's date/time; a freshly posted charge shows **Status `In Process`**, and the toolbar above the grid reads `Review Needed by <user> at <datetime>`. The BNR tab header's **Account Balance** also updates to include the new amount.

Playwright one-liner to confirm a posted code (note: avoid `||`/arrow/`?:` inside the script string — see `entry-and-navigation.md` §6):

```
playwright_evaluate("var rows=Array.from(document.querySelectorAll('.MuiDataGrid-row')); var m=rows.filter(function(r){return r.textContent.indexOf('96372')!==-1}).map(function(r){return r.textContent.replace(/\\s+/g,' ').trim()}); return 'found '+m.length+' :: '+m.join(' | ');")
```

## 5. Manual Charge (outline — verify before asserting)

- Select the **Manual Charge** chip, fill the charge form, add to queue, then Submit as in §3.5–3.6.
- Form fields and validation to be filled in after a browser-verified pass.

## 6. Notes

- Charge codes are facility/site-specific; verify the bucket tree and code list against the live environment before asserting specific codes.
- The queue ↔ posted-charges handoff is the key acceptance check: **queue empties AND the code shows in View Charges** = success.
