---
name: "browser-testing"
description: "EHR browser test-environment entry: how to construct the module URL (HOSTNAME + webframe dir overrides) and drive browser tests for EHR modules. Invoke when setting up or running a browser-level (playwright) test against the EHR portal, regardless of which module."
---

# EHR Browser Testing — Environment Entry

> Shared reference for browser-level (playwright / browser harness) tests against the EHR portal. Used by module test guides (e.g. `scheduling/workflows/testing.md`, `registration` testing) instead of each duplicating the URL rules.

## Base URL construction

Tests open a module via a URL of this shape:

```
https://<HOSTNAME>/<webframe-dir>/index.php/<Entry>[?screen=<screen>&hidepatientheader=true]
```

| Part | Default | Notes |
|---|---|---|
| `HOSTNAME` | **`${HOSTNAME}` env var** — e.g. `fbch34` on the current dev box | Resolve with `echo $HOSTNAME` (or `hostname -s`). ⚠️ **Never copy a host out of an example** — `fbch19` and `fbch34` are *different machines* |
| `webframe` dir | `webframe` | Optional parameter; user may specify a different directory, e.g. `webframe_xxxx` |
| `Entry` | `Cps` | Optional parameter; user may specify a different entry, e.g. `StaffConfTool` |
| `screen` | (none) | Optional query param; when present it is appended to the URL, e.g. `fedit`, `psat` |
| `hidepatientheader` | `true` | Fixed query param that accompanies `screen` — always `true` |

- HOSTNAME, the webframe directory, `Entry`, and `screen` are all **optional** parameters — only swap in a value when the user names one.
- When the user doesn't specify either, use the environment's default (`HOSTNAME` env var for the host, `webframe` for the directory, `Cps` for the entry).
- ⚠️ **Resolve `HOSTNAME` from the environment, never from a doc example.** These are separate physical boxes and each keeps its own patients/orders:
  - `fbch34` → `10.2.2.34` (the current dev box: `hostname` = `ccifbch34`, `HOSTNAME` = `fbch34`)
  - `fbch19` → `10.2.2.19` (**a different server** — validating here does *not* validate `fbch34`)
  - Check before you start: `echo $HOSTNAME` — and when reporting a result, always state which host it ran on.
- ⚠️ **Login is established ONLY through the `Cps` entry — regardless of the target `Entry` or `screen`.** Whatever `Entry`/`screen` the test targets (StaffConfTool, `screen=fedit`/`psat`, etc.), you must FIRST log on via `.../index.php/logon?ctrl=cps` (or reach `.../index.php/Cps`) to get the `webtoken`, and only then open the actual module URL. A non-`Cps` URL opened on a fresh session will not be logged in even if its shell renders.
- The path fragment `/index.php/` is constant.
- `screen` only appears when requested, and is always paired with `hidepatientheader=true`.
- Working example (no screen): `https://<HOSTNAME>.clinicomp.com/webframe/index.php/Cps`
- Working example (with screen): `https://<HOSTNAME>.clinicomp.com/webframe/index.php/Cps?screen=fedit&hidepatientheader=true`

## Example

- Default host (`$HOSTNAME`, e.g. `fbch34`) + default dir + default entry (no screen): `https://<HOSTNAME>.clinicomp.com/webframe/index.php/Cps`
- Custom host `myc` + custom dir `webframe_p2`: `https://myc.clinicomp.com/webframe_p2/index.php/Cps`
- Custom entry `StaffConfTool` + custom screen `fedit`: `https://<HOSTNAME>.clinicomp.com/webframe/index.php/StaffConfTool?screen=fedit&hidepatientheader=true`

## Logging in & entering a module

