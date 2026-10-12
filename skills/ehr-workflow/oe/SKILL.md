---
name: "oe"
description: "Order Entry (CPOE2) guide — invoke when a task is about placing, communicating, tracking or auditing a patient's orders (entering a single or standard/order-set order, dose calculator, editing, removing, copying, discontinuing, renewing, rewriting, storing, acknowledging, signing, cosigning, reviewing, verifying orders; order views/tabs; annotations; audit trail; order states/colors/icons/permissions), OR about developing or browser-testing the live OE module ehr/src/OE (+ ehr/src/oe-shared). Workflow content is converted from the CliniComp EHR Online Help 'Orders' section; code half maps the real React module."
---

# Order Entry / CPOE2 (Orders)

> Load this file first to get the module map. It is a **router**: pick your direction below, then read ONLY the file you need so unrelated detail stays out of context.
> This skill has **two halves**:
> 1. **Workflows** — `workflows/*.md`, converted from the **Orders** section of the CliniComp EHR Online Help (`EssentrisOnlineHelp/orders/topics/`, 45 topics, content dated 24 Aug 09) plus `orders/images/` (65 screenshots). These describe the **behavior of the live application**.
> 2. **Code map** — the real React module **`ehr/src/OE`** (CPOE2) and **`ehr/src/oe-shared`**.
>
> ⚠️ **Do not duplicate `ehr/src/OE/docs/`.** That module already ships its own engineering documentation (architecture / components / patterns). This skill **links to it** and covers only what it does not: order workflows, cross-cutting order semantics, and browser-test hooks.
> ⚠️ **Everything here is site-configurable** — order types, categories, order sets, icons, colors and permissions vary by facility/environment. Verify against the live environment before asserting behavior.

## 0. Pick your direction first

| What you are doing | Read |
|---|---|
| 🔍 Looking up a specific **order workflow** | the matching row in the index in §2 |
| 🧭 Entering / navigating / reading the **Order Entry screen** | `accessing-the-order-entry-screen.md`, `order-entry-screen-structure-and-features.md`, `navigating-the-order-entry-screen.md`, `reading-order-data.md` (⏳ pending) |
| 🧬 Order **states / colors / permissions** semantics | `order-states.md`, `order-color-definitions.md`, `order-permissions.md` (⏳ pending) |
| 🖼️ Naming an **icon** (order / order editor / standard order) | `order-icons.md`, `order-editor-icons.md`, `standard-order-icons.md` (⏳ pending) |
| 🧑‍💻 Writing / modifying **OE code** | §3 code map, then `ehr/src/OE/docs/architecture/overview.md` (+ its siblings) |
| 🧪 **Browser-testing** the live Orders app | `skills/ehr-ui/browser-testing/SKILL.md` + `skills/ehr-ui/patient-control/SKILL.md`, then §5 |

## 1. What the module is

- **As an application**: Essentris **Order Entry** places, communicates, tracks and audits a patient's orders. Order functions (entering, signing, …) are **permission-controlled**. Typical order types: **medications, labs, IV drugs, diagnostic procedures (MRI/CT), respiratory therapy treatments, consults, dietary, nursing-initiated orders**. Facilities may also use **standard order sets** (collections of commonly co-ordered orders for a regimen/protocol).
- **As code**: **CPOE2** (Computerized Provider Order Entry) in `ehr/src/OE` — a 440+ component ordering system (per `ehr/src/OE/docs/README.md`).
- **Entry chain (code)**: `ehr/src/OE/index.tsx` (bootstrap + provider stack) → `ehr/src/OE/OE.tsx` (main tabbed interface, `MAIN_TABS`).

## 2. Workflow index — READ ONLY WHAT YOU NEED (on-demand)

**Conversion status:** ✅ converted · ⏳ not yet converted (filename shown is the planned target).
The `image_*.htm` / `order_editor_dialog_box_samples` topics are **dialog-box image references** — fold them into the related workflow file instead of creating standalone files.

### Orientation & concepts

