/**
 * Fetch wrapper for the viewer API. When the server is protected by
 * ui.token, every request must present it; this module stores the token in
 * sessionStorage (per-tab, cleared when the tab closes — no cookie, no
 * localStorage persistence) and attaches it as `Authorization: Bearer`.
 * A 401 notifies the app so it can show the token prompt.
 */

const TOKEN_KEY = "aiflow.token";

export function getStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage unavailable (private mode, storage disabled): the
    // token simply is not remembered; the user re-enters it next 401.
  }
}

type UnauthorizedListener = () => void;
const listeners = new Set<UnauthorizedListener>();

/** Subscribe to 401 events (the app shows the token prompt). Returns an unsubscribe. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitUnauthorized(): void {
  for (const listener of [...listeners]) listener();
}

/** fetch with the stored token attached; flags 401s for the token prompt. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getStoredToken();
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) emitUnauthorized();
  return response;
}

/**
 * URL for a plain <a>/download (no header possible): the token rides the
 * query string, which the server accepts (?token=) — the same value the
 * user typed for the page.
 */
export function downloadUrl(path: string): string {
  const token = getStoredToken();
  if (!token) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Operator convenience: a page opened with ?token=<t> (e.g. a shared link
 * on a trusted network) remembers the token for the session.
 */
export function prefillTokenFromUrl(): void {
  try {
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) setStoredToken(token);
  } catch {
    // not a browser location
  }
}