- Default credentials: username `demo` / password `123`.
- The user may explicitly name different username/password — use those instead when provided.
- **Two-step entry — always log on (and establish `webtoken`) BEFORE opening the module URL.** On a fresh session (no `webtoken` yet), opening `/webframe/index.php/Cps` directly can render the **portal shell without a real session**: the Page Title shows `CliniComp|EHR - San Diego Medical Center` (no user). **Logged-in state is confirmed by the Page Title prefix `<USER, <USERNAME>>`** — e.g. `USER, DEMO CliniComp|EHR - San Diego Medical Center`. Before doing anything, verify the title; if it is NOT a `USER, <name>` prefix, you are logged out and must log on first. The reliable sequence is:
  1. Open the **logon** URL first: `https://<HOSTNAME>/webframe/index.php/logon?ctrl=cps`. ⚠️ **A fresh logon page shows a "Smart Card Pin Dialog" FIRST** (verified fbch34 2026-09-16) — an ExtJS dialog containing a `PIN` box and three buttons `Options>>` / `Username/Password Login` / `Login`. The Username/Password textboxes are **already in the DOM but hidden** (`offsetParent === null`) behind it, so any `fill`/`click` on `input[placeholder='Username']` fails with **"element is not visible"** (the locator resolves but never becomes visible). **Click `Username/Password Login` to switch to the credential form** — a synthetic `.click()` on the button whose trimmed text is exactly `Username/Password Login` works; only after that do the two textboxes with placeholders `Username` / `Password` plus the `Login` button render.
  2. Fill the credentials (above) into those two textboxes (locate by placeholder) and click `Login`.
  3. On success the app auto-redirects to `https://<HOSTNAME>/webframe/index.php/Cps` and the Page Title becomes `USER, <USERNAME> CliniComp|EHR - San Diego Medical Center`, confirming login; the `webtoken` is stored in the browser's **session storage**.
  4. **Now open the actual target URL** — this applies even when `Entry` is NOT `Cps` or a `screen` is set (e.g. `.../index.php/StaffConfTool?screen=fedit&hidepatientheader=true`). Login always goes through the `Cps` context first (see the base-URL rule above); after the `webtoken` exists, the target `Entry`/`screen` URL loads logged-in.
  5. From then on, opening any `https://<HOSTNAME>/index.php/...` module URL loads straight into the logged-in portal (as long as the tab/browser still holds the session), and you can switch apps by rail-button click per the `navigation` skill.
  - ⚠️ **Fill Username and Password SEQUENTIALLY, then verify — never fill them in parallel** (verified 2026-09-09): two concurrent `browser_type` calls against this ExtJS logon form **race** — the username field ended up empty and the password box held the concatenation `demo123`, and clicking Login did not redirect. Target each input by its unique placeholder CSS selector (`input[placeholder='Username']`, `input[placeholder='Password']`) rather than ambiguous snapshot refs. After filling, **verify the actual values** before Login (e.g. `browser_evaluate` returning each `input.value` = `demo` / `123`); if Login does not redirect, re-check the values and re-fill sequentially, then retry.
  - If `ctrl` needs to match the target module's entry, use the module entry as the `ctrl` value (e.g. `ctrl=cps` for entry `Cps`).
- Login and app-entry (left icon rail, e.g. Registration / Appointment Management) are covered by the `navigation` skill.
- Credentials / portal entry: see the `navigation` skill `skills/ehr-ui/navigation/SKILL.md`.

## Output directory (screenshots & snapshots)

> Verified against the installed `@playwright/mcp` (coreBundle.js): explicit `filename` and auto-named files resolve by **different rules**.

- The playwright MCP server resolves file paths by **two different rules**:
  - **Explicit `filename` param** (e.g. `browser_snapshot(filename="foo.yml")`) → `path.resolve(server-process-cwd, filename)`. The server process cwd here is `~` (the home dir), **not** the repo — so a bare relative name lands at `~/foo.yml`. `--output-dir` is **ignored** for explicit filenames.
  - **No `filename`** (auto-named `page-*.yml`, `console-*.log`) → resolved against the server's `--output-dir` (here `~/.playwright-mcp`).
- **Allowed roots**: the server denies any path outside `outputDir` (`~/.playwright-mcp`) and `cwd` (`~`) — an absolute repo path like `<cwd>/.playwright-mcp/...` fails with `File access denied: ... outside allowed roots`.
- To save a screenshot/snapshot **under `~/.playwright-mcp` with a chosen name**, use one of:
  - omit `filename` → auto-named `page-<UTC-timestamp>.yml` in `~/.playwright-mcp` (unique, zero collision) ✓
  - `filename=".playwright-mcp/<name>-<YYYYMMDD-HHMMSS>.yml"` (relative, with the folder prefix) → `~/.playwright-mcp/...` ✓ — **preferred for named files: embed a timestamp in the name so repeated runs never overwrite each other**, e.g. `.playwright-mcp/appt-20260908-2333.yml`
  - `filename="~/.playwright-mcp/<name>-<YYYYMMDD-HHMMSS>.yml"` (absolute under the home root) ✓
