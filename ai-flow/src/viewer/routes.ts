import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { adapterIsGeneric } from "../adapters/index.js";
import { listRuns, readStateOrNull, statePath } from "../store.js";
import type { StartRun } from "./apiTypes.js";
import { loadConfigSafe } from "./configSafe.js";
import { checkCsrf, rejectIfLimited, type RateLimiter } from "./guards.js";
import { docs, send, serveStatic, summary } from "./http.js";
import { agentStatus, listModels } from "./routes/agent.js";
import { mcpRemove, mcpSetEnabled, mcpStatus, mcpUpsert } from "./routes/mcp.js";
import { createRun, deleteRun, messageRun, reviewRun, sendCorrupted, sendFullLog, sendPackage, sendStageLog, stopRun } from "./routes/runs.js";

export type { StartRun };

/**
 * Route dispatcher for the viewer. Handler bodies live in routes/runs.ts
 * (run lifecycle), routes/agent.ts (agent probes) and routes/mcp.ts
 * (Manage MCP); this file only maps URLs to them and applies the shared
 * guards (rate limit, CSRF, token auth) before any handler runs.
 */
export async function handleRoutes(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  repoRoot: string,
  runsRoot: string,
  host: string,
  port: number,
  startRun: StartRun,
  staticRoot: string,
  limiter: RateLimiter,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const method = request.method ?? "GET";

  // Per-client rate ceiling first: even rejected requests count, so a
  // wedged client cannot hammer the auth check or route table.
  if (rejectIfLimited(limiter, request, response)) return;
  // Cross-origin mutating requests are rejected before any handler runs
  // (no-Origin requests — curl, the CLI — are allowed; see checkCsrf).
  if (!checkCsrf(request, response)) {
    send(response, 403, { error: "Cross-origin request rejected" });
    return;
  }

  // Optional viewer authentication. When ui.token is configured, every request
  // must present it (Authorization: Bearer <token>, or ?token=<token>); an
  // exposed viewer (ui.host on a LAN) must not be drivable by anyone. The
  // check runs before any route, so static assets are protected too. When the
  // token is unset (default), the viewer is open like before.
  const authConfig = loadConfigSafe(repoRoot);
  const expectedToken = authConfig.ui?.token;
  if (expectedToken) {
    const provided =
      request.headers["authorization"]?.startsWith("Bearer ")
        ? request.headers["authorization"].slice(7).trim()
        : url.searchParams.get("token");
    // Constant-time compare: a plain !== leaks how many leading characters
    // match (a timing oracle on an exposed viewer). Both sides are hashed to
    // equal length first so timingSafeEqual is well-defined.
    if (!tokenMatches(provided, expectedToken)) {
      send(response, 401, { error: "Unauthorized" });
      return;
    }
  }

  if (url.pathname === "/api/runs" && method === "GET") {
    send(response, 200, { runs: listRuns(runsRoot).map(summary) });
    return;
  }

  if (url.pathname === "/api/runs" && method === "POST") {
    await createRun(request, response, repoRoot, runsRoot, startRun);
    return;
  }

  const reviewMatch = /^\/api\/runs\/(SZ\d+)\/review$/.exec(url.pathname);
  if (reviewMatch?.[1] && method === "POST") {
    await reviewRun(request, response, repoRoot, runsRoot, reviewMatch[1], startRun);
    return;
  }

  const packageMatch = /^\/api\/runs\/(SZ\d+)\/package$/.exec(url.pathname);
  if (packageMatch?.[1] && method === "GET") {
    sendPackage(response, runsRoot, packageMatch[1]);
    return;
  }

  if (url.pathname === "/api/agent-status" && method === "GET") {
    send(response, 200, await agentStatus(repoRoot, url.searchParams.get("dir") ?? ""));
    return;
  }

  if (url.pathname === "/api/models" && method === "GET") {
    send(response, 200, await listModels(repoRoot));
    return;
  }

  if (url.pathname === "/api/mcp" && method === "GET") {
    send(response, 200, mcpStatus(repoRoot));
    return;
  }

  if (url.pathname === "/api/mcp" && method === "POST") {
    await mcpUpsert(request, response, repoRoot);
    return;
  }

  const mcpDelete = /^\/api\/mcp\/(.+)$/.exec(url.pathname);
  if (mcpDelete?.[1]) {
    if (method === "DELETE") {
      mcpRemove(response, repoRoot, mcpDelete[1], url.searchParams.get("scope") ?? "");
      return;
    }
    if (method === "PATCH") {
      await mcpSetEnabled(request, response, repoRoot, mcpDelete[1], url.searchParams.get("scope") ?? "");
      return;
    }
  }

  const logMatch = /^\/api\/runs\/(SZ\d+)\/logs\/([a-z0-9_-]+)$/.exec(url.pathname);
  if (logMatch?.[1] && logMatch[2] && method === "GET") {
    sendStageLog(response, repoRoot, runsRoot, logMatch[1], logMatch[2], url.searchParams.has("raw"));
    return;
  }

  const fullLogMatch = /^\/api\/runs\/(SZ\d+)\/full-log$/.exec(url.pathname);
  if (fullLogMatch?.[1] && method === "GET") {
    await sendFullLog(response, runsRoot, fullLogMatch[1]);
    return;
  }

  const deleteMatch = /^\/api\/runs\/(SZ\d+)$/.exec(url.pathname);
  if (deleteMatch?.[1] && method === "DELETE") {
    await deleteRun(response, repoRoot, runsRoot, deleteMatch[1]);
    return;
  }

  const stopMatch = /^\/api\/runs\/(SZ\d+)\/stop$/.exec(url.pathname);
  if (stopMatch?.[1] && method === "POST") {
    await stopRun(response, repoRoot, runsRoot, stopMatch[1]);
    return;
  }

  const messageMatch = /^\/api\/runs\/(SZ\d+)\/message$/.exec(url.pathname);
  if (messageMatch?.[1] && method === "POST") {
    await messageRun(request, response, repoRoot, runsRoot, messageMatch[1], startRun);
    return;
  }

  const match = /^\/api\/runs\/(SZ\d+)$/.exec(url.pathname);
  if (match?.[1] && method === "GET") {
    const runDir = path.join(runsRoot, match[1]);
    if (!fs.existsSync(statePath(runDir))) {
      send(response, 404, { error: "Run not found" });
      return;
    }
    const state = readStateOrNull(runDir);
    if (!state) {
      sendCorrupted(response, match[1]);
      return;
    }
    send(response, 200, { state, docs: docs(state), genericPack: adapterIsGeneric(state.szdev?.pack) });
    return;
  }

  if (method === "GET") {
    if (serveStatic(response, staticRoot, url.pathname)) return;
    send(response, 404, { error: "Not found" });
    return;
  }

  if (method !== "POST") {
    send(response, 405, { error: "Method not allowed" });
    return;
  }
  send(response, 404, { error: "Not found" });
}

/**
 * Constant-time token match. Hashing both sides to sha256 first makes the
 * inputs equal-length and hides the raw token from the comparison, so
 * timingSafeEqual runs in constant time regardless of how much of the token
 * the caller guessed. A missing/empty provided token is a fast reject (there
 * is no secret to leak — the expected token is only ever compared to its own
 * length-stable digest).
 */
function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
