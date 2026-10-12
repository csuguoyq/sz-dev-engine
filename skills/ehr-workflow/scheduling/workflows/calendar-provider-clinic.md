# Calendar tab — displaying a newly-created appointment (provider + clinic selection)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when you are **testing Scheduling in the browser** and a just-created appointment does **not** show on the calendar.
> Context: an appointment is created via the patient's Scheduling tab (see `registration/workflows/appointment-creation.md`), but to *see* it in the **Appointment Management → Calendar** tab you must make sure its **provider** and **clinic** are selected.

## Entry

`Appointment Management` app (left rail, `Appointment Management` button under `.home-non-navbtn-panel`) → **Calendar** tab → Ext JS `EnterpriseCalendarMainPanel` wrapping the Scheduling calendar.

> A newly-created appointment only renders on the calendar when BOTH (a) the appointment's **provider** is a checked resource under the **Providers** list, and (b) the top **clinic** selector matches the appointment's clinic. Otherwise the calendar shows an "Available" grid with no appointment block.
>
> **Appointments are date-scoped**: the main resource grid opens on the current/today date (e.g. Sep 1), so a future appointment (e.g. Sep 15) will NOT appear until you navigate the grid to that day first.

> **Day view layout (read first): provider = column, time = row.** In the day view each checked provider is a **column header**, and each time offset is a **row**. A provider's appointments appear **only inside that provider's column**. So to find a particular provider's appointment, scope to that provider's column (e.g. a `tangzp` or `demoess` column header) — the correct block is the one at the meeting (provider=column) × (appointment time row) intersection. This also means: if you only know the provider, you can pick the block directly from that column; if you recorded the provider+time at booking (see `registration/workflows/appointment-creation.md` Step 4), you can find the exact block by column+row without scanning other providers' columns. The column-header count (e.g. `demoess 2`) tells how many appointments that provider has that day.

> **Required order — follow the steps in this exact sequence:**
> 1. **clinic first** (Step 1) — establishes which calendar data is shown;
> 2. then the **provider** (Step 2) — surfaces the appointment block;
> 3. then the **date/time** (Step 3) — navigates the grid to the appointment's day;
> 4. then **scroll the block into view** (Step 4);
> 5. only then **open the block** (Step 5).
>
> Selecting the clinic before checking providers matters: doing it the other way around (providers first, clinic later) leaves the grid without the appointment and forces rework. Getting the block on-screen (Step 4) before opening it (Step 5) avoids acting on a stale/off-screen element.
>
> > **The provider you check in Step 2 must be the EXACT provider recorded at booking time** (from the appointment-creation Step 4 — the provider whose time-slot was selected, see `registration/workflows/appointment-creation.md`). Do NOT guess "first available provider" in the Calendar, and do NOT pick a different provider, or the appointment block will not render. Only after the correct provider is checked (Step 2) do you select the appointment's date (Step 3) for the appointment's provider+time calendar grid to display the block.

## Step 1 — select the appointment's clinic in the top selector

The appointment only displays once the top **clinic** selector matches the clinic chosen at booking time (e.g. `Cove Community`). The box initially reads a combined value like `San Diego Medical Center - Cove Community`, but that does **not** mean the matching clinic is active — you must actually pick the clinic from its menu.

