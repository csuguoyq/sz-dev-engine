import fs from "node:fs";

/**
 * Shared JSON file readers (mcp.ts and agents.ts both needed one).
 * Failures are silent by design: a missing or corrupt config file means
 * "no servers / no models yet", never a crash — the caller surfaces the
 * absence to the operator instead.
 */

/** Read and parse a JSON file; `undefined` when missing or unparsable. */
export function readJsonSafe(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Read a JSON file as a plain object; `{}` when missing, unparsable, or not an object. */
export function readJsonObject(file: string): Record<string, unknown> {
  const parsed = readJsonSafe(file);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
