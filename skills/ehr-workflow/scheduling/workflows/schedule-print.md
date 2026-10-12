# Schedule Print (components/SchedulePrintDialog.tsx)

> Companion to `skills/ehr-workflow/scheduling/SKILL.md`. Read this file when your task involves **schedule printing**.

- Listens to `Cci.RunTime.event.PRINT_SCHEDULE_CALENDAR` (`SchedulingRoot`'s `useEffect`), collects selected rooms → `setPrintScheduleParams` → opens via `schedulePrintDialogOpenAtom`.