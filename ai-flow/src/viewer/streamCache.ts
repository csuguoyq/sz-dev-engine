import fs from "node:fs";
import { createStreamEventCollector, createStreamFormatter, type StreamEvent } from "../streamFormat.js";

/**
 * Incremental parser for stream-json stage logs (zcode). The live log poll
 * used to re-read and re-parse the ENTIRE log every 2s: for a multi-hour
 * agent the file is tens of MB of streaming deltas, so every poll churned
 * that through memory and re-ran the formatter over the whole history.
 *
 * The stage log is append-only by construction (the runner opens it with
 * flags "a"; the orchestrator uses appendFileSync), so a per-file byte
 * cursor plus the persistent formatter/collector state is sufficient: each
 * poll reads only the new bytes and feeds the new lines. The cached state
 * is process memory only — a viewer restart re-parses once, which is
 * acceptable.
 *
 * Reset (full re-parse) fires when the file disappears and reappears,
 * shrinks, or its mtime moves backwards — i.e. anything that is not an
 * append. The byte cursor always sits just after a newline, which is never
 * a UTF-8 continuation byte, so byte-offset reads are character-safe.
 */

interface Entry {
  /** Bytes consumed: the offset just past the last fully-consumed newline. */
  size: number;
  mtimeMs: number;
  collector: ReturnType<typeof createStreamEventCollector>;
  formatter: ReturnType<typeof createStreamFormatter>;
  /** Formatted lines accumulated so far (formatter.push outputs). */
  text: string[];
}

/** Bounded LRU: at most this many parsed logs stay in memory. */
const MAX_CACHED = 32;
const cache = new Map<string, Entry>();

export interface StreamLogView {
  exists: boolean;
  content: string;
  events: StreamEvent[];
  /** True when this call started from a full re-parse (new/shrunk file). */
  reset: boolean;
}

function makeEntry(): Entry {
  return { size: 0, mtimeMs: 0, collector: createStreamEventCollector(), formatter: createStreamFormatter(), text: [] };
}

function touch(file: string, entry: Entry): void {
  cache.delete(file);
  cache.set(file, entry);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * The `"type":"session.updated"` bookkeeping lines the formatter renders
 * as nothing — dropped before formatting, exactly as the full-read path
 * did (kept in one place so incremental and reset paths cannot diverge).
 */
const BOOKKEEPING = '"type":"session.updated"';

function feed(entry: Entry, lines: string[]): void {
  for (const line of lines) {
    entry.collector.push(line);
    entry.text.push(...entry.formatter.push(line));
  }
}

/**
 * Read (incrementally) and format the stream-json log at `file`.
 * Returns the full formatted text and the structured events so far; the
 * cost per call is proportional to the bytes appended since the last call.
 */
export function readStreamLog(file: string): StreamLogView {
  if (!fs.existsSync(file)) {
    cache.delete(file);
    return { exists: false, content: "", events: [], reset: false };
  }
  const stat = fs.statSync(file);
  let entry = cache.get(file);
  let reset = false;
  if (!entry || stat.size < entry.size || stat.mtimeMs < entry.mtimeMs) {
    entry = makeEntry();
    reset = true;
  }
  // Persist (or refresh) the entry: the Map stores the object reference, so
  // the cursor updates below are visible to the next read. Without this the
  // cache never retains state and every read re-parses the whole file.
  touch(file, entry);
  const deltaLength = stat.size - entry.size;
  if (deltaLength > 0) {
    const fd = fs.openSync(file, "r");
    const chunk = Buffer.alloc(deltaLength);
    try {
      fs.readSync(fd, chunk, 0, deltaLength, entry.size);
    } finally {
      fs.closeSync(fd);
    }
    let text = chunk.toString("utf8");
    // Do not consume a final line that has no trailing newline yet: it may
    // still be growing, and it is re-read on the next poll.
    const lastNewline = text.lastIndexOf("\n");
    const complete = lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);
    if (complete) {
      const lines = complete.split(/\r?\n/).filter((line) => !line.includes(BOOKKEEPING));
      feed(entry, lines);
      entry.size += Buffer.byteLength(complete, "utf8");
      entry.mtimeMs = stat.mtimeMs;
    }
  }
  const content = [...entry.text, ...entry.formatter.finish()].join("\n");
  return { exists: true, content, events: entry.collector.finish(), reset };
}

/**
 * Drop cached logs by path prefix (a deleted run's whole logs directory) or
 * everything when called without one.
 */
export function dropStreamCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
