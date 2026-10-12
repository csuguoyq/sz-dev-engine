import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import { readJsonObject } from "./jsonFile.js";

export type McpScope = "user" | "project";
export type McpServerType = "stdio" | "sse" | "http";

/**
 * Each agent stores its MCP servers differently. `generic` is the common
 * JSON `mcpServers` shape (Cursor, Claude Code). `opencode-v2` is OpenCode's
 * current nested `mcp.servers` with `type: local|remote` and the command as an
 * array. `codex-toml` is Codex (chatgpt preset) which keeps `[mcp_servers]` in
 * a TOML `config.toml`. `dsh-cordis` is DeepSeek Harness (dsh), whose MCP
 * servers are cordis-plugin inserts (`@deepseek-ai/dsh-mcp-client`) inside a
 * profile's `cordis.patch.yml`. `zcode` is ZCode (z.ai): JSON config with a
 * top-level `mcp.servers` map; stdio uses command/args + env as a
 * [{name,value}] array, remote uses type:http|sse + url + headers array.
 */
export type McpFormat = "generic" | "opencode-v2" | "codex-toml" | "dsh-cordis" | "zcode";

export interface McpServerSpec {
  type: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** Operator on/off switch. Undefined or true means enabled; false writes the
   * agent's native `disabled` flag so the server is present but inert. */
  enabled?: boolean;
}

export interface McpServerEntry extends McpServerSpec {
  name: string;
}

export interface McpDescriptor {
  path: string;
  format: McpFormat;
  scope: McpScope;
  /** True when the agent keeps this file's servers disabled until an in-agent approval step. */
  requiresApproval: boolean;
  /** True when the path/schema is confirmed for the real agent; false is a best-effort guess. */
  verified: boolean;
  note?: string;
}

export interface McpScopeView extends McpDescriptor {
  servers: McpServerEntry[];
}

function homeDir(): string {
  return os.homedir();
}

/**
 * Where each agent keeps its MCP server list, resolved against the operator's
 * home (user scope) and the repository root (project scope). All of this is
 * operator-facing tooling: the human edits these files through the viewer, the
 * agent only *consumes* the resulting servers. The agent never writes or
 * approves MCP config itself.
 */
