import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonSafe } from "./jsonFile.js";

/**
 * One headless coding CLI. The command template may contain:
 * {cwd} workspace, {promptStdin} prompt via stdin (token removed from argv),
 * {promptArg} prompt as one argument, {model} model id (flag dropped when empty).
 */
export interface AgentPreset {
  id: string;
  label: string;
  bin: string;
  command: string[];
  /** Args passed to `bin` to list model ids, one per line. */
  listModels?: string[];
  /**
   * Read this agent's own config for its available model ids (used when the
   * CLI has no models subcommand). Returns [] when nothing can be read.
   */
  modelsFromConfig?: (env?: NodeJS.ProcessEnv) => string[];
  /** Shown when the CLI has no list command, or the list command fails. */
  models?: string[];
  /** When false, `model` is stored and shown but not placed on the command line. */
  modelInCommand: boolean;
  /**
   * Known install locations tried in order when `bin` is not resolvable via
   * PATH / ~/.local/bin / ~/bin (entries starting with "~" expand to HOME).
   */
  binCandidates?: string[];
  /**
   * Filename of this agent's session-status probe inside the package's
   * tools/ directory (tools/<statusScript>). The probe takes the workspace
   * directory as its only argument and prints one JSON line
   * (model/agent/token counts) so the viewer status bar can show what the
   * agent is actually using.
   */
  statusScript?: string;
  /**
   * True when the agent's own stdout already streams a human-readable
   * process log into the stage log file. The viewer then suppresses the
   * session-activity tail, which would only duplicate what is visible above.
   */
  stdoutIsProcess?: boolean;
  /**
   * True when the agent's stdout is a `stream-json` event stream (zcode).
   * The viewer formats it into the readable process log when reading the
   * stage log back; raw downloads keep the original JSON lines.
   */
  stdoutStreamJson?: boolean;
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "cursor",
    label: "Cursor",
    bin: "agent",
    command: ["agent", "-p", "--force", "--trust", "--workspace", "{cwd}", "--output-format", "text", "--model", "{model}", "{promptStdin}"],
    listModels: ["models"],
    modelInCommand: true,
  },
  {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
    command: ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "text", "--model", "{model}", "{promptStdin}"],
    models: ["sonnet", "opus", "haiku"],
    modelInCommand: true,
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    bin: "codex",
    command: ["codex", "exec", "--full-auto", "--skip-git-repo-check", "--color", "never", "-C", "{cwd}", "--model", "{model}", "-", "{promptStdin}"],
    modelInCommand: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    bin: "dsh",
    command: ["dsh", "--profile", "headless", "{promptArg}"],
    modelInCommand: false,
  },
  {
    id: "zcode",
    label: "ZCode",
    bin: "zcode",
    // stream-json turns stdout into a live event stream (thinking/text/tool
    // events as they happen); the viewer formats it into the readable
    // process log, so no polling tail is needed.
    command: [
      "zcode",
      "--cwd",
      "{cwd}",
      "--mode",
      "yolo",
      "--no-color",
      "--output-format",
      "stream-json",
      "--prompt",
      "{promptArg}",
    ],
    // The desktop install ships the headless CLI inside ~/.zcode and does not
    // put `zcode` on PATH; resolve it there before failing the run.
    binCandidates: ["~/.zcode/server/agents/glm/zcode-agent"],
    statusScript: "zcode-status.sh",
    // Model ids offered at init and in the viewer. readZcodeProviderModels
    // reads the live list from zcode's config files; this single entry is
    // only the last-resort fallback for machines where those are unreadable.
    models: ["account:bigmodel-individual-coding-plan/GLM-5.3-Flash"],
    stdoutIsProcess: true,
    stdoutStreamJson: true,
    modelInCommand: false,
    modelsFromConfig: readZcodeProviderModels,
  },
  {
    id: "opencode",
    label: "OpenCode",
    bin: "opencode",
    command: ["opencode", "run", "--dir", "{cwd}", "--auto", "-m", "{model}", "{promptStdin}"],
    listModels: ["models"],
    statusScript: "opencode-status.sh",
    // `opencode run` streams a readable process log itself.
    stdoutIsProcess: true,
    modelInCommand: true,
  },
];

