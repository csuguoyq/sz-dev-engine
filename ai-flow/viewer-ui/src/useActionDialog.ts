import { useCallback, useRef, useState } from "react";

/** Result object passed to the action callback. */
export interface ActionApi {
  /** Record an error message; the dialog stays open and shows it. */
  fail: (message: string) => void;
  /** Mark the action finished successfully: the dialog closes. */
  done: () => void;
}

/**
 * The open/busy/error triple plus the re-entry lock that every run action
 * (create, retry, approve, reject, stop, message, delete) used to keep in
 * its own useState/useRef pairs. `run` wraps an action: it locks against
 * double-confirm, clears the previous error, flips busy, and always
 * unlocks in `finally`. `close` never closes mid-action.
 */
export function useActionDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const openDialog = useCallback(() => {
    setError("");
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    if (!lock.current) setOpen(false);
  }, []);

  /** Stable error setter, for pre-flight validation outside `run`. */
  const fail = useCallback((message: string) => setError(message), []);

  const run = useCallback(async (action: (api: ActionApi) => Promise<void>): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action({ fail: setError, done: () => setOpen(false) });
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }, []);

  return { open, busy, error, fail, openDialog, close, run };
}