export function mcpDescriptors(presetId: string, repoRoot: string): McpDescriptor[] {
  const id = presetId.trim().toLowerCase();
  switch (id) {
    case "cursor":
      return [
        {
          path: path.join(homeDir(), ".cursor", "mcp.json"),
          format: "generic",
          scope: "user",
          requiresApproval: false,
          verified: true,
          note: "Cursor global MCP config (~/.cursor/mcp.json, mcpServers). Loaded automatically.",
        },
      ];
    case "claude":
      return [
        {
          path: path.join(homeDir(), ".claude.json"),
          format: "generic",
          scope: "user",
          requiresApproval: false,
          verified: true,
          note: "Claude Code user config (~/.claude.json, mcpServers). Loaded automatically for every session.",
        },
        {
          path: path.join(repoRoot, ".mcp.json"),
          format: "generic",
          scope: "project",
          requiresApproval: true,
          verified: true,
          note: "Project .mcp.json (mcpServers). Claude Code keeps these disabled until you approve them in-agent (run /mcp).",
        },
      ];
    case "opencode":
      return [
        {
          path: path.join(homeDir(), ".config", "opencode", "opencode.json"),
          format: "opencode-v2",
          scope: "user",
          requiresApproval: false,
          verified: true,
          note: "OpenCode global config (~/.config/opencode/opencode.json). Servers go under mcp.servers; stdio uses type:local with a command array, remote uses type:remote with a url.",
        },
        {
          path: path.join(repoRoot, "opencode.json"),
          format: "opencode-v2",
          scope: "project",
          requiresApproval: false,
          verified: true,
          note: "OpenCode project config (opencode.json at the repo root). Same mcp.servers schema as the global file.",
        },
      ];
    case "chatgpt":
      return [
        {
          path: path.join(homeDir(), ".codex", "config.toml"),
          format: "codex-toml",
          scope: "user",
          requiresApproval: false,
          verified: true,
          note: "Codex (OpenAI) config (~/.codex/config.toml). Servers go under [mcp_servers]; stdio uses command+args+env, remote uses url. TOML format.",
        },
        {
          path: path.join(repoRoot, ".codex", "config.toml"),
          format: "codex-toml",
          scope: "project",
          requiresApproval: false,
          verified: true,
          note: "Codex project config (.codex/config.toml at the repo root). Same [mcp_servers] TOML schema.",
        },
      ];
    case "deepseek":
      // DeepSeek Harness (dsh). The ai-flow preset runs `dsh --profile headless`,
      // so MCP servers live in that profile's patch layer. They are cordis-plugin
      // inserts (`@deepseek-ai/dsh-mcp-client`) and hot-reload via DSH HMR.
      return [
        {
          path: path.join(homeDir(), ".dsh", "profiles", "headless", "cordis.patch.yml"),
          format: "dsh-cordis",
          scope: "user",
          requiresApproval: false,
          verified: true,
          note: "DeepSeek Harness (dsh) headless profile. MCP servers are cordis-plugin inserts (name '@deepseek-ai/dsh-mcp-client') in cordis.patch.yml; stdio uses command/args/env, remote uses url. The dsh client supports only stdio and streamable-http, so sse and http servers are both stored as streamable-http. Edits hot-reload via DSH HMR — no restart needed. serverName must match [A-Za-z0-9_-]{1,32}.",
        },
      ];
    case "zcode":
      // ZCode (z.ai). Verified against the running zcode-server source:
      // ZCODE_MCP_DESCRIPTOR -> ~/.zcode/cli/config.json (user) and
      // <repo>/.zcode/config.json (workspace), top-level key `mcp.servers`.
      // Each server is strict; stdio uses command/args + env as a [{name,value}]
      // array, remote uses type:http|sse + url + headers as a [{name,value}] array.
      return [
        {
          path: path.join(homeDir(), ".zcode", "cli", "config.json"),
          format: "zcode",
          scope: "user",
          requiresApproval: false,
          verified: true,
          note: "ZCode user config (~/.zcode/cli/config.json, mcp.servers). stdio uses command/args + env (array of {name,value}); remote uses type:http|sse + url + headers (array). Loaded automatically; user scope wins over project on name clash.",
        },
        {
          path: path.join(repoRoot, ".zcode", "config.json"),
          format: "zcode",
          scope: "project",
          requiresApproval: false,
          verified: true,
          note: "ZCode project config (<repo>/.zcode/config.json, mcp.servers). Same schema as the user file. Both scopes are loaded; a project server with the same name as a user one is shadowed by the user's.",
        },
      ];
    default:
      return [];
  }
}



/**
 * Write `content` to `file` atomically: temp file in the same directory,
 * then rename. A viewer crash mid-write must not leave a truncated MCP
 * config behind — a corrupted config breaks the agent itself (unlike a
 * corrupted state.json, which ai-flow can rebuild). The existing file's
 * permission bits are preserved on the temp file before the rename.
 */
function writeFileAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : undefined;
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function writeJson(file: string, obj: Record<string, unknown>): void {
  writeFileAtomic(file, JSON.stringify(obj, null, 2) + "\n");
}

function readToml(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = parseToml(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeToml(file: string, obj: Record<string, unknown>): void {
  writeFileAtomic(file, stringifyToml(obj));
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item));
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = String(v);
  }
  return out;
}

function readRawFile(descriptor: McpDescriptor): Record<string, unknown> {
  return descriptor.format === "codex-toml" ? readToml(descriptor.path) : readJsonObject(descriptor.path);
}

function writeRawFile(descriptor: McpDescriptor, obj: Record<string, unknown>): void {
  if (descriptor.format === "codex-toml") writeToml(descriptor.path, obj);
  else writeJson(descriptor.path, obj);
}

