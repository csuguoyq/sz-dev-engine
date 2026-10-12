---
name: "navigation"
description: "Locates and clicks the EHR app launcher buttons (Registration, Appointment Management, etc.) in the left icon rail. Invoke whenever a browser task needs to enter an app module from the EHR landing/portal page before interacting with its UI."
---

# EHR App Launcher Navigation (Left Icon Rail)

Load this first whenever you must reach a CliniComp EHR module (e.g. Registration, Appointment Management / Scheduling) from the portal page. This is the reliable way to find the app buttons without guessing through UI snapshots.

## Mandatory: switch apps by CLICKING the app-bar button — never by guessing a URL

- **To move between apps you MUST click the target app's button in the left icon rail (`home-non-navbtn-panel`).** Do NOT switch apps by manually constructing / re-entering a URL (e.g. trying to jump straight into `.../index.php/...`), unless an explicit URL was given.
- **One explicit exception:** a documented test-environment URL (e.g. the `browser-testing` skill's module entry URL) is for initial browser entry only; after that, moving to another module is by rail-button click.
- Rationale: guessed URLs can land on the wrong module or stale screen and bypass the intended app switch; the rail button is the sanctioned, verifiable path.

## Why this is needed

The EHR app buttons are **not easy to find via accessibility snapshots**:
- They live in a **narrow left vertical icon rail** (about 60px wide), not as text buttons.
- The button label (`<span>`) is **hidden until hover**, so snapshot/accessibility tools cannot surface the name (e.g. "REGISTRATION") as readable text.
- Buttons have **no `href`**, so you cannot navigate by link target.

## The reliable selection strategy

- All app buttons are `<a>` elements **inside the container element with class `home-non-navbtn-panel`**.
- Each `<a>` holds its label in a child `<span>` (the span text is what identifies it, e.g. `REGISTRATION`, `Appointment Management`).
- The rail order is fixed; each item is 46px tall, stacked from y≈46.

### Steps

1. List the buttons inside the rail with their label and order index:

```
document.querySelectorAll('.home-non-navbtn-panel a')  ->  for each <a>, read child <span> text as the name
```

2. Match the target button by its `<span>` text (e.g. `REGISTRATION`, `Appointment Management`, `HOME`, `REPORTS`, `DASHBOARD`).

3. Click it by calling `.click()` on the matching element (element.click() works in the browser page context).

### ⚠️ `browser_evaluate` format — see the shared rule (do not restate here)

The `browser_evaluate` MCP tool's `function` arg is **`() => { ... }`** and only returns values for a **single-line, semicolon-separated body ending in a `return`ed expression**; multi-line IIFEs, `for` loops, arrow-value functions without `return`, template literals, and DOM-mutating multi-statement bodies silently return `undefined` or throw. That rule is owned by the shared `ehr-ui/browser-testing/SKILL.md` (single source of truth) — **reference it instead of restating it here.**

Navigation-specific one-liners (working; rely on the shared rule above):

Working one-liner to click the target app button (e.g. `REGISTRATION`):

```
browser_evaluate("() => {var found=false;document.querySelectorAll('.home-non-navbtn-panel a').forEach(function(a){var s=a.querySelector('span');if(s&&s.textContent.trim()==='REGISTRATION'){a.click();found=true;}});return found}")
```

Working one-liner to verify the module loaded (e.g. Registration's Create New Patient button present):

```
browser_evaluate("() => document.body.innerText.indexOf('Create New Patient') !== -1")
```

## Reference: known rail order (indices as of the SDMC demo portal)

- 0 (empty), 1 `GLOBALINBOX`, 2 `Enterprise Application`, 3 `HOME`, 4 `REGISTRATION`, 5 `REPORTS`, 6 `DASHBOARD`, 7 `LIS`, 8 `Appointment Management`, 9 `SECUREMESSAGING`, 10 `PATIENTRECORD`, 11 `AMC`, 12 `RTR`, ...

Prefer matching by `<span>` label text over hard-coded index (orders can change). Example: find the `<a>` whose child `<span>` text equals/contains `REGISTRATION`, then `.click()` it.

## Verification

After clicking, confirm the module loaded by checking for a tell-tale element:
- **Registration**: buttons like `Quick Reg Unknown Patient`, `Create New Patient`.
- **Appointment Management (Scheduling)**: a calendar + `Scheduling Worklist`.

## Reminders

- Reference code only by file path + stable symbol names — never by line numbers.
- After any page mutation, re-snapshot before reusing element refs.