The clinic selector is an **Ext JS combobox** whose drop-down trigger is a small down-arrow **`.x-form-trigger`** on the right edge of the field. It is **not** exposed as a readable/clickable accessibility element (a snapshot `ref`/selector won't resolve to a clickable control).

> **The dropdown is an Ext JS `x-menu`, not a boundlist.** The facility/clinic picker renders as an **`x-menu facility-clinic-menu x-layer`** whose options are **`.x-menu-item`** elements — **NOT** `.x-boundlist-item` / `.x-combo-list-item`. Consequence: a detection query for `.x-boundlist-item`/.x-combo-list-item` returns **0 even while the menu is open**, which is misleading. Query `.x-menu-item` to see the options. (Verified live 2026-09-08: selecting `Cove Behavioral`.)

1a. **Open the clinic menu — use a REAL click, not synthetic events.** Script-dispatched `mousedown`/`mouseup`/`click` (`new MouseEvent(...)` on `.x-form-trigger`) did **NOT** reliably open the menu in practice. The verified, reliable way is a **native click** with `browser_click` on the trigger via CSS selector:
   - `browser_click` `target = ".x-form-trigger"` (there is exactly one). This is the method that actually opened the menu.
   - (A `browser_evaluate` `mousedown` dispatch is only a last-resort fallback; if it fails, re-click with `browser_click(".x-form-trigger")`.)
1b. **Choose the clinic — click the `.x-menu-item` whose text equals the clinic name.** The menu lists clinics (e.g. `San Diego Medical Center`, `Cove Community`, `Cove Behavioral`, `Behavioral Health`, …) as `.x-menu-item` divs. `browser_click`'s `target` cannot reliably resolve to a menu item by ref, so use a side-effect `browser_evaluate` to find the `.x-menu-item` whose text is the target clinic and click it (return value irrelevant):
   ```js
   var t=null;Array.from(document.querySelectorAll('.x-menu-item')).forEach(function(e){if((e.textContent||'').trim()==='Cove Behavioral'){t=e;}});if(t){t.click()};return !!t
   ```
   (Replace `'Cove Behavioral'` with the appointment's clinic, e.g. `'Cove Community'`.) The menu closes on selection.
1c. **Verify the clinic was applied** before moving to Step 2:
   - The field input value updates to the combined value, e.g. `San Diego Medical Center - Cove Behavioral` (read via an input whose `.value` contains the clinic name) — this is the first confirmation.
   - The **Providers / Equipment / Rooms** lists **reset** on a clinic switch: the previously-checked provider checkboxes clear and the default provider list (e.g. `qz0824, demoess, tangzp, gyntest, …`) reloads to the new clinic's roster (here it dropped to empty). A clean provider reset confirms the switch took effect.
   - The menu is hidden again (`.facility-clinic-menu` `display:none` / zero rect).

## Step 2 — make the appointment's provider a checked calendar resource

The left panel has a **Providers** list (name text + a small checkbox button per row), plus **Equipment** and **Rooms** lists with the same kind of checkboxes. **Providers + Equipment + Rooms are counted together**: at most **5** total resources can be checked at once. Each checked provider becomes a column header on the grid; each checked Equipment/Room becomes a row/resource in the grid.

> **Mandatory gate — before checking ANY resource you MUST first count; if the count is already 5 you MUST uncheck one first (never check a 6th directly); hard constraint, tripped repeatedly before.** Providers + Equipment + Rooms checkboxes count **together**, at most **5** total — not 5 per list. Order of operations:
> 1. **First count the currently-checked ones:** `Array.from(document.querySelectorAll('.x-tree-checkbox')).filter(function(b){return (b.className||'').indexOf('checked')!==-1;}).length` (single-line, returns 0–5; you may also cross-check on the snapshot by reading each checkbox's `states` for a `checked` entry).
> 2. **If the count = 5: you must first uncheck one** — click the `.x-tree-checkbox` of one currently-checked resource again to uncheck it (uncheck & check use the same script, see 2b), bringing the count down to ≤4.
> 3. **Only when the count < 5 may you check the target resource.**
> 4. After checking, **verify via the grid column header** that the target column appears.

2a. **Is the provider already in the Providers list?**
   - **The just-created appointment's provider is OFTEN NOT in the initial Providers list** — providers seen at booking (e.g. a `gyntest` / `tangzp` / `jiangkd` chosen via First Available Time) are frequently absent from the calendar's default Providers list. So do not assume it's there; if the expected provider column is missing, expect to add it via Open Calendar below (verified with a freshly-created provider that appeared nowhere initially).
   - If **yes**, go to 2b.
   - If **no**, add it first:
     - Click the **add** icon next to **Providers** → opens the **Open Calendar** window (a dialog with a search box, a results grid, and a "Selected Calendars" area on the right).
     - Type the provider name (e.g. `demoess`) into the **Search Name** text input to filter the results grid.
     - **Click the Add button (`.actionBtn`) for the matching row.** The action column is rendered by `EnterpriseCalendarGrid.js` → `actionRenderer`, which outputs `<input type='button' class='actionBtn' value='+ Add'>` per row. The grid's `onCellClick` handler checks `target.className == "actionBtn"` and, when `actionText === '+ Add'`, fires `Cci.RunTime.fireEvent('ent-calendar-add', me, record)`.
     - The `actionBtn` input is a plain DOM element — it is **not** exposed as a readable/clickable accessibility element and may appear `readonly`. Use `browser_evaluate` (a side-effect script; return value irrelevant) to find and click it directly:
       ```js
       var found=false;Array.from(document.querySelectorAll('.actionBtn')).forEach(function(btn){var row=btn.closest('.x-grid-row')||btn.up('tr');var rowText=row?row.textContent:'';if(rowText.toLowerCase().indexOf('demoess')!==-1){btn.click();found=true;}});found
       ```
       (Replace `'demoess'` with the target provider name.)
     - After clicking, verify via re-snapshot that the provider now appears in the **Selected Calendars** area on the right side of the dialog.
     - Click the dialog's **Save** button to confirm. The dialog closes and the provider now appears in the left **Providers** list.
     - > **Do not** use Ext JS store APIs to programmatically add the record — the server-side change detection flags it as "No Change" and discards the addition on Save. Only the `actionBtn` click path triggers the real `ent-calendar-add` event that the backend accepts.

2b. **Check the provider.**
   - **Preferred & verified — click by row text, not by position.** The provider checkboxes have **no readable name** (`states: [readonly]`, `role: button`, blank label), so `browser_click`'s `target` (a ref or selector) forces you to guess the checkbox⇔name mapping, which is fragile and DID mis-click the wrong provider (`30064` instead of `qz0824`). Instead, in the **left panel each provider name sits in a `<tr>` that also contains its `.x-tree-checkbox`**. Use a **side-effect** `browser_evaluate` to find the row whose text contains the provider name and click that row's `.x-tree-checkbox` (the return value is irrelevant — verify via the grid headers):
     ```js
     var n=0;Array.from(document.querySelectorAll('tr')).forEach(function(tr){var txt=tr.textContent||'';if(txt.indexOf('qz0824')!==-1){var cb=tr.querySelector('.x-tree-checkbox');if(cb){cb.click();n++;}}});n
     ```
     (Replace `'qz0824'` with the target provider/equipment/room name. Works for uncheck too — same script.)
   - **Hard constraint is the "Mandatory gate" at the top of this Step** — count before checking; if at 5 uncheck one first, then check the target (Providers+Equipment+Rooms combined ≤5, across all three lists, not per-list).
   - **Always verify with the grid column headers** (e.g. a `qz0824 1` column appears, count `1` = 1 appointment that day). If the expected column did NOT appear, the `.x-tree-checkbox` click did not land — re-run and re-check before proceeding.

## Step 3 — navigate the calendar to the appointment's date/time

The main resource grid must be on the **same date** as the appointment. The top row holds a scrollable **date strip** of day-number buttons (one per day, spanning across month boundaries, e.g. `30, 31, 1, 2, …, 15, …`). **Click the target day-number button in this top date strip** to navigate the main grid to that day — the clicked button becomes `[active, focused]` and the resource grid re-renders for that date.

- The date buttons are normal `button`s with accessible names (the bare day number, e.g. `15`), so `browser_click` by snapshot `ref` (or selector) works.
- Prefer the **top date strip** over clicking inside the S/M/T/W/T/F/S **month mini-calendar** grid — the latter did not always advance the main grid in practice; the top strip button reliably did.
- To change months, use the **Previous Month / Next Month** buttons (labeled `Previous Month (Control+Left)` / `Next Month (Control+Right)`) in the month header.
- After navigating, verify either by checking the clicked day button is `[active]`/`[focused]` (re-snapshot) or by searching the page text for the patient name (see Step 5).
- > Do NOT assume the visible day equals the appointment date — always confirm the day is `[active]` and the appointment block renders (Step 5) before trying to open it.

## Step 4 — scroll the target block into view BEFORE operating it

> Before you check-in / check-out (or otherwise act on) an appointment, the block must be **inside the visible viewport**. The grid is a big Ext JS scroll container, and a future/lower appointment can sit far below the fold. If you operate a block that is off-screen, you risk acting on a stale or wrong element.

1. **Decide if it needs scrolling.** Read the block's rect and compare against the viewport:
   `(g=document.querySelector('div.ess-cal-day-evt-ctn'), (rc=g.getBoundingClientRect(), 'top='+Math.round(rc.top)+'|left='+Math.round(rc.left)+'|W='+innerWidth+'|H='+innerHeight+'|VIS='+(rc.top>=0&&rc.left>=0&&rc.bottom<=innerHeight&&rc.right<=innerWidth)))`
   - `VIS==true` → already on-screen, proceed.
   - `VIS==false` (e.g. `top=810 > H=794`) → it is below the visible area; scroll it into view (below).
2. **Scroll it to the CENTER of the parent data container — use a `getScrollCenterXY` delta computation from the block's OWN rect and apply via the two scrollbar containers' `scrollTo` (verified live: block centered ±<1px, fully in viewport, column-aligned). This is the PREFERRED method.**
   - **Location/render structure (context):** the day grid scatters scrolling across several elements:
     - `div.ess-cal-day-body-ct` — the **parent data container** (visible grid area; `getBoundingClientRect` gives the region to center the block within; ≈865×491 at default render).
     - vertical scrollbar container: `div.ess-cal-day-vertical-scroll-body` (native `overflow-y: scroll`).
     - horizontal scrollbar container: `div.ess-cal-day-horizontal-scroll-body` (native `overflow-x: scroll`).
     - provider column headers are **static** (fixed `y`, not scrolled).
   - **The verified method — incremental Δ then absolute `scrollTo` on the two scrollbar containers.** Keep the snippet below **single-line and end it with an explicit `return JSON.stringify(_r)`** so the `browser_evaluate` MCP tool returns the scroll coordinates instead of `undefined`. **The `return` is mandatory**: inside a plain function body (e.g. wrapped as `() => { ... }` for `browser_evaluate`), a trailing expression statement alone does NOT become the return value — only an explicit `return` does. The two `scrollTo` calls before it still apply the scroll as a side-effect even when you only care about the scrolling:
     ```js
     return (function(){var p=document.getElementsByClassName('ess-cal-day-body-ct')[0],b=(TARGET_BLOCK),pr=p.getBoundingClientRect(),cr=b.getBoundingClientRect(),_r={x:Math.round(p.scrollLeft+cr.left-pr.left-(pr.width/2-cr.width/2)),y:Math.round(p.scrollTop+cr.top-pr.top-(pr.height/2-cr.height/2))};document.getElementsByClassName('ess-cal-day-horizontal-scroll-body')[0].scrollTo(_r.x,0);document.getElementsByClassName('ess-cal-day-vertical-scroll-body')[0].scrollTo(0,_r.y);return JSON.stringify(_r)})()
     ```
     Replace `TARGET_BLOCK` with the correct child element (see "target" note below).
     - It centers the child inside `ess-cal-day-body-ct` **exactly** (measured deviation ≈ 0.4px vertical, perfect horizontal), keeps the whole block inside the viewport, and preserves the provider-column alignment (block.left aligns with the column-header left). Verified with scrollTo on the two scrollbar containers alone.
   - **NEVER hardcode `scrollLeft`/`scrollTop`** (e.g. reusing `886`/`399` from a past run) — a stale horizontal value over-scrolls and pushes the block off the viewport edge (occluding it). Always compute from the current `rect`.
   - **Target note — pass the correct child block.** Do NOT guess an index (`[...evt-ctn][2]`); the target block is whichever one is the appointment you want. Minimally pick the block by matching your patient text / the `tooltip` token on its `div.ess-cal-day-evt-header` (see Step 5), e.g. filter the `ess-cal-day-evt-ctn` list by `tooltip` containing your reason token, then pass that element.
   - After applying, **re-read the block rect and confirm**: centered (or at least fully inside the viewport `left>=0 && right<=innerWidth && top>=0 && bottom<=innerHeight`) and still inside its provider column. If it misses, recompute and re-apply before operating.
   - (Method taken from the shared `getScrollCenterXY` utility — keep a copy in the skill; the canonical field order/names above match what was verified live.)
3. **Re-check and re-scroll if the scrollbar snaps back.** Known caveat — the grid **reloads its store and re-renders on any data refresh** (e.g. a check-out triggers `setNeedUpdateCalendar(true)`), and that rebuild **resets the scroll container to its initial position**, undoing your scroll. So treat a single scroll as tentative:
   - after scrolling, wait ~1s, then re-read the rect from step 1.
   - if `VIS` is `false` again (scroll snapped back), call `scrollIntoView` once more.
   - only when `VIS==true` do you locate the **patient-filtered** block (Step 5) and open it (double-click by default; fall back to Enter keydown).
4. Verify by re-snapshot (element count jumps; the window is titled with the patient) and, if needed, a screenshot before acting.

## Step 5 — locate & open an appointment block (default: double-click; fallback: Enter keydown)

After Steps 1–3, the appointment renders as a block in its provider's column (the column header count increments, e.g. `qz0824 2` means 2 appointments that day). The block's inner text includes the patient name, e.g. `Testbot, Auto (36y, F) 01/01/1990 | gXrOrpkgbn…`.

- Block classes (from outer to inner): `ess-cal-day-evt` (`ess-cal-day-evt ext-cal-evt`), `ess-cal-day-evt-ctn`, `ess-cal-day-evt-body ext-cal-evt`, `ess-cal-day-evt-sub-body`.
- The appointment block is a **plain `div`** — it has **no accessible ref/role**, so `browser_click`'s `target` cannot reliably resolve to it, and the `.ess-cal-day-evt*` classes are not surfaced in the snapshot.
- To locate it in automation, use a short `browser_evaluate` that scans for the block (e.g. `browser_evaluate("() => /Testbot/i.test(document.body.innerText)")`) or for class rects via the reliable single-line body:
   `return (res=[], document.querySelectorAll('div.ess-cal-day-evt-ctn').forEach(function(e){var b=e.getBoundingClientRect(); res.push([Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)].join('|'));}), JSON.stringify(res))`
- **How the double-click open works (source):** in `webframe/web/ess/view/calendar/DayView.js`, the appointment container binds `dblclick` → `onDblClick`, which calls `getElClickInfo(e, t)` and only proceeds when the passed element has class **`ess-cal-day-evt-header`** or **`ess-cal-day-evt-body`** (everything else returns `null` → ignored). That is why synthesizing `MouseEvent('dblclick')` on other block nodes does nothing. The container also binds `keydown` → `onElKeydown`, which opens the same appointment when **Enter** is pressed while the focused element's className matches **`ess-cal-day-evt-ctn`** (it then calls `onDblClick(event, evt-ctn.childNodes[0].childNodes[0])` → the `ess-cal-day-evt-body`).
- **Default open — real double-click (recommended for all open actions):** dispatch a synthetic **`dblclick`** event so the flyout takes the true double-click code path (`onDblClick` via `getElClickInfo`). This is the **default** — use it to open an appointment for check-in / check-out / reschedule / verification. The event **must** land on an element with class **`ess-cal-day-evt-header`** or **`ess-cal-day-evt-body`** — any other node is ignored. Filter by patient text and dispatch, single-line ending in an expression:
  ```js
  var t=Array.from(document.querySelectorAll('div.ess-cal-day-evt-header')).filter(function(e){return e.textContent.indexOf('<PATIENT_TEXT>')!==-1;})[0];if(t){t.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,detail:2}))};return !!t
  ```
  (Replace `<PATIENT_TEXT>` with the patient's name/MRN as it appears on the block.) Note the target here is `ess-cal-day-evt-header` (the version with the inner `ext-cal-evt`), not `-ctn`. Verify the Patient Focus flyout appears with the correct patient info and **no blank screen** (the calendar background stays visible). If a pure `dblclick` does not trigger, also send a preceding `mousedown`+`mouseup` in the same single-line script (return value is a boolean).

- **Fallback — Enter `keydown` (only if the double-click did NOT open the block):** focus a `ess-cal-day-evt-ctn` and dispatch a synthetic **Enter `keydown`** on it. Ext JS's `onElKeydown` handler runs for the synthetic event (Ext binds via `addEventListener`, which ignores `isTrusted`), matches the className and ENTER keycode, and calls `onDblClick` → fires `calitemdblclick` → opens the appointment.
  - **Target the RIGHT appointment — filter by patient text, not index.** There can be **multiple** `ess-cal-day-evt-ctn` blocks in a day (the column header count next to the provider, e.g. `qz0824 3`, tells you how many). The block's `textContent` includes the patient name, so match the exact patient to open the correct one. Replace `<PATIENT_TEXT>` below with the patient's name/MRN as it appears on the block:
    `(g=Array.from(document.querySelectorAll('div.ess-cal-day-evt-ctn')).filter(function(el){return el.textContent.indexOf('<PATIENT_TEXT>') !== -1;})[0], g.setAttribute('tabindex','-1'), g.focus(), g)` — then dispatch the Enter `keydown` on the filtered element:
    `Array.from(document.querySelectorAll('div.ess-cal-day-evt-ctn')).filter(function(el){return el.textContent.indexOf('<PATIENT_TEXT>') !== -1;})[0].dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',code:'Enter',keyCode:13,which:13}))`
  > Note: the block may **re-render** after the calendar refreshes, so re-run the filter/dispatch in the same step if the first attempt targets a stale node. The `indexOf` patient filter is the reliable selector; `[0]` alone may pick another appointment when several exist that day.
