# Calendar Main Panel (components/CalendarMainPanel.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves the **calendar UI** (the Ext JS wrapper) or the entry callbacks that open other dialogs.

- Mounts the **Ext JS** component via `ref` + `useResizeObserver`: `Ext.create("Ess.view.sched.ent.EnterpriseCalendarMainPanel", {...})`; after selecting a resource/date it fires callbacks:
  - `showEditApptWin(apptInfo)` → opens patient focus (`setPatFocusDiagOpened(true)` + `setPatApptData`), the **entry to clicking an appointment**.
  - `showAddEventWin` / `showEditEventWin` → opens the event dialogs.
  - `showPreferenceCards` → opens the preference-cards dialog.
- Listens for `Cci.RunTime.on("preference-cards-print-preview")`, dedupes cards, hands them to `PreferenceCardBatchPrintHost`.
- Calendar refresh: watches `needUpdateCalendarAtom`, then `extComp.onRefreshCalendarPanel()`.
- ⚠️ This is the **only place interfacing with Ext JS** in the module; mind component mount/destroy timing when changing it.