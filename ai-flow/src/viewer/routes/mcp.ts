import http from "node:http";
import { agentBin, findPreset, findPresetByBin } from "../../agents.js";
import { loadConfigSafe } from "../configSafe.js";
import { bodyError, readBody, send } from "../http.js";
import {
  isValidMcpName,
  listMcpScopes,
  mcpDescriptors,
  normalizeSpec,
  removeServer,
  setServerEnabled,
  upsertServer,
  type McpDescriptor,
} from "../../mcp.js";

/**
 * Manage-MCP routes: the operator's CRUD surface for the configured agent's
 * MCP server list. The agent itself never gets these tools (hard rule 4).
 */
/** The shared 400 message for a bad MCP server name (dsh-cordis caps at 32). */
function mcpNameError(format: string): string {
  return format === "dsh-cordis"
    ? "Server name must match [A-Za-z0-9_-]+ and be at most 32 characters (dsh limit)"
    : "Server name must match [A-Za-z0-9_-]+";
}

/** MCP servers for the configured agent, grouped by config scope. */
export function mcpStatus(repoRoot: string): unknown {
  const config = loadConfigSafe(repoRoot);
  const preset = (config.agent ? findPreset(config.agent) : undefined) ?? findPresetByBin(agentBin(config));
  const id = preset?.id ?? config.agent ?? "";
  if (!id) {
    return { agent: null, label: null, supported: false, scopes: [], error: "No agent configured." };
  }
  const scopes = listMcpScopes(id, repoRoot).map((scope) => ({
    scope: scope.scope,
    path: scope.path,
    format: scope.format,
    requiresApproval: scope.requiresApproval,
    verified: scope.verified,
    note: scope.note ?? "",
    servers: scope.servers,
  }));
  return { agent: id, label: preset?.label ?? id, supported: scopes.length > 0, scopes };
}

function resolveDescriptor(repoRoot: string, scope: string): McpDescriptor | null {
  const config = loadConfigSafe(repoRoot);
  const preset = (config.agent ? findPreset(config.agent) : undefined) ?? findPresetByBin(agentBin(config));
  const id = preset?.id ?? config.agent ?? "";
  if (!id) return null;
  return mcpDescriptors(id, repoRoot).find((descriptor) => descriptor.scope === scope) ?? null;
}

export async function mcpUpsert(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  repoRoot: string,
): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch (err) {
    const fail = bodyError(err);
    send(response, fail.status, { error: fail.error });
    return;
  }
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const scope = typeof obj.scope === "string" ? obj.scope : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const rawSpec = obj.spec && typeof obj.spec === "object" ? (obj.spec as Record<string, unknown>) : null;
  const descriptor = resolveDescriptor(repoRoot, scope);
  if (!descriptor) {
    send(response, 400, { error: `No MCP config for scope "${scope}" with the configured agent.` });
    return;
  }
  if (!isValidMcpName(name, descriptor.format)) {
    send(response, 400, { error: mcpNameError(descriptor.format) });
    return;
  }
  if (!rawSpec) {
    send(response, 400, { error: "A spec object is required." });
    return;
  }
  const input = {
    type: typeof rawSpec.type === "string" ? (rawSpec.type as "stdio" | "sse" | "http") : undefined,
    command: typeof rawSpec.command === "string" ? rawSpec.command : undefined,
    args: Array.isArray(rawSpec.args) ? (rawSpec.args as unknown[]).map(String) : undefined,
    env:
      rawSpec.env && typeof rawSpec.env === "object"
        ? (Object.fromEntries(
            Object.entries(rawSpec.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          ) as Record<string, string>)
        : undefined,
    url: typeof rawSpec.url === "string" ? rawSpec.url : undefined,
    enabled: typeof rawSpec.enabled === "boolean" ? rawSpec.enabled : undefined,
  };
  const { spec, error } = normalizeSpec(input);
  if (!spec) {
    send(response, 400, { error });
    return;
  }
  try {
    upsertServer(descriptor, name, spec);
  } catch (err) {
    send(response, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  send(response, 200, { ok: true, name });
}

export function mcpRemove(response: http.ServerResponse, repoRoot: string, name: string, scope: string): void {
  const descriptor = resolveDescriptor(repoRoot, scope);
  if (!descriptor) {
    send(response, 400, { error: `No MCP config for scope "${scope}" with the configured agent.` });
    return;
  }
  if (!isValidMcpName(name, descriptor.format)) {
    send(response, 400, { error: mcpNameError(descriptor.format) });
    return;
  }
  try {
    removeServer(descriptor, name);
  } catch (err) {
    send(response, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  send(response, 200, { ok: true, name });
}

/** Flip a single server's operator on/off switch, preserving its config. */
export async function mcpSetEnabled(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  repoRoot: string,
  name: string,
  scope: string,
): Promise<void> {
  const descriptor = resolveDescriptor(repoRoot, scope);
  if (!descriptor) {
    send(response, 400, { error: `No MCP config for scope "${scope}" with the configured agent.` });
    return;
  }
  if (!isValidMcpName(name, descriptor.format)) {
    send(response, 400, { error: mcpNameError(descriptor.format) });
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch (err) {
    const fail = bodyError(err);
    send(response, fail.status, { error: fail.error });
    return;
  }
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof obj.enabled !== "boolean") {
    send(response, 400, { error: "An `enabled` boolean is required." });
    return;
  }
  try {
    setServerEnabled(descriptor, name, obj.enabled);
  } catch (err) {
    send(response, 404, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  send(response, 200, { ok: true, name, enabled: obj.enabled });
}