- **Verify it opened:** re-snapshot — the number of locatable elements jumps (e.g. ~`263` → ~`337`) and now shows a window titled with the patient (e.g. `Testbot_0902001, Auto`) plus a **Check-in** tab (button **Check-In Patient**), `Encounter Details` / `Patient Details` panels, and a `close` button. No human double-click needed. After check-in completes, re-opening the same appointment shows both a **Check-in** and a **Check Out** tab (the latter selected) with a **Check Out Patient** button — that confirms the check-in went through.

> **⚠️ Do not read the appointment's current status from the opened window.** The **"Appointment Status"** field shown in the opened appointment window reflects the **action/workflow status to be performed** (i.e. which operation the front desk is about to do — e.g. `Arrived` meaning "ready/expected to check in", or that Check-in vs Check Out is the active step), NOT the appointment's *current clinical/visit status*. Relying on it to conclude the appointment's real state is misleading. Read the authoritative appointment info from the **opened panel → Encounter Details** instead (see below).

> **Get full appointment info from the block's tooltip (readable, no hover needed).** Each day block carries a standard HTML `tooltip` attribute on its **`div.ess-cal-day-evt-header`**, holding a full `<table>` of the appointment — **including the Reason for Visit** (hence the unique reason-token), plus patient/DOB/SSN/time/type/status. Read it with `getAttribute('tooltip')`; no real mouse hover is required and script-dispatched `mouseover` does NOT trigger the Ext JS tooltip. Reliable single-line read of all matching blocks' tooltips:
  ```
  var res=[];Array.from(document.querySelectorAll('div.ess-cal-day-evt-ctn')).forEach(function(e){if(e.textContent.indexOf('<PATIENT_TEXT>')!==-1){var h=e.querySelector('div.ess-cal-day-evt-header');res.push(h?(h.getAttribute('tooltip')||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,240):'noheader')}});return res.join(' || ')
  ```
  Because the reason-token is in the tooltip, you can **IDENTIFY the exact block you created by matching the token before opening** (see `registration/workflows/appointment-creation.md` Step 2) — even when patient/date/provider collide across several blocks. Note: `Ext.QuickTips.getTip` is NOT a function; use the `tooltip` attribute directly.