/** Return the mutable servers map inside a parsed config, creating parents as needed. */
function serversContainer(obj: Record<string, unknown>, format: McpFormat): Record<string, unknown> {
  if (format === "opencode-v2" || format === "zcode") {
    let mcp = obj.mcp;
    if (!mcp || typeof mcp !== "object") {
      mcp = {};
      obj.mcp = mcp;
    }
    const mcpObj = mcp as Record<string, unknown>;
    let servers = mcpObj.servers;
    if (!servers || typeof servers !== "object") {
      servers = {};
      mcpObj.servers = servers;
    }
    return servers as Record<string, unknown>;
  }
  const key = format === "codex-toml" ? "mcp_servers" : "mcpServers";
  let container = obj[key];
  if (!container || typeof container !== "object") {
    container = {};
    obj[key] = container;
  }
  return container as Record<string, unknown>;
}

/** Read the servers map as a plain name->raw object, tolerant of alternate keys. */
function readMap(obj: Record<string, unknown>, format: McpFormat): Record<string, unknown> {
  if (format === "opencode-v2" || format === "zcode") {
    const mcp = obj.mcp && typeof obj.mcp === "object" ? (obj.mcp as Record<string, unknown>) : {};
    const servers =
      mcp.servers && typeof mcp.servers === "object"
        ? (mcp.servers as Record<string, unknown>)
        : mcp; // OpenCode v1 kept servers directly under mcp.
    return servers as Record<string, unknown>;
  }
  if (format === "codex-toml") {
    const a = obj.mcp_servers && typeof obj.mcp_servers === "object" ? (obj.mcp_servers as Record<string, unknown>) : {};
    return a;
  }
  // generic: prefer mcpServers, fall back to the alternate mcp key.
  const a = obj.mcpServers && typeof obj.mcpServers === "object" ? (obj.mcpServers as Record<string, unknown>) : {};
  const b = obj.mcp && typeof obj.mcp === "object" ? (obj.mcp as Record<string, unknown>) : {};
  return { ...b, ...a };
}

function fromOpencode(name: string, raw: unknown): McpServerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type === "remote" || (typeof r.url === "string" && r.type !== "local")) {
    return { name, type: "http", url: typeof r.url === "string" ? r.url : undefined };
  }
  const cmd = Array.isArray(r.command)
    ? (r.command as unknown[]).map(String)
    : typeof r.command === "string"
      ? [r.command]
      : [];
  return {
    name,
    type: "stdio",
    command: typeof cmd[0] === "string" ? cmd[0] : "",
    args: cmd.slice(1),
    env: asStringRecord(r.environment),
    enabled: r.disabled !== true,
  };
}

function fromCodex(name: string, raw: unknown): McpServerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type: McpServerType = r.type === "http" || r.type === "sse" ? r.type : typeof r.url === "string" ? "http" : "stdio";
  if (type !== "stdio") {
    return { name, type, url: typeof r.url === "string" ? r.url : undefined, enabled: r.disabled !== true };
  }
  return {
    name,
    type: "stdio",
    command: typeof r.command === "string" ? r.command : "",
    args: asStringArray(r.args),
    env: asStringRecord(r.env),
    enabled: r.disabled !== true,
  };
}

function fromGeneric(name: string, raw: unknown): McpServerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const type: McpServerType = s.type === "sse" || s.type === "http" ? s.type : "stdio";
  return {
    name,
    type,
    command: typeof s.command === "string" ? s.command : undefined,
    args: asStringArray(s.args),
    env: asStringRecord(s.env),
    url: typeof s.url === "string" ? s.url : undefined,
    enabled: s.disabled !== true,
  };
}

/** ZCode keeps env/headers as a [{name,value}] array rather than an object. */
function envArrayToRecord(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const item of value) {
      if (item && typeof item === "object") {
        const e = item as Record<string, unknown>;
        if (typeof e.name === "string" && typeof e.value === "string") out[e.name] = e.value;
      }
    }
    return out;
  }
  return asStringRecord(value) ?? {};
}

/** Inverse of envArrayToRecord: a Record becomes ZCode's [{name,value}] array. */
function envRecordToArray(record: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(record).map(([name, value]) => ({ name, value: String(value) }));
}