export function findPreset(id: string): AgentPreset | undefined {
  const key = id.trim().toLowerCase();
  return AGENT_PRESETS.find((preset) => preset.id === key);
}

export function findPresetByBin(bin: string): AgentPreset | undefined {
  const base = path.basename(bin).toLowerCase().replace(/\.exe$/, "");
  return AGENT_PRESETS.find((preset) => preset.bin === base);
}

/** Model ids from a CLI listing: `id`, `id - description`, or `provider/model`. */
export function parseModelLines(text: string): string[] {
  const ids: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^tip:/i.test(line)) continue;
    const dashed = /^([A-Za-z0-9][A-Za-z0-9._:/-]*)\s+-\s+/.exec(line);
    if (dashed?.[1]) {
      ids.push(dashed[1]);
      continue;
    }
    if (/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(line)) ids.push(line);
  }
  return [...new Set(ids)];
}

export function expandArgv(
  command: string[],
  options: { cwd: string; promptFile: string; prompt: string; model?: string; applyModel?: boolean; modelFlag?: string },
): { argv: string[]; stdin: string | null } {
  const model = options.model?.trim() ?? "";
  const applyModel = options.applyModel !== false;
  let stdin: string | null = null;
  const argv: string[] = [];
  for (const part of command) {
    if (part === "{promptStdin}") {
      stdin = options.prompt;
      continue;
    }
    if (part === "{promptArg}") {
      argv.push(options.prompt);
      continue;
    }
    if (part === "{model}") {
      if (!model) {
        const prev = argv.at(-1);
        if (prev && prev.startsWith("-")) argv.pop();
        continue;
      }
      argv.push(model);
      continue;
    }
    argv.push(part.replaceAll("{cwd}", options.cwd).replaceAll("{promptFile}", options.promptFile));
  }
  if (applyModel && model && !command.includes("{model}")) {
    const flag = options.modelFlag?.trim();
    if (flag) argv.push(flag, model);
    else {
      const bin = path.basename(argv[0] ?? "").toLowerCase();
      if (bin === "opencode" || bin === "opencode.exe") argv.push("-m", model);
      else argv.push("--model", model);
    }
  }
  return { argv, stdin };
}

/** Template with `{model}` filled or removed, prompt tokens left visible. */
export function previewCommand(command: string[], model: string): string[] {
  const argv: string[] = [];
  for (const part of command) {
    if (part !== "{model}") {
      argv.push(part);
      continue;
    }
    if (!model.trim()) {
      const prev = argv.at(-1);
      if (prev && prev.startsWith("-")) argv.pop();
      continue;
    }
    argv.push(model.trim());
  }
  return argv;
}

export function agentBin(config: { agent?: string; runner?: { command?: string[] } }): string {
  if (config.agent) {
    const preset = findPreset(config.agent);
    if (preset) return preset.bin;
  }
  const command = config.runner?.command?.[0];
  return command ? path.basename(command) : "";
}

/**
 * Resolve a CLI name to an executable file. PATH is searched first, then
 * ~/.local/bin and ~/bin, because Cursor and OpenCode install there even
 * when the process that starts a run does not have those directories on PATH.
 */