> **To fetch an appointment's information, you do NOT need to open the appointment window — read the block's `tooltip` (it already carries patient/DOB/SSN/time/type/Reason-with-token/status). Only open the window when you must perform an action (check-in / check-out / reschedule / edit). Prefer reading the tooltip for any "what is this appointment?" / verify-status question.**

> **Mandatory discipline — after a check-in / check-out submit the window auto-closes (expected, not an anomaly).**
> 1. **Do NOT go looking for / click a close button** — it is already closed (or closing); hunting a close button on an already-closed window wastes time and risks acting on a stale DOM read.
> 2. To keep working on that appointment (e.g. proceed to Check Out), **re-locate the block and open it again via double-click (default), falling back to Enter `keydown` if needed** (see this Step; re-run the `indexOf` filter on the re-rendered new block).
> 3. **How you may open an appointment:**
>    - **Default: double-click** (see "Default open — real double-click" above). Use it for check-in / check-out / reschedule / verification.
>    - **If the double-click did not open the block, fall back to Enter `keydown`** (see "Fallback — Enter keydown" above).
>    - In both cases **do NOT click the block by snapshot `target`/`ref` or by coordinates** — the block is a plain `div` with no accessible ref; a coordinate click can miss or be swallowed by a transparent "Available" overlay (see below). Use the scripted `ess-cal-day-evt-header` + `dblclick` / Enter-key routine.
- A transparent "Available" overlay can intercept *coordinate* clicks; if you ever need a real native click, neutralize it with CSS `pointer-events:none` on the overlay leaves + `z-index` on the block — but the scripted open routines above do not need that.

