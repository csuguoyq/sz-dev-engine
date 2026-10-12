import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { AGENT_PRESETS, applyZcodeModel, binOnPath, findExecutable, findPreset, parseModelLines, previewCommand, resolvePresetBin, resolvePresetCommand, type AgentPreset } from "./agents.js";

export { binOnPath, findExecutable };
import { StageError } from "./errors.js";

export interface InitOptions {
  repoRoot: string;
  agent?: string;
  model?: string;
  yes?: boolean;
  ask?: (prompt: string) => Promise<string>;
  installed?: (bin: string) => boolean;
  modelsFor?: (preset: AgentPreset) => string[];
  applyZcodeModel?: (model: string) => { file: string; previous: string };
  /** Environment used to resolve the preset's binary and model list (tests inject a hermetic HOME/PATH). */
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
}

export interface InitResult {
  file: string;
  agent: string;
  model: string;
  wrote: boolean;
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const log = options.log ?? ((line) => console.log(line));
  // Write where loadConfig looks first (repo root). The nested ai-flow/
  // location is legacy and only consulted to carry previous settings over.
  const file = path.join(options.repoRoot, "ai-flow.config.json");
  const legacyFile = path.join(options.repoRoot, "ai-flow", "ai-flow.config.json");
  const installed = options.installed ?? binOnPath;
  const env = options.env ?? process.env;
  // An explicit runner.models list in the existing config is the operator's
  // pinned model set (see types.ts) — it overrides the derived list here and
  // must survive an overwrite below.
  const previousForModels = { ...readPrevious(legacyFile), ...readPrevious(file) };
  const prevRunnerForModels = typeof previousForModels.runner === "object" && previousForModels.runner !== null ? previousForModels.runner as { models?: unknown } : {};
  const pinnedModels = Array.isArray(prevRunnerForModels.models)
    ? (prevRunnerForModels.models as unknown[]).filter((m): m is string => typeof m === "string" && m.trim() !== "")
    : [];
  const modelsFor = options.modelsFor ?? ((preset) => pinnedModels.length > 0 ? pinnedModels : listPresetModels(preset, installed(preset.bin), env));

  const preset = options.agent ? requirePreset(options.agent) : await pickPreset(options, log);
  const resolvedBin = options.installed ? (installed(preset.bin) ? preset.bin : resolvePresetBin(preset, env)) : resolvePresetBin(preset, env);
  if (!resolvedBin) {
    log(`${preset.bin} was not found on PATH or at any known install location. Install it before running a ticket.`);
  }

  // Model selection rules:
  // - an explicit --model always wins;
  // - agents whose CLI takes a model, or that ship a known model list, get
  //   the interactive prompt (Enter = CLI default); a non-interactive stdin
  //   without --model degrades to the CLI default instead of failing;
  // - agents with neither a model flag nor a model list keep "".
  const interactive = options.ask !== undefined || process.stdin.isTTY;
  const choices = modelsFor(preset);
  const model =
    options.model !== undefined
      ? options.model.trim()
      : preset.modelInCommand || choices.length > 0
        ? interactive
          ? await pickModel(preset, choices, options, log)
          : ""
        : "";

  // zcode's headless CLI has no model flag, so the selection only takes
  // effect when it is written into zcode's own CLI config (model.main).
  // An empty model keeps the CLI default and leaves that file untouched.
  if (preset.id === "zcode" && model) {
    const applyModel = options.applyZcodeModel ?? applyZcodeModel;
    const applied = applyModel(model);
    log(`zcode model=${model} written to ${applied.file}${applied.previous ? ` (was ${applied.previous})` : ""}`);
  }

