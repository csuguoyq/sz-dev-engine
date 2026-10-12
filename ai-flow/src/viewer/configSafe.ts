import { loadConfig } from "../config.js";
import type { AiFlowConfig } from "../types.js";

/**
 * Config that degrades to empty on any load error, so status/models/guard
 * endpoints still respond (just with no agent-specific data) when the
 * config file is missing or corrupt.
 */
export function loadConfigSafe(repoRoot: string): AiFlowConfig {
  try {
    return loadConfig(repoRoot);
  } catch {
    return { runner: { command: [] } };
  }
}