> **Heading to `ehr/src/Scheduling` tests:** to get a clickable appointment, create a patient + appointment first (see `registration/workflows/patient-creation.md`, `guarantors.md`, `appointment-creation.md`), display it via Steps 1–3, and open it with the double-click trick (Step 5) to reach Check-in/Check-Out/Reschedule.

## Notes on browser automation gotchas

- **Reading full appointment info — use the block's `tooltip` HTML attribute.** The day block's visible text shows only patient + time/type, but its `div.ess-cal-day-evt-header` carries a `tooltip` HTML attribute (a `<table>`) that includes the Reason of Visit (and the unique reason-token), patient/DOB/time/type/status. Read it via `getAttribute('tooltip')` (no hover; scripted `mouseover` won't show the Ext JS tip, and `Ext.QuickTips.getTip` is not a function). This is also how to pre-select the block you created by matching the token without opening.
- The provider checkboxes are **readonly buttons**, not `<input type=checkbox>` — `querySelectorAll('input[type=checkbox]')` finds nothing. Map them by DOM order against the provider name texts.
- Avoid fragile `browser_evaluate` bodies when returning objects/arrays built from large `document.querySelectorAll('*')` traversals (the harness intermittently drops the result); prefer `browser_click` (by `target` ref/selector) for standard clicks, and use short single-expression `browser_evaluate` bodies (numbers / `innerText` regex) for quick checks.
- Snapshot `ref`s / stale nodes go stale after any click (provider toggle re-renders the grid) — always re-snapshot before the next action.

## Key symbols

- `ehr/src/Scheduling/Scheduling.tsx` / `SchedulingRoot.tsx` entries; `screenParams.displayResources` for which resources/calendars show.
- `ehr/src/Scheduling/components/CalendarMainPanel.tsx` wraps the Ext JS calendar; toggle a provider / select clinic to refresh the grid.
- Portal registry: advancing to a workflow loads `ehr/src/Scheduling/components/<workflow>Panel.tsx + <workflow>/`.