  if (fs.existsSync(file) && !options.yes) {
    const answer = (await ask(options, `Overwrite ${file}? [y/N] `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      log("Left the existing config in place.");
      return { file, agent: preset.id, model, wrote: false };
    }
  }

  const previous = { ...readPrevious(legacyFile), ...readPrevious(file) };
  // Merge defaults per field: a previous szdev/ui that only sets some fields
  // must not drop the defaults for the rest (e.g. a szdev without `pack`).
  const prevSzdev = typeof previous.szdev === "object" && previous.szdev !== null ? previous.szdev as Record<string, unknown> : {};
  const prevUi = typeof previous.ui === "object" && previous.ui !== null ? previous.ui as Record<string, unknown> : {};
  // Runner fields a previous init (or a hand-edited file) added are USER
  // state, not preset output — a re-init must carry them over instead of
  // silently dropping them.
  const prevRunner =
    typeof previous.runner === "object" && previous.runner !== null ? (previous.runner as Record<string, unknown>) : {};
  const prevAgent = typeof previous.agent === "string" ? previous.agent : "";
  const resolvedCommand = resolvePresetCommand(preset, env);
  const prevCommand =
    Array.isArray(prevRunner.command) &&
    prevRunner.command.length > 0 &&
    prevRunner.command.every((part) => typeof part === "string")
      ? (prevRunner.command as string[])
      : undefined;
  const hasPromptToken = (command: string[]): boolean =>
    command.some((part) => part.includes("{promptFile") || part.includes("{promptStdin}") || part.includes("{promptArg}"));
  // Same preset template, bin path aside: init writes absolute bin paths that
  // can move between runs (PATH/install changes) without the command itself
  // having been customized.
  const samePresetTemplate = (prev: string[], current: string[]): boolean => {
    if (prev.length !== current.length) return false;
    for (let i = 0; i < current.length; i += 1) {
      if (i === 0) {
        if (path.basename(prev[0]!) !== path.basename(current[0]!)) return false;
        continue;
      }
      if (prev[i] !== current[i]) return false;
    }
    return true;
  };
  // A previous command counts as CUSTOM when it is a runnable prompt command
  // (carries a prompt token), belongs to this same agent (or to a legacy file
  // with no `agent` at all — the documented migration path), and differs from
  // the preset's own template. Switching to a DIFFERENT agent never preserves
  // the old command: the new preset owns the invocation.
  const customCommand =
    prevCommand !== undefined &&
    hasPromptToken(prevCommand) &&
    (prevAgent === "" || prevAgent === preset.id) &&
    !samePresetTemplate(prevCommand, resolvedCommand);
  const command = customCommand ? prevCommand : resolvedCommand;
  const runner: Record<string, unknown> = { command };
  if (typeof prevRunner.modelFlag === "string" && prevRunner.modelFlag) runner.modelFlag = prevRunner.modelFlag;
  if (Array.isArray(prevRunner.modelsCommand) && prevRunner.modelsCommand.every((part) => typeof part === "string")) {
    runner.modelsCommand = prevRunner.modelsCommand as string[];
  }
  if (Array.isArray(prevRunner.statusCommand) && prevRunner.statusCommand.every((part) => typeof part === "string")) {
    runner.statusCommand = prevRunner.statusCommand as string[];
  }
  if (typeof prevRunner.versionCheck === "string" && prevRunner.versionCheck) runner.versionCheck = prevRunner.versionCheck;
  const body = {
    $comment: "Written by ai-flow init. Do not put cookies in this file.",
    agent: preset.id,
    model,
    // Write the resolved command explicitly so the config shows what actually
    // runs (loadConfig honors an explicit runner.command over the preset).
    // A customized previous command (above) wins over the preset template.
    runner,
    szdev: { skillDir: "skills/sz-dev", pack: "cql", ...prevSzdev },
    // Default the viewer to loopback only: starting/stopping runs, approving
    // gate 4 and editing the agent's MCP config are privileged actions, so a
    // shared machine should not expose them to the whole LAN by default. A
    // remote workstation can still reach the viewer by setting ui.host (or
    // tunneling over SSH).
    ui: { host: "127.0.0.1", port: 4173, ...prevUi },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  log(`Wrote ${file}`);
  log(`${preset.label}  model=${model || "(CLI default)"}`);
  log(previewCommand(command, model).join(" "));
  if (customCommand) {
    log(
      `Kept the existing custom runner.command (it overrides the ${preset.label} preset template); ` +
        "remove the runner block from the config to switch back to the preset.",
    );
  }
  const uiHost = typeof prevUi.host === "string" && prevUi.host ? prevUi.host : "127.0.0.1";
  const uiPort = typeof prevUi.port === "number" ? prevUi.port : 4173;
  const uiToken = typeof prevUi.token === "string" && prevUi.token ? prevUi.token : undefined;
  if (uiHost !== "127.0.0.1" && uiHost !== "localhost") {
    // A non-loopback viewer is drivable by anyone on that network. The
    // single effective mitigation is a bearer token (ui.token): the UI asks
    // for it and stores it in the browser session, and curl can present it
    // as Authorization: Bearer. Cross-origin CSRF and per-client rate
    // limiting are on by default too, but they do not replace the token.
    log(
      `Note: the viewer will listen on ${uiHost}:${uiPort} — anyone on that network can start/stop runs, approve gate 4 and edit the agent's MCP config. ` +
        (uiToken
          ? "ui.token is set, so requests must present it (Authorization: Bearer); the UI prompts for it on first load."
          : `Set ui.token in ${file} to require a bearer token — the UI will prompt for it and keep it in the browser session. ` +
            "If you do not need remote access, set ui.host to 127.0.0.1 instead."),
    );
  }
  return { file, agent: preset.id, model, wrote: true };
}

function requirePreset(id: string): AgentPreset {
  const preset = findPreset(id);
  if (!preset) {
    throw new StageError(`Unknown agent "${id}". Choose one of: ${AGENT_PRESETS.map((item) => item.id).join(", ")}.`, "startup", null);
  }
  return preset;
}

async function pickPreset(options: InitOptions, log: (line: string) => void): Promise<AgentPreset> {
  const lines = ["Select an agent:"];
  AGENT_PRESETS.forEach((preset, index) => {
    const found = options.installed ? (options.installed(preset.bin) ? preset.bin : null) : resolvePresetBin(preset);
    lines.push(`  ${index + 1}) ${preset.label} (${preset.bin}) — ${found ? `installed (${found})` : "not found"}`);
  });
  log(lines.join("\n"));
  const answer = (await ask(options, "Agent number: ")).trim();
  const index = Number(answer) - 1;
  const preset = AGENT_PRESETS[index];
  if (!preset) {
    throw new StageError(`Pick a number from 1 to ${AGENT_PRESETS.length}.`, "startup", null);
  }
  return preset;
}

async function pickModel(preset: AgentPreset, models: string[], options: InitOptions, log: (line: string) => void): Promise<string> {
  if (models.length === 0) {
    return (await ask(options, "Model id (Enter for the CLI default): ")).trim();
  }
  const lines = [`Models for ${preset.label}:`];
  models.forEach((id, index) => lines.push(`  ${index + 1}) ${id}`));
  log(lines.join("\n"));
  const answer = (await ask(options, "Enter a number, a model id, or press Enter for the CLI default: ")).trim();
  if (!answer) return "";
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= models.length) return models[index - 1] ?? "";
  return answer;
}

async function ask(options: InitOptions, prompt: string): Promise<string> {
  if (options.ask) return options.ask(prompt);
  if (!process.stdin.isTTY) {
    throw new StageError("Pass --agent and --yes when stdin is not a terminal. --model is optional.", "startup", null);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(prompt, resolve));
  } finally {
    rl.close();
  }
}