function fromZcode(name: string, raw: unknown): McpServerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // zcode writes `enabled: false` for servers switched off in its own UI;
  // honor that in addition to the generic `disabled: true` marker.
  const enabled = r.disabled !== true && r.enabled !== false;
  const type: McpServerType = r.type === "http" || r.type === "sse" ? r.type : typeof r.url === "string" ? "http" : "stdio";
  if (type !== "stdio") {
    return { name, type, url: typeof r.url === "string" ? r.url : undefined, enabled };
  }
  return {
    name,
    type: "stdio",
    command: typeof r.command === "string" ? r.command : "",
    args: asStringArray(r.args),
    env: envArrayToRecord(r.env),
    enabled,
  };
}

export function readServers(descriptor: McpDescriptor): McpServerEntry[] {
  if (descriptor.format === "dsh-cordis") return readDshServers(descriptor.path);
  const map = readMap(readRawFile(descriptor), descriptor.format);
  const entries: McpServerEntry[] = [];
  for (const [name, raw] of Object.entries(map)) {
    const entry =
      descriptor.format === "opencode-v2"
        ? fromOpencode(name, raw)
        : descriptor.format === "codex-toml"
          ? fromCodex(name, raw)
          : descriptor.format === "zcode"
            ? fromZcode(name, raw)
            : fromGeneric(name, raw);
    if (entry) entries.push(entry);
  }
  entries.sort((x, y) => x.name.localeCompare(y.name));
  return entries;
}

/* ------------------------------------------------------------------ */
/* DeepSeek Harness (dsh): cordis-plugin inserts in cordis.patch.yml.  */
/* ------------------------------------------------------------------ */

const DSH_MCP_CLIENT = "@deepseek-ai/dsh-mcp-client";

function yamlToJs(node: unknown): unknown {
  if (node == null) return undefined;
  if (typeof (node as { toJSON?: () => unknown }).toJSON === "function") {
    return (node as { toJSON: () => unknown }).toJSON();
  }
  return node;
}

/** A cordis-plugin insert that registers one MCP server. */
function isDshMcpMap(map: unknown): map is YAMLMap {
  return isMap(map) && map.get("name") === DSH_MCP_CLIENT;
}

function dshServerName(map: YAMLMap): string {
  const config = map.get("config");
  if (isMap(config) && typeof config.get("serverName") === "string") return config.get("serverName") as string;
  return typeof map.get("id") === "string" ? (map.get("id") as string) : "";
}