export function findExecutable(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (bin.includes("/") || bin.includes("\\")) return isExecutable(bin) ? bin : null;
  const home = env.HOME || os.homedir();
  const dirs = [...(env.PATH ?? "").split(path.delimiter), path.join(home, ".local", "bin"), path.join(home, "bin")];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const candidate = path.join(dir, bin);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function binOnPath(bin: string): boolean {
  return findExecutable(bin) !== null;
}

/**
 * Resolve a preset's CLI: PATH (via findExecutable) first, then the preset's
 * own binCandidates. Returns null when neither finds an executable.
 */
export function resolvePresetBin(preset: AgentPreset, env: NodeJS.ProcessEnv = process.env): string | null {
  const onPath = findExecutable(preset.bin, env);
  if (onPath) return onPath;
  const home = env.HOME || os.homedir();
  for (const candidate of preset.binCandidates ?? []) {
    const expanded = candidate.startsWith("~/") ? path.join(home, candidate.slice(2)) : candidate;
    if (isExecutable(expanded)) return expanded;
  }
  return null;
}

/**
 * Path of zcode's CLI config file, whose `model.main` field is the default
 * model its headless `--prompt` runs use.
 */
export function zcodeModelConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || os.homedir();
  return path.join(home, ".zcode", "cli", "config.json");
}

/**
 * Persist `model` as zcode's default model (`model.main` in its CLI config).
 * The headless CLI exposes no model flag and `strict` arg parsing rejects
 * unknown ones, so writing this file is the only way to make an init-time
 * selection effective. Other fields in the file (hooks, mcp, plugins) are
 * preserved untouched. Returns the config path and the previous selection
 * ("" when none) so callers can report the change.
 */
export function applyZcodeModel(model: string, env: NodeJS.ProcessEnv = process.env): { file: string; previous: string } {
  const file = zcodeModelConfigPath(env);
  let body: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // Leave an unparsable file alone rather than destroying the user's
      // hooks/mcp config over a model selection.
      throw new Error(`Cannot update model: ${file} is not valid JSON.`);
    }
  }
  const section = body.model && typeof body.model === "object" && !Array.isArray(body.model)
    ? { ...(body.model as Record<string, unknown>) }
    : {};
  const previous = typeof section.main === "string" ? section.main : "";
  section.main = model;
  body.model = section;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { file, previous };
}

/**
 * Template id of the coding-plan model catalog for an account provider id
 * ("account:bigmodel-*" / "account:zai-*"): zcode's per-family coding-plan
 * template in zcode-builtin.json carries that family's model list.
 */
function zcodePlanTemplateId(providerId: string): string {
  return providerId.includes("bigmodel") ? "bigmodel-api" : "zai-api";
}



/**
 * zcode's provider templates (~/.zcode/v2/runtime/provider/bundled/
 * zcode-builtin.json): templateId -> builtinModelIds. Returns an empty map
 * when the file is missing or unparsable.
 */
function readZcodeTemplateModels(env: NodeJS.ProcessEnv): Map<string, string[]> {
  const file = path.join(env.HOME || os.homedir(), ".zcode", "v2", "runtime", "provider", "bundled", "zcode-builtin.json");
  const templates = new Map<string, string[]>();
  const parsed = readJsonSafe(file) as {
    config?: { providerConfigRules?: { templateRules?: Array<{ templateId?: unknown; config?: { builtinModelIds?: unknown } }> } };
  } | undefined;
  for (const rule of parsed?.config?.providerConfigRules?.templateRules ?? []) {
    if (typeof rule.templateId !== "string") continue;
    const models = Array.isArray(rule.config?.builtinModelIds)
      ? rule.config.builtinModelIds.filter((m): m is string => typeof m === "string" && m !== "")
      : [];
    templates.set(rule.templateId, models);
  }
  return templates;
}

/**
 * Model ids zcode currently offers, derived from v2/provider_config.json —
 * the same source its provider UI edits:
 * - every enabled (`enabled !== false`) provider whose rule carries its own
 *   API key — custom providers and account rules alike (an account rule
 *   without an api-key is not a runnable credential, so it is skipped);
 * - per-model disables in the same file's modelConfigRules
 *   (providerModelRules entries with config.enabled === false) remove
 *   individual models a provider has turned off.
 * Account providers take their catalog from the rule's model list, or from
 * the family's coding-plan template in zcode-builtin.json when the rule
 * lists none. setting.json and credentials.json are deliberately not
 * consulted: a signed-in plan is not necessarily an enabled one. Returns []
 * when the file is missing or unparsable, so callers can fall back to the
 * preset's static list.
 */