| If your task is about... | File | Status |
|---|---|---|
| What Order Entry is; order types & order sets | `orders-overview.md` | ⏳ |
| The Order Entry module conceptually | `understanding-the-order-entry-module.md` | ⏳ |
| Permission-gated order functions | `order-permissions.md` | ⏳ |
| Order lifecycle states | `order-states.md` | ⏳ |
| What order colors mean | `order-color-definitions.md` | ⏳ |

### Screen, navigation & reading

| If your task is about... | File | Status |
|---|---|---|
| Opening the Order Entry screen | `accessing-the-order-entry-screen.md` | ⏳ |
| Screen layout / panes / tabs | `order-entry-screen-structure-and-features.md` | ⏳ |
| Moving around the screen | `navigating-the-order-entry-screen.md` | ⏳ |
| Interpreting displayed order data | `reading-order-data.md` | ⏳ |

### Icons

| If your task is about... | File | Status |
|---|---|---|
| Order list icons | `order-icons.md` | ⏳ |
| Order Editor icons | `order-editor-icons.md` | ⏳ |
| Standard-order icons | `standard-order-icons.md` | ⏳ |

### Working with orders

| If your task is about... | File | Status |
|---|---|---|
| Placing one individual order | [workflows/entering-a-single-order.md](workflows/entering-a-single-order.md) | ✅ |
| Creating an **ADT** order (Admission / Update / **Discharge** / Transfer) | [workflows/creating-an-adt-order.md](workflows/creating-an-adt-order.md) | ✅ (code-derived, not live-verified) |
| Entering standard orders / order sets | `entering-standard-orders.md` | ⏳ |
| Dose calculation | `using-the-dose-calculator.md` | ⏳ |
| Editing an existing order | `editing-an-order.md` | ⏳ |
| Removing an order | `removing-an-order.md` | ⏳ |
| Copying an order | `copying-an-order.md` | ⏳ |
| Discontinuing an order (nurse) | `discontinuing-an-order-nurse.md` | ⏳ |
| Discontinuing an order (provider/ancillary) | `discontinuing-an-order-provider-ancillary.md` | ⏳ |
| Renewing an order (nurse) | `renewing-an-order-nurse.md` | ⏳ |
| Renewing an order (provider/ancillary) | `renewing-an-order-provider-ancillary.md` | ⏳ |
| Rewriting orders | `rewriting-orders.md` | ⏳ |
| Adding an annotation to an order | `adding-an-annotation-orders.md` | ⏳ |
| Storing (persisting) orders | `storing-orders.md` | ⏳ |

### Managing orders

| If your task is about... | File | Status |
|---|---|---|
| Acknowledging | `acknowledging-an-order.md` | ⏳ |
| Signing | `signing-an-order.md` | ⏳ |
| Cosigning | `cosigning-an-order.md` | ⏳ |
| Reviewing | `reviewing-an-order.md` | ⏳ |
| Verifying (pharmacy) | `verifying-an-order.md` | ⏳ |

### Views & audit

| If your task is about... | File | Status |
|---|---|---|
| Views concept | `views-overview.md` | ⏳ |
| Creating / editing / removing a view tab | `creating-a-view-tab.md`, `editing-a-view-tab.md`, `removing-a-view-tab.md` | ⏳ |
| Viewing an annotation | `viewing-an-annotation-orders.md` | ⏳ |
| Viewing the audit trail | `viewing-the-audit-trail.md` | ⏳ |

> Rule: read exactly the matching file(s); do not dump all workflow files into context at once.

## 3. Code map (`ehr/src/OE`)

Entry is selected by **`screenParams.entry`** (see `ehr/src/OE/docs/architecture/overview.md`):

| Entry | Component / area |
|---|---|
| `"OE"` (default) | `OE.tsx` — full tabbed order entry |
| `"quickOrder"` | `QuickOrder.tsx` (under `subs/`) |
| `"phmverqueue"` | pharmacy verification queue |
| `"orderList"` | `OrderList.tsx` (under `subs/`) |
| `"oeplans"` | OE Plans (order set plans) |
| `"specifiedorder"` | single order entry |
| `"tfiq"` | TFIQ (timed flag / pharmacy dispensing) |

### Main tabs (`OE.tsx`, `MAIN_TABS` in `config/Constants.ts`)

