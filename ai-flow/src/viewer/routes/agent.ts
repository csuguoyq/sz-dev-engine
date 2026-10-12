import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { agentBin, findPreset, findPresetByBin, parseModelLines, resolvePresetBin, resolvePresetStatusCommand } from "../../agents.js";
import { loadConfig } from "../../config.js";
import { redact } from "../../redact.js";
import type { AgentSessionInfo, AgentStatus } from "../apiTypes.js";
import { send } from "../http.js";
import { spawnAsync } from "../process.js";
import type { AiFlowConfig } from "../../types.js";

/**
 * Agent-probe routes: model dropdown, status bar, session log, session list.
 * Every external command here runs through spawnAsync (bounded timeout,
 * SIGKILL) so a wedged probe cannot block the HTTP event loop.
 */
export async function listModels(repoRoot: string): Promise<{ models: string[]; label: string | null; model: string | null; modelOptional: boolean }> {
  try {
    const config = loadConfig(repoRoot);
    const preset = (config.agent ? findPreset(config.agent) : undefined) ?? findPresetByBin(agentBin(config));
    const label = preset?.label ?? null;
    const model = config.model?.trim() || null;
    // Agents that never take a model on the command line must not gate the
    // Create dialog on a non-empty model selection.
    const modelOptional = preset ? preset.modelInCommand === false : false;
    // An explicit runner.models list is the operator's word on what is
    // actually usable (a CLI's local config rarely knows the server-side
    // plan entitlements) — it wins over every derived source.
    const pinned = Array.isArray(config.runner?.models)
      ? config.runner.models.filter((m): m is string => typeof m === "string" && m.trim() !== "")
      : [];
    if (pinned.length > 0) return { models: pinned, label, model, modelOptional };
    const fromCommand = await listedByCommand(config.runner?.modelsCommand);
    if (fromCommand.length > 0) return { models: fromCommand, label, model, modelOptional };
    if (preset?.listModels) {
      const exe = resolvePresetBin(preset) ?? preset.bin;
      const result = await spawnAsync(exe, preset.listModels, { timeoutMs: 20_000 });
      const listed = parseModelLines(result.stdout);
      if (listed.length > 0) return { models: listed.sort(), label, model, modelOptional };
    }
    // CLIs without a models subcommand (zcode) expose their live model list
    // only through their own config files — the same source init uses.
    const fromConfig = preset?.modelsFromConfig?.() ?? [];
    if (fromConfig.length > 0) return { models: fromConfig.sort(), label, model, modelOptional };
    return { models: [...(preset?.models ?? [])], label, model, modelOptional };
  } catch {
    return { models: [], label: null, model: null, modelOptional: false };
  }
}

export async function listedByCommand(command: string[] | undefined): Promise<string[]> {
  if (!Array.isArray(command) || command.length === 0 || !command[0]) return [];
  const result = await spawnAsync(command[0], command.slice(1), { timeoutMs: 20_000 });
  if (result.error || result.code !== 0) return [];
  return parseModelLines(result.stdout).sort();
}

/**
 * Agent name and model from config, plus live session stats.
 * `runner.statusCommand` wins when set. An OpenCode preset with no status
 * command reads that CLI's local session database.
 */
export async function agentStatus(repoRoot: string, dir: string): Promise<AgentStatus> {
  let agent: string | null = null;
  let label: string | null = null;
  let model: string | null = null;
  let opencode = false;
  let config: AiFlowConfig | null = null;
  try {
    config = loadConfig(repoRoot);
    const preset = (config.agent ? findPreset(config.agent) : undefined) ?? findPresetByBin(agentBin(config));
    agent = preset?.id ?? config.agent ?? null;
    label = preset?.label ?? null;
    model = config.model?.trim() || null;
    opencode = preset?.id === "opencode" || agentBin(config) === "opencode";
  } catch {
    // The status bar still renders when the agent is not configured yet.
  }

  if (config) {
    const fromCommand = await sessionFromStatusCommand(dir, config);
    if (fromCommand !== undefined) return { dir, agent, label, model, session: fromCommand as AgentSessionInfo | null };
  }

  const db = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
  let session: Record<string, unknown> | null = null;
  if (opencode && dir && fs.existsSync(db)) {
    // dir arrives from a query parameter; the session lookup keys on the
    // agent's working directory, which is always an absolute path. Reject
    // anything else so we never build a SQL string from non-path input.
    if (!path.isAbsolute(dir)) return { dir, agent, label, model, session: null };
    const safeDir = dir.replace(/'/g, "''");
    const result = await spawnAsync(
      "sqlite3",
      [
        db,
        `select json_object('model',model,'agent',agent,'input',tokens_input,'output',tokens_output,` +
          `'reasoning',tokens_reasoning,'cacheRead',tokens_cache_read,'cacheWrite',tokens_cache_write,` +
          `'updatedAt',time_updated,'slug',slug) ` +
          `from session where directory='${safeDir}' ` +
          `order by time_updated desc limit 1;`,
      ],
      { timeoutMs: 5000 },
    );
    const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (line) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        // opencode stores the model column as a JSON object string.
        if (typeof parsed.model === "string") {
          try {
            parsed.model = JSON.parse(parsed.model);
          } catch {
            // keep the raw string
          }
        }
        session = parsed;
      } catch {
        session = null;
      }
    }
  }
  if (opencode && !model) {
    try {
      const opencodeConfig = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "opencode", "opencode.json"), "utf8"));
      if (typeof opencodeConfig.model === "string") model = opencodeConfig.model;
    } catch {
      // optional
    }
  }
  return { dir, agent, label, model, session };
}

async function sessionFromStatusCommand(dir: string, config: AiFlowConfig): Promise<unknown | undefined> {
  // The config's explicit statusCommand wins; otherwise fall back to the
  // preset's bundled per-agent probe (ai-flow/tools/status/<agent>.sh).
  const preset = config.agent ? findPreset(config.agent) : undefined;
  const command = config.runner?.statusCommand ?? (preset ? resolvePresetStatusCommand(preset) : undefined);
  if (!Array.isArray(command) || command.length === 0 || !command[0]) return undefined;
  const argv = command.map((part) => part.replaceAll("{dir}", dir));
  const result = await spawnAsync(argv[0], argv.slice(1), { timeoutMs: 5000 });
  if (result.error || result.code !== 0) return null;
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

