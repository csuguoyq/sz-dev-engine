import fs from "node:fs";
import path from "node:path";
import { findPreset, resolvePresetCommand } from "./agents.js";
import { StageError } from "./errors.js";
import type { AiFlowConfig } from "./types.js";

/**
 * expandArgv assumes the token directly before `{model}` is the model's
 * flag ("-m", "--model", …): when the model is empty it pops that preceding
 * flag. If `{model}` follows any other token, an empty model would delete
 * that real argument — warn at config load instead of on the first
 * model-less run.
 */
function warnModelTokenAdjacency(command: string[] | undefined): void {
  if (!Array.isArray(command)) return;
  const index = command.indexOf("{model}");
  if (index <= 0) return;
  const prev = command[index - 1];
  if (typeof prev !== "string" || !prev.startsWith("-")) {
    console.warn(
      `ai-flow: runner.command has {model} right after "${prev}" — an empty model drops the preceding token, which is assumed to be a flag like "-m". Put the flag directly before {model}.`,
    );
  }
}

export function loadConfig(repoRoot: string): AiFlowConfig {
  const fromEnv = process.env.AI_FLOW_CONFIG;
  const candidates = [
    fromEnv,
    path.join(repoRoot, "ai-flow.config.json"),
    path.join(repoRoot, "ai-flow", "ai-flow.config.json"),
  ].filter((p): p is string => Boolean(p));

  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    throw new StageError(
      "Missing ai-flow.config.json. Run `ai-flow init` from the repository root.",
      "startup",
      null,
    );
  }

  let parsed: AiFlowConfig;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AiFlowConfig;
  } catch (err) {
    throw new StageError(
      `Unable to parse ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`,
      "startup",
      null,
    );
  }

  const agentId = typeof parsed.agent === "string" ? parsed.agent.trim() : "";
  if (agentId) {
    const preset = findPreset(agentId);
    if (!preset) {
      throw new StageError(`Unknown agent "${agentId}". Run ai-flow init.`, "startup", null);
    }
    parsed.agent = preset.id;
    parsed.model = typeof parsed.model === "string" ? parsed.model.trim() : "";
    // An explicit runner.command in the file is authoritative (what you see is
    // what runs); otherwise the preset owns the command, resolved through its
    // binCandidates so the config shows / spawns the same absolute path.
    const extras = parsed.runner ?? {};
    const explicit =
      Array.isArray(extras.command) &&
      extras.command.length > 0 &&
      extras.command.every((part) => typeof part === "string") &&
      extras.command.some((part) => part.includes("{promptFile") || part.includes("{promptStdin}") || part.includes("{promptArg}"))
        ? extras.command
        : undefined;
    parsed.runner = {
      command: explicit ?? resolvePresetCommand(preset),
      ...(extras.modelFlag !== undefined ? { modelFlag: extras.modelFlag } : {}),
      ...(extras.modelsCommand !== undefined ? { modelsCommand: extras.modelsCommand } : {}),
      ...(extras.models !== undefined ? { models: extras.models } : {}),
      ...(extras.statusCommand !== undefined ? { statusCommand: extras.statusCommand } : {}),
      ...(extras.versionCheck !== undefined ? { versionCheck: extras.versionCheck } : {}),
    };
    warnModelTokenAdjacency(parsed.runner.command);
    return parsed;
  }

  const command = parsed.runner?.command;
  if (!Array.isArray(command) || command.length === 0 || command.some((p) => typeof p !== "string")) {
    throw new StageError("Set agent (ai-flow init) or runner.command as a non-empty array of strings.", "startup", null);
  }
  if (!command.some((part) => part.includes("{promptFile") || part.includes("{promptStdin}") || part.includes("{promptArg}"))) {
    throw new StageError(
      "runner.command must include {promptFile}, {promptStdin}, or {promptArg} so the agent can read the stage prompt.",
      "startup",
      null,
    );
  }
  // Default the model flag to "-m" so the documented opencode agent keeps
  // working out of the box; any other agent overrides it via runner.modelFlag
  // (or passes the model through a {model} token in command instead).
  if (parsed.runner.modelFlag === undefined) parsed.runner.modelFlag = "-m";
  warnModelTokenAdjacency(command);
  return parsed;
}

/**
 * The ticket-anchored CLI process pattern (POSIX ERE for pkill -f).
 *
 * Two pkill traps are documented here so they are not reintroduced:
 * - a capturing group `(js|ts)` is valid ERE, but the PCRE non-capturing
 *   form `(?:js|ts)` makes regcomp fail and pkill kill NOTHING (exit 2,
 *   silent) — the anchor would be a no-op;
 * - pkill -f is an unanchored substring search, so a trailing boundary
 *   `([^0-9]|$)` is required: without it, stopping SZ123 would also match
 *   a pipeline of SZ1234 (prefix-related ticket ids), the same class of
 *   bug the fix-commit grep guards against with `([^0-9]|$)`.
 */
export function cliRunPattern(id: string): string {
  // Match both the node-run CLI (`dist/cli.js run SZ..`) and the installed
  // `ai-flow` / `ai-flow.exe` bin so `ai-flow stop` can kill either form. Only
  // capturing groups are used — POSIX ERE (pkill -f) rejects the PCRE
  // non-capturing `(?:..)` form, which would make the pattern fail to compile.
  return `(cli\\.(js|ts)|ai-flow(\\.exe)?) run ${id}([^0-9]|$)`;
}

/**
 * Process-name patterns used by `stop`/`Stop` to kill a running pipeline.
 * The CLI pattern is anchored to the ticket id, so it can only ever match
 * this run.
 *
 * An agent pattern is derived from `runner.command` ONLY when the command
 * embeds `{cwd}` — the one token that anchors the match to this ticket,
 * since the workspace path embeds the SZ id. Prompt/model tokens expand to
 * unanchored `.*`; a command without `{cwd}` (deepseek, claude presets)
 * would match EVERY same-shape agent process on the machine, so for those
 * the agent is killed by pid instead (see stop.ts, the runner records the
 * pid in the run's agent.pid).
 */
export function agentProcessPatterns(config: AiFlowConfig, id: string): string[] {
  const digits = id.replace(/^SZ/i, "");
  const patterns = [cliRunPattern(id)];
  const command = config.runner?.command;
  if (Array.isArray(command) && command.length > 0 && command.includes("{cwd}")) {
    const pattern = command
      .map((part, index) => {
        // Workspace paths embed the ticket id; match the "sz" part
        // case-insensitively ([sS][zZ] — pkill -f takes POSIX ERE, which has
        // no case-fold flag) so SZ123-style paths stay anchored to this ticket.
        if (part === "{cwd}") {
          // When another token follows {cwd}, the joining `\s+` already
          // delimits the ticket number (a longer id like SZ1234 would not be
          // followed by whitespace, so it cannot match). Only when {cwd} is
          // the last token does the number run to the end of the cmdline and
          // need the explicit boundary.
          return index === command.length - 1 ? `.*[sS][zZ]${digits}([^0-9]|$)` : `.*[sS][zZ]${digits}`;
        }
        if (part === "{promptStdin}" || part === "{promptArg}" || part === "{promptFile}" || part === "{model}") return ".*";
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("\\s+");
    if (pattern) patterns.push(pattern);
  }
  return patterns;
}

export function uiBind(config: AiFlowConfig): { host: string; port: number } {
  return {
    host: config.ui?.host || "127.0.0.1",
    port: config.ui?.port || 4173,
  };
}