**Entry** → `entry/` · **Actions** → `actions_log/Actions` · **Log** → `actions_log/Log` · **Med Profile** → `medprofile/` (pharm mode + `VERIFICATION_SUITE` R) · **Order Reconcile** → `medrec/` (`MEDRECON` / `ReconcileSign` perm, pharm mode) · **Legacy Orders** → `legacy/` (when non-empty) · **Future AMB Orders** → `futureAMB/` (pharm mode).

### Directory responsibilities

| Path | Responsibility |
|---|---|
| `index.tsx` | bootstrap, provider stack (QueryClient → StyledEngine → Theme → Alert → Loading → OEContext → MedWarnings → Medrec) |
| `OE.tsx` | tabbed shell, `MasterOeContext`, `resolveInitialTab`, unsaved-changes guard (`UnsavedDialog`) |
| `OeTypes.ts` | shared TypeScript types |
| `config/` | constants incl. `MAIN_TABS`, `ORDER_STATUS` |
| `context/` | `OEContext` (master config/orders/choices), `LoadingContext`, `MedWarningsContext`, `Alert` |
| `model/RecordModel.ts` | `Record` class — getters (`getDose`, `getRoute`, `getFrequency`, `getStartTime`), state checks (`isActive`, `isSuspended`, `needSign`, `needVerify`) |
| `entry/` | main order entry: forms, panels, utils (largest area) |
| `common/` | shared components (`BaseFormRow`, `ReusableChipsGroup`, `OEChip`, `MainTabs`, `UnsavedDialog`) |
| `hooks/` | order action hooks (DC, Suspend, Resume, …) |
| `services/` | order operation services |
| `medprofile/`, `medrec/`, `medwarnings/` | medication profile, medication reconciliation, drug warnings/interactions |
| `verification/` | pharmacy verification |
| `tfiq/` | timed flag interface |
| `actions_log/` | Actions & activity log |
| `describe/` | order description feature |
| `legacy/`, `futureAMB/`, `subs/`, `popup/`, `util/` | legacy orders, future/outstanding orders, sub-entries, modals, utilities |

### Existing module docs — link, don't copy

- `ehr/src/OE/docs/README.md`
- `ehr/src/OE/docs/architecture/` — `overview.md`, `form-system.md`, `state-management.md`, `data-flow.md`
- `ehr/src/OE/docs/components/` — `reusable-components.md`, `form-fields.md`
- `ehr/src/OE/docs/patterns/` — `testing-guide.md` (Jest, mocking, **data-testid conventions**), `naming-conventions.md`

## 4. Cross-cutting conventions

- **Permissions gate every order function** — entering, acknowledging, signing, verifying are all permission-controlled (`order-permissions.md` ⏳); in code see `useCheckAppPermission` / `useCheckAppPermissions` usage in `OE.tsx`.
- **Order state drives appearance and available actions** (`order-states.md`, `order-color-definitions.md` ⏳); in code see `ORDER_STATUS` in `config/` and the `Record` state checks.
- **Unsaved changes are guarded**: switching away from a dirty **Entry** (or **Med Profile**/verification) tab raises `UnsavedDialog` (`OE.tsx`).
- **Order Editor fields vary by order type** — never assume a field exists for a given order type.
- Reference code only by **file path + stable symbol names**, never line numbers.

## 5. Browser-testing / live-app notes

- All browser page testing is done **through the Playwright MCP directly** (AGENTS.md rule) — do not delegate to a browser sub-agent.
- Resolve the module URL and credentials via `skills/ehr-ui/browser-testing/SKILL.md` (login is established **only** through the `Cps` entry).
- Orders are reached **from a patient**: open the patient chart first (`skills/ehr-ui/patient-control/SKILL.md`), then the Orders/Order Entry app.
- Useful stable hooks found in `OE.tsx`: root panel `data-testid="cpoe2-main-panel-id"`, app bar `data-testid="cci-app-bar"`, tab panel `data-testid="cci-app-tab-panel"`. Prefer `data-testid` per `ehr/src/OE/docs/patterns/testing-guide.md`.
- ⏳ No live-environment verification has been recorded for this skill yet — append verified selectors/flows here as they are confirmed.