- **Avoid fixed (non-timestamped) explicit names** (e.g. `.playwright-mcp/reg-search.yml`): a repeated run overwrites the previous file, and multiple agent windows sharing `~/.playwright-mcp` race on the same name (last-writer-wins).
- **Subdirectories work but are NOT auto-created for explicit `filename`s** (verified: ENOENT) — run `mkdir -p ~/.playwright-mcp/<subdir>` first, then `.playwright-mcp/<subdir>/<name>-<YYYYMMDD-HHMMSS>.yml`.
- **Never** pass a bare relative name expecting `--output-dir` (it lands at `~/<name>`, the server cwd), nor an absolute repo path (denied by the allowed-roots check).
- Convention: anchor to `~/.playwright-mcp` with a timestamped name (or no name); afterwards read the files from `~/.playwright-mcp/`.

## Rule of thumb

- Before a browser test, resolve the full URL using the rules above, then hand it to the navigation skill to reach the target module.
- If a test guide references "browser environment / URL", link back here instead of restating the rules.

## ✅ / ❌ Test-case conclusion reporting (show PASS/FAIL icons)

Every test case ends with an explicit verdict. **Always report the conclusion with clear icons** so it is visible at a glance; never leave the reader to infer the outcome. (Agreed with the user 2026-09-08.)

- Output a fixed "conclusion block" at the end of the run, e.g.:

  ```
  ## Test Verdict: ✅ PASS   (or ❌ FAIL)

  - Step 1  ...  ✅/❌
  - Step 2  ...  ✅/❌
  - Observed : ...
  - Expected : ...
  - Verdict  : ✅ PASS / ❌ FAIL
  ```

- Verdict rules:
  - The case **passes** only if every step's observed result matches the expected one.
  - If any step's observed result differs from the expected outcome, the case is **❌ FAIL** — state it directly; do **not** silently proceed to "fix" it with actions the case never listed.
  - **Strict adherence**: run only the steps listed in the case; do **not** add unlisted extra operations. If reaching the expected result would require operations beyond the listed steps, **stop and consult the user** (or, per the user's instruction for the current case, mark it FAIL) rather than improvising.
- Icon legend:
  | Icon | Meaning |
  |---|---|
  | ✅ | PASS (through) |
  | ❌ | FAIL (does not pass) |
  | ⚠️ | Blocked / needs user confirmation |

## ⚠️ Cross-module rule: `browser_evaluate` script format

This applies to **every** browser-level test in **every** module, so it lives here (shared) rather than in any single module guide. Follow it **whenever you drive the browser** (the harness used is playwright, but the MCP tools are named `browser_*`):

- **Run JS in the page via the `browser_evaluate` MCP tool.** Its signature takes a **function body**: `() => { ... }` (or `(element) => { ... }` when targeting a snapshot element). Keep the body **single-line, semicolon-separated, ending in a `return`ed expression** — a trailing expression without `return`, multi-line IIFEs, `for` loops, and template literals **silently return `undefined`** (no error), which the agent may misread as "script failed" and retry unnecessarily.
- **Prefer `browser_click`/`browser_type`/`browser_fill_form` for standard elements** and reach for `browser_evaluate` **only** when the target has no accessible ref (Ext JS cells, plain `div`s, MUI wrapper `div`s whose inner `input` must be set via React's native value setter). `browser_click` accepts either a snapshot `ref` or a unique CSS selector in its `target` argument, and a `doubleClick:true` option for double-clicks.
- Write the script so its **return value is meaningful** (e.g. a joined result string, a count, a boolean), not `undefined`, so the agent can verify success from the return instead of guessing.
- ⚠️ **A trailing bare expression is NOT a return value inside a `() => { ... }` body.** Statements like `var x=...;x` or `...;out.join(', ')` evaluate the final expression but, without an explicit `return`, the arrow-function body silently yields `undefined`. Always end the body with an explicit `return <expr>;`.
- Preferred single-line pattern (fills `[data-testid … field] input` fields with React's native setter; ends with `return`. Fill each field as a `[testid, value]` pair):
  ```js
  var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;var out=[];[['a-testid','a-value'],['b-testid','b-value']].forEach(function(p){var el=document.querySelector('[data-testid="'+p[0]+'"] input');if(el){setter.call(el,p[1]);el.dispatchEvent(new Event('input',{bubbles:true}));out.push(p[0]+':ok')}else{out.push(p[0]+':miss')}});return out.join(', ')
  ```
- When a script's only purpose is a **side effect** (e.g. clicking a DOM element with no accessible ref), it may still return `undefined`; then verify the **outcome** via a follow-up read (re-snapshot / `browser_evaluate` that returns a value), not by the script's return.
- Break multi-step DOM-mutating scripts into separate calls and re-snapshot between them (one script that closes a dialog then fills fields can throw "Script failed to execute").
- Reference this rule in `navigation` and all module `testing.md` guides instead of restating it per module.