export function readZcodeProviderModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || os.homedir();
  const v2 = path.join(home, ".zcode", "v2");
  const templates = readZcodeTemplateModels(env);
  const providerConfig = readJsonSafe(path.join(v2, "provider_config.json")) as
    | {
        config?: {
          providerConfigRules?: { providerRules?: unknown };
          modelConfigRules?: { providerModelRules?: unknown };
        };
      }
    | undefined;
  const rules = providerConfig?.config?.providerConfigRules?.providerRules;
  if (!Array.isArray(rules)) return [];

  // Models a provider has explicitly turned off (e.g. bigmodel-api/GLM-5.3
  // with config.enabled === false) never appear, whatever the rule lists.
  const disabled = new Set<string>();
  const modelRules = providerConfig?.config?.modelConfigRules?.providerModelRules;
  if (Array.isArray(modelRules)) {
    for (const rule of modelRules) {
      const entry = rule as { providerId?: unknown; modelId?: unknown; config?: { enabled?: unknown } };
      if (entry.config?.enabled !== false) continue;
      if (typeof entry.providerId === "string" && typeof entry.modelId === "string") {
        disabled.add(`${entry.providerId}/${entry.modelId}`);
      }
    }
  }

  const ids: string[] = [];
  const push = (provider: string, models: string[]) => {
    for (const model of models) {
      const id = `${provider}/${model}`;
      if (!disabled.has(id)) ids.push(id);
    }
  };
  for (const rule of rules) {
    const entry = rule as { enabled?: unknown; providerId?: unknown; config?: { modelOrder?: unknown; personalModelIds?: unknown; access?: { apiKey?: unknown } } };
    if (entry.enabled === false) continue;
    if (typeof entry.providerId !== "string" || !entry.providerId) continue;
    // A provider is listable only when it can authenticate on its own: the
    // rule must carry an API key, whatever its id (an account rule without
    // one is a leftover from the provider UI, not a runnable plan).
    const apiKey = entry.config?.access?.apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim()) continue;
    const models = Array.isArray(entry.config?.modelOrder) && entry.config.modelOrder.length > 0
      ? entry.config.modelOrder
      : entry.config?.personalModelIds;
    const listed = (Array.isArray(models) ? models : []).filter((m): m is string => typeof m === "string" && m !== "");
    if (entry.providerId.startsWith("account:")) {
      // Account providers may rely on the family's coding-plan template for
      // their catalog when the rule itself lists no models.
      push(entry.providerId, listed.length > 0 ? listed : templates.get(zcodePlanTemplateId(entry.providerId)) ?? []);
      continue;
    }
    push(entry.providerId, listed);
  }
  return [...new Set(ids)];
}

/** Preset command with argv[0] resolved to an absolute path when possible. */
export function resolvePresetCommand(preset: AgentPreset, env: NodeJS.ProcessEnv = process.env): string[] {
  const bin = resolvePresetBin(preset, env);
  if (!bin) return [...preset.command];
  return [bin, ...preset.command.slice(1)];
}

/**
 * Absolute path of the package's tools/ directory — home of the per-agent
 * helper scripts. Resolved from this module's own location so it works from
 * dist/ and src/ alike.
 */
export function statusToolsDir(): string {
  return path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "tools");
}

/** `[<script> {dir}]` for the preset's status probe, or null when it has none. */
export function resolvePresetStatusCommand(preset: AgentPreset): string[] | null {
  if (!preset.statusScript) return null;
  const script = path.join(statusToolsDir(), preset.statusScript);
  return fs.existsSync(script) ? [script, "{dir}"] : null;
}

function isExecutable(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