function readDshServers(file: string): McpServerEntry[] {
  if (!fs.existsSync(file)) return [];
  let doc;
  try {
    doc = parseDocument(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const root = doc.contents;
  if (!isSeq(root)) return [];
  const entries: McpServerEntry[] = [];
  const visit = (map: YAMLMap): void => {
    if (!isDshMcpMap(map)) return;
    const config = map.get("config");
    if (!isMap(config)) return;
    const name = dshServerName(map);
    if (!name) return;
    const transport = config.get("transport");
    const type: McpServerType = transport === "streamable-http" ? "http" : transport === "sse" ? "sse" : "stdio";
    if (type === "stdio") {
      entries.push({
        name,
        type: "stdio",
        command: typeof config.get("command") === "string" ? (config.get("command") as string) : "",
        args: asStringArray(yamlToJs(config.get("args"))),
        env: asStringRecord(yamlToJs(config.get("env"))),
        enabled: config.get("disabled") !== true,
      });
    } else {
      entries.push({
        name,
        type,
        url: typeof config.get("url") === "string" ? (config.get("url") as string) : undefined,
        enabled: config.get("disabled") !== true,
      });
    }
  };
  for (const item of root.items) {
    if (isMap(item)) {
      visit(item);
      const insert = item.get("insert");
      if (isSeq(insert)) for (const child of insert.items) if (isMap(child)) visit(child);
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/** Find an existing dsh MCP insert by serverName, returning its parent seq + index. */
function findDshMcp(root: YAMLSeq, name: string): { parent: YAMLSeq; index: number } | null {
  const check = (map: YAMLMap, parent: YAMLSeq, index: number): { parent: YAMLSeq; index: number } | null => {
    if (isDshMcpMap(map) && dshServerName(map) === name) return { parent, index };
    return null;
  };
  for (let i = 0; i < root.items.length; i++) {
    const item = root.items[i];
    if (isMap(item)) {
      const hit = check(item, root, i);
      if (hit) return hit;
      const insert = item.get("insert");
      if (isSeq(insert)) {
        for (let j = 0; j < insert.items.length; j++) {
          const hit = check(insert.items[j] as YAMLMap, insert, j);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

function buildDshConfig(spec: McpServerSpec, existingConfig: Record<string, unknown> | null, name: string): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...(existingConfig ?? {}) };
  cfg.serverName = name;
  if (spec.type === "http" || spec.type === "sse") {
    cfg.transport = "streamable-http";
    cfg.url = spec.url;
    delete cfg.command;
    delete cfg.args;
    delete cfg.env;
    delete cfg.cwd;
  } else {
    cfg.transport = "stdio";
    cfg.command = spec.command;
    cfg.args = spec.args ?? [];
    cfg.env = spec.env ?? {};
    delete cfg.url;
  }
  // Reflect the operator's on/off switch into the plugin config's `disabled`.
  if (spec.enabled === false) cfg.disabled = true;
  else delete cfg.disabled;
  return cfg;
}

function upsertDshServer(descriptor: McpDescriptor, name: string, spec: McpServerSpec): void {
  const file = descriptor.path;
  let doc;
  if (fs.existsSync(file)) {
    try {
      doc = parseDocument(fs.readFileSync(file, "utf8"));
    } catch {
      doc = parseDocument("[]");
    }
  } else {
    doc = parseDocument("[]");
  }
  // A dsh patch file is a top-level sequence; a file that is not one is
  // treated like a missing file and replaced with an empty list.
  if (!isSeq(doc.contents)) doc = parseDocument("[]");
  const contents = doc.contents;
  if (!isSeq(contents)) throw new Error("unreachable: a fresh \"[]\" parse is a sequence");
  // Plain (non-parsed) seq type: nodes made with doc.createNode are not
  // range-stamped, and a plain YAMLSeq accepts them in .add()/.items.
  const root: YAMLSeq = contents;
  const hit = findDshMcp(root, name);
  const existingConfig = hit ? (yamlToJs((hit.parent.items[hit.index] as YAMLMap).get("config")) as Record<string, unknown> | null) : null;
  const existingId = hit ? ((hit.parent.items[hit.index] as YAMLMap).get("id") as string | undefined) : undefined;
  const cfg = buildDshConfig(spec, existingConfig, name);
  const id = existingId && typeof existingId === "string" && existingId ? existingId : `mcp-${name}`;
  const newNode = doc.createNode({ id, name: DSH_MCP_CLIENT, config: cfg });
  if (hit) {
    hit.parent.items[hit.index] = newNode;
  } else {
    let insertSeq: YAMLSeq | null = null;
    for (const item of root.items) {
      if (isMap(item)) {
        const ins = item.get("insert");
        if (isSeq(ins)) {
          insertSeq = ins as YAMLSeq;
          break;
        }
      }
    }
    if (!insertSeq) {
      const created = doc.createNode({ insert: [] });
      if (!isMap(created)) throw new Error("unreachable: createNode({}) is a map");
      root.add(created);
      const inner = created.get("insert", true);
      if (!isSeq(inner)) throw new Error("unreachable: the insert node is a sequence");
      insertSeq = inner;
    }
    insertSeq.add(newNode);
  }
  writeFileAtomic(file, doc.toString());
}

function removeDshServer(descriptor: McpDescriptor, name: string): void {
  const file = descriptor.path;
  if (!fs.existsSync(file)) return;
  let doc;
  try {
    doc = parseDocument(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const root = doc.contents;
  if (!isSeq(root)) return;
  const hit = findDshMcp(root, name);
  if (hit) {
    hit.parent.delete(hit.index);
    writeFileAtomic(file, doc.toString());
  }
}

/** Build the stored server object: start from the existing entry (so the
 * agent's own fields like headers/cwd/disabled/oauth survive) and override the
 * fields this transport manages, deleting the opposite transport's fields. */
function applyDisabled(out: Record<string, unknown>, enabled?: boolean): void {
  if (enabled === false) out.disabled = true;
  else delete out.disabled;
}

function buildStored(format: McpFormat, name: string, spec: McpServerSpec, existing: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(existing ?? {}) };

  if (format === "opencode-v2") {
    if (spec.type === "http") {
      out.type = "remote";
      out.url = spec.url;
      delete out.command;
      delete out.args;
      delete out.environment;
    } else {
      out.type = "local";
      out.command = [spec.command, ...(spec.args ?? [])].filter(Boolean);
      out.environment = spec.env ?? {};
      delete out.url;
    }
    applyDisabled(out, spec.enabled);
    return out;
  }

  if (format === "codex-toml") {
    if (spec.type === "http") {
      out.type = "http";
      out.url = spec.url;
      delete out.command;
      delete out.args;
      delete out.env;
    } else {
      out.command = spec.command;
      out.args = spec.args ?? [];
      out.env = spec.env ?? {};
      delete out.url;
      delete out.type;
    }
    applyDisabled(out, spec.enabled);
    return out;
  }

  if (format === "zcode") {
    out.name = name;
    if (spec.type === "http" || spec.type === "sse") {
      out.type = spec.type;
      out.url = spec.url;
      delete out.command;
      delete out.args;
      delete out.env;
      // Keep existing headers/oauth/isolation/timeoutMs/protocolVersion.
    } else {
      delete out.type;
      delete out.url;
      delete out.headers;
      out.command = spec.command;
      out.args = spec.args ?? [];
      out.env = envRecordToArray(spec.env ?? {});
    }
    // zcode's native switch is `enabled`; keep it in sync with the toggle
    // so a server re-enabled here is not still disabled by a stale field.
    if (spec.enabled === false) out.enabled = false;
    else delete out.enabled;
    applyDisabled(out, spec.enabled);
    return out;
  }

  out.type = spec.type;
  if (spec.type === "http") {
    out.url = spec.url;
    delete out.command;
    delete out.args;
    delete out.env;
  } else {
    if (spec.command !== undefined) out.command = spec.command;
    if (spec.args !== undefined) out.args = spec.args;
    if (spec.env !== undefined) out.env = spec.env;
    delete out.url;
  }
  applyDisabled(out, spec.enabled);
  return out;
}

export function normalizeSpec(input: {
  type?: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}): { spec?: McpServerSpec; error?: string } {
  const type: McpServerType = input.type === "sse" || input.type === "http" ? input.type : "stdio";
  if (type === "stdio") {
    if (!input.command?.trim()) return { error: "stdio servers require a command" };
    const spec: McpServerSpec = { type, command: input.command.trim() };
    if (input.args && input.args.length > 0) spec.args = input.args;
    if (input.env && Object.keys(input.env).length > 0) spec.env = input.env;
    if (input.enabled !== undefined) spec.enabled = input.enabled;
    return { spec };
  }
  if (!input.url?.trim()) return { error: "sse/http servers require a url" };
  const urlSpec: McpServerSpec = { type, url: input.url.trim() };
  if (input.enabled !== undefined) urlSpec.enabled = input.enabled;
  return { spec: urlSpec };
}

/**
 * Generic-format files may keep servers under the alternate `mcp` key
 * (`readMap` merges it with `mcpServers` for reads). Canonicalize on first
 * write: move legacy entries into the `mcpServers` container (canonical wins
 * a name clash) and drop the legacy key, so reads and writes agree on where
 * each server lives and a server is never left "ghosted" under `mcp` where
 * upsert/remove cannot reach it.
 */
function migrateGenericLegacy(obj: Record<string, unknown>, container: Record<string, unknown>): void {
  const legacy = obj.mcp;
  if (!legacy || typeof legacy !== "object") return;
  if (legacy === container) return;
  for (const [key, value] of Object.entries(legacy as Record<string, unknown>)) {
    if (!(key in container)) container[key] = value;
  }
  delete obj.mcp;
}

/**
 * Refuse to write a config file that exists but cannot be parsed. The lenient
 * readers (readJson/readToml/readDshServers) return an empty view for a
 * corrupted file, so a subsequent upsert would silently overwrite it with only
 * the edited server and destroy the user's remaining configuration. Mirrors
 * applyZcodeModel's "leave an unparsable file alone" policy. An empty (or
 * missing) file is fine — that is a create.
 */
function assertRawFileHealthy(descriptor: McpDescriptor): void {
  const file = descriptor.path;
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return;
  if (descriptor.format === "dsh-cordis") {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
      throw new Error(
        `Cannot edit ${file}: the YAML has parse errors (${doc.errors[0]?.message ?? "unknown"}). ` +
          `ai-flow refuses to overwrite a config it cannot parse; fix or remove the file first.`,
      );
    }
    return;
  }
  const label = descriptor.format === "codex-toml" ? "TOML" : "JSON";
  try {
    if (descriptor.format === "codex-toml") parseToml(text);
    else JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Cannot edit ${file}: the file is not valid ${label} (${err instanceof Error ? err.message : String(err)}). ` +
        `ai-flow refuses to overwrite a config it cannot parse; fix or remove the file first.`,
    );
  }
}

export function upsertServer(descriptor: McpDescriptor, name: string, spec: McpServerSpec): void {
  assertRawFileHealthy(descriptor);
  if (descriptor.format === "dsh-cordis") {
    upsertDshServer(descriptor, name, spec);
    return;
  }
  const obj = readRawFile(descriptor);
  const container = serversContainer(obj, descriptor.format);
  if (descriptor.format === "generic") migrateGenericLegacy(obj, container);
  const existing =
    container[name] && typeof container[name] === "object" ? (container[name] as Record<string, unknown>) : null;
  container[name] = buildStored(descriptor.format, name, spec, existing);
  // Migrate OpenCode v1 (servers directly under mcp) into mcp.servers.
  if (descriptor.format === "opencode-v2") {
    const mcpObj = obj.mcp && typeof obj.mcp === "object" ? (obj.mcp as Record<string, unknown>) : {};
    for (const k of Object.keys(mcpObj)) {
      if (k !== "servers" && k in container) delete mcpObj[k];
    }
  }
  writeRawFile(descriptor, obj);
}

export function removeServer(descriptor: McpDescriptor, name: string): void {
  assertRawFileHealthy(descriptor);
  if (descriptor.format === "dsh-cordis") {
    removeDshServer(descriptor, name);
    return;
  }
  const obj = readRawFile(descriptor);
  const container = serversContainer(obj, descriptor.format);
  // Generic: also canonicalize the legacy `mcp` key so removing a server
  // that only lives under `mcp` actually takes it away.
  if (descriptor.format === "generic") migrateGenericLegacy(obj, container);
  delete container[name];
  writeRawFile(descriptor, obj);
}

/** Convert a read-back entry into a storable spec, preserving every field the
 * transports manage so a re-save (e.g. a toggle) never drops command/env/url. */
export function entryToSpec(entry: McpServerEntry): McpServerSpec {
  const spec: McpServerSpec = { type: entry.type };
  if (entry.command !== undefined) spec.command = entry.command;
  if (entry.args !== undefined) spec.args = entry.args;
  if (entry.env !== undefined) spec.env = entry.env;
  if (entry.url !== undefined) spec.url = entry.url;
  if (entry.enabled !== undefined) spec.enabled = entry.enabled;
  return spec;
}

/** Flip a single server's operator on/off switch, keeping the rest of its
 * config intact. Throws if the server does not exist in the descriptor file. */
export function setServerEnabled(descriptor: McpDescriptor, name: string, enabled: boolean): void {
  const existing = readServers(descriptor).find((server) => server.name === name);
  if (!existing) throw new Error(`MCP server "${name}" not found in ${descriptor.path}`);
  upsertServer(descriptor, name, { ...entryToSpec(existing), enabled });
}

export function listMcpScopes(presetId: string, repoRoot: string): McpScopeView[] {
  return mcpDescriptors(presetId, repoRoot).map((descriptor) => ({
    ...descriptor,
    servers: readServers(descriptor),
  }));
}

/**
 * Server name shape check. `dsh-cordis` additionally enforces the
 * `[A-Za-z0-9_-]{1,32}` limit its MCP client validates serverName against,
 * so an over-long name fails here with a 400 instead of inside the agent.
 */
export function isValidMcpName(name: string, format?: McpFormat): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return false;
  if (format === "dsh-cordis") return name.length <= 32;
  return true;
}
