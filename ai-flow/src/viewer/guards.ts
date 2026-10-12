import http from "node:http";
import { send } from "./http.js";

/**
 * Two cheap network-level guards for the viewer, applied in handleRoutes
 * before any route handler runs. Both are off by default in effect (no
 * config = permissive), and both fail closed on a violation.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF guard for mutating requests. A browser only sends an `Origin` header
 * on cross-origin requests, so:
 *  - no Origin header → not a cross-origin browser request (curl, the CLI,
 *    a same-origin XHR in some browsers, or a same-origin form) → allowed;
 *  - Origin present and its host:port equals the request's Host → same-origin
 *    UI → allowed;
 *  - Origin present and different → a page on another origin is driving the
 *    viewer (drive-by form/JS from a LAN page) → 403.
 *
 * The comparison is on host:port; the Origin's protocol must be http/https
 * (checked explicitly — a non-web Origin that happens to name the same
 * host:port is rejected). The viewer serves both its UI and its API from one
 * origin; a token (ui.token) is the stronger protection when the viewer is
 * exposed, and this guard stops the unauthenticated same-LAN drive-by case.
 */
export function checkCsrf(request: http.IncomingMessage, response: http.ServerResponse): boolean {
  const method = request.method ?? "GET";
  if (!MUTATING_METHODS.has(method)) return true;
  const origin = request.headers["origin"];
  if (!origin) return true;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false; // an Origin we cannot parse is not ours
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
  const requestHost = request.headers["host"];
  if (!requestHost) return false;
  // Compare host and port separately: URL.host ("name:port") would never
  // equal the port-stripped Host header, and the origin's port is implicit
  // when default (80/443) — as is the Host header's.
  const defaultPort = originUrl.protocol === "https:" ? 443 : 80;
  const originPort = originUrl.port === "" ? defaultPort : Number(originUrl.port);
  let reqHost = requestHost;
  let reqPort: number;
  const colon = reqHost.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(reqHost.slice(colon + 1))) {
    reqPort = Number(reqHost.slice(colon + 1));
    reqHost = reqHost.slice(0, colon);
  } else {
    reqPort = defaultPort;
  }
  if (reqHost !== originUrl.hostname || reqPort !== originPort) return false;
  return true;
}

/**
 * Sliding-window per-client rate limit. Counts each client's requests in a
 * trailing 60s window; a client over the ceiling gets 429 until the window
 * drains. Keyed by the socket's remote address. A small in-memory map is
 * cleaned on each check so idle clients do not accumulate forever.
 */
export class RateLimiter {
  private readonly windowMs = 60_000;
  private readonly hits = new Map<string, number[]>();
  /** Last idle-client sweep; the sweep also runs on a time basis so a quiet
   *  server (few clients, never over 1024) does not keep idle entries forever. */
  private lastSweep = Date.now();

  constructor(private readonly perMinute: number) {}

  /** Returns true when the request is allowed, false when over the limit. */
  allow(client: string): boolean {
    if (this.perMinute <= 0) return true;
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(client) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.perMinute) {
      this.hits.set(client, list);
      return false;
    }
    list.push(now);
    this.hits.set(client, list);
    // Opportunistic GC of idle clients so the map stays bounded: on a size
    // spike OR every 10s of a live server (whichever comes first).
    if (this.hits.size > 1024 || now - this.lastSweep >= 10_000) {
      this.lastSweep = now;
      for (const [key, times] of this.hits) {
        if (times.every((t) => t <= cutoff)) this.hits.delete(key);
      }
    }
    return true;
  }
}

export function clientAddress(request: http.IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

/**
 * Wire the rate limiter into a response: sends 429 and returns true when the
 * client is over the limit (the caller should then return immediately).
 */
export function rejectIfLimited(limiter: RateLimiter, request: http.IncomingMessage, response: http.ServerResponse): boolean {
  const client = clientAddress(request);
  if (limiter.allow(client)) return false;
  send(response, 429, { error: "Too many requests; slow down" });
  return true;
}