export function listPresetModels(preset: AgentPreset, installed: boolean, env: NodeJS.ProcessEnv = process.env): string[] {
  if (preset.listModels && installed) {
    const exe = resolvePresetBin(preset, env) ?? preset.bin;
    const result = spawnSync(exe, preset.listModels, { encoding: "utf8", timeout: 20_000 });
    const listed = parseModelLines(result.stdout ?? "");
    if (listed.length > 0) return listed;
  }
  const fromConfig = preset.modelsFromConfig?.(env) ?? [];
  if (fromConfig.length > 0) return fromConfig;
  return preset.models ?? [];
}

/**
 * The previous config file, restricted to the fields a re-init carries over
 * (szdev/ui defaults, the user's runner customization, and the agent id the
 * file was written for — the latter distinguishes "customized within the
 * same agent" from "stale command of a different agent").
 */
function readPrevious(file: string): { szdev?: unknown; ui?: unknown; runner?: unknown; agent?: string } {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      szdev?: unknown;
      ui?: unknown;
      runner?: unknown;
      agent?: unknown;
    };
    return {
      runner: parsed.runner && typeof parsed.runner === "object" ? parsed.runner : undefined,
      szdev: parsed.szdev && typeof parsed.szdev === "object" ? parsed.szdev : undefined,
      ui: parsed.ui && typeof parsed.ui === "object" ? parsed.ui : undefined,
      agent: typeof parsed.agent === "string" ? parsed.agent.trim().toLowerCase() : undefined,
    };
  } catch {
    return {};
  }
}
