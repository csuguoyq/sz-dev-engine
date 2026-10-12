import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { adapterIsGeneric } from "../adapters/index.js";
import { packageDir } from "../package.js";
import { type RunState } from "../types.js";
import { type RunSummary } from "./apiTypes.js";

export function serveStatic(response: http.ServerResponse, staticRoot: string, pathname: string): boolean {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(staticRoot, requested));
  // Path-separator-anchored prefix: a bare startsWith(staticRoot) would let a
  // sibling directory whose name extends staticRoot (e.g. /a/ui2 when the
  // root is /a/ui) slip through the traversal check.
  if (resolved !== staticRoot && !resolved.startsWith(staticRoot + path.sep)) {
    send(response, 403, { error: "Forbidden" });
    return true;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    if (pathname.startsWith("/api/")) return false;
    const index = path.join(staticRoot, "index.html");
    if (!fs.existsSync(index)) return false;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    fs.createReadStream(index).pipe(response);
    return true;
  }
  response.writeHead(200, { "content-type": contentType(resolved) });
  fs.createReadStream(resolved).pipe(response);
  return true;
}

export function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export const MAX_BODY_BYTES = 1024 * 1024;

/** A request body beyond MAX_BODY_BYTES — callers answer 413, not 400. */
export class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
  }
}

export function bodyError(err: unknown): { status: number; error: string } {
  if (err instanceof BodyTooLargeError) return { status: 413, error: "Request body too large (1MB limit)" };
  return { status: 400, error: "Request body must be JSON" };
}

/**
 * Buffer the request body, capped at 1MB. Every body in this API is small
 * JSON (id/model/comment/MCP spec); an uncapped buffer on the unauthenticated
 * viewer is a one-request OOM for the whole process.
 */
export function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    request.on("data", (chunk: Buffer) => {
      // Once the cap is hit we stop buffering (memory stays bounded) and let
      // the rest of the stream drain — the handler still has to answer 413.
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", (err) => {
      if (!aborted) reject(err);
    });
  });
}

export function summary(state: RunState): RunSummary {
  return {
    id: state.id,
    stage: state.stage,
    status: state.status,
    startedAt: state.startedAt,
    mode: state.szdev?.mode ?? null,
    pack: state.szdev?.pack ?? null,
    phase: state.szdev?.phase ?? null,
    gates: state.szdev?.gates ?? null,
    awaiting: state.awaiting ?? null,
    testVerdict: state.test?.verdict ?? null,
    error: state.error,
    // True when the run's pack has no dedicated module adapter (the generic
    // fallback with no scope guard) — the UI shows a loud warning.
    genericPack: adapterIsGeneric(state.szdev?.pack),
  };
}

export const STATE_DOCS: Array<{ key: string; file: string }> = [
  { key: "requirement", file: "phase1-requirement.md" },
  { key: "review", file: "phase2-review.md" },
  { key: "testPlan", file: "phase3-test-plan.md" },
  { key: "testReport", file: "phase3-test-report.md" },
  { key: "handoff", file: "phase4-handoff.md" },
  { key: "clarifications", file: "deliverables/clarification-comments.md" },
];

/**
 * The detail endpoint is polled every ~3s per open tab, and docs() reads six
 * state docs, the ticket cache (with a JSON-fence parse), and the whole
 * deliverables directory (including large CHANGES patches) on EVERY call.
 * Nothing changes between most polls, so the result is cached per run, keyed
 * by a cheap stat fingerprint (mtimeMs+size of every input file, plus the
 * deliverables listing and the ~/sz TC wiki). Any touch to a file changes
 * the fingerprint and forces a fresh read; unchanged runs cost a handful of
 * stat() calls per poll instead of full file reads.
 */
const DOCS_CACHE_MAX = 64;
const docsCache = new Map<string, { fingerprint: string; docs: Record<string, unknown> }>();

function fileStamp(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "absent";
  }
}

/** Cheap fingerprint of everything docs() reads for this run. */
function docsFingerprint(base: string, state: RunState): string {
  const parts: string[] = [base];
  for (const entry of STATE_DOCS) parts.push(fileStamp(path.join(base, entry.file)));
  parts.push(fileStamp(path.join(base, "attachment", "ticket-body.md")));
  parts.push(fileStamp(path.join(base, "attachment", "ticket-comments.md")));
  const deliverablesDir = path.join(base, "deliverables");
  if (fs.existsSync(deliverablesDir)) {
    for (const name of fs
      .readdirSync(deliverablesDir)
      .filter((name) => name.endsWith(".md") || name.endsWith(".wiki") || name.endsWith(".patch"))
      .sort()) {
      parts.push(`d:${name}:${fileStamp(path.join(deliverablesDir, name))}`);
    }
  }
  const digits = state.id.replace(/^SZ/i, "");
  parts.push(fileStamp(path.join(packageDir(), `TC${digits}.wiki`)));
  return parts.join("|");
}

export function docs(state: RunState): Record<string, unknown> {
  const base = state.szdev?.workspace ? path.join(state.szdev.workspace, ".sz-dev", state.id) : null;
  if (!base) {
    const out: Record<string, unknown> = {};
    for (const entry of STATE_DOCS) out[entry.key] = { ready: false, markdown: "" };
    out.ticket = { ready: false, markdown: "" };
    out.deliverables = { ready: false, files: [] };
    return out;
  }
  const cacheKey = `${state.id}\u0000${base}`;
  const fingerprint = docsFingerprint(base, state);
  const hit = docsCache.get(cacheKey);
  if (hit && hit.fingerprint === fingerprint) return hit.docs;
  const out: Record<string, unknown> = {};
  for (const entry of STATE_DOCS) {
    out[entry.key] = docAt(path.join(base, entry.file));
  }
  // The ticket is fetched by the phase-1 agent through its configured
  // softzilla MCP and cached into attachment/ticket-body.md (body) and
  // attachment/ticket-comments.md (comments), not by the orchestrator. Read
  // both so the Ticket tab shows the complete fetched ticket once phase 1 has
  // run, rather than anything the create request sent.
  out.ticket = ticketDoc(base);
  out.deliverables = deliverablesAt(path.join(base, "deliverables"), state.id);
  docsCache.set(cacheKey, { fingerprint, docs: out });
  while (docsCache.size > DOCS_CACHE_MAX) {
    const oldest = docsCache.keys().next().value;
    if (oldest === undefined) break;
    docsCache.delete(oldest);
  }
  return out;
}

/** Drop a run's cached docs (a deleted run's workspace is gone anyway). */
export function dropDocsCache(id?: string): void {
  if (!id) {
    docsCache.clear();
    return;
  }
  for (const key of [...docsCache.keys()]) {
    if (key.startsWith(`${id}\u0000`)) docsCache.delete(key);
  }
}

/**
 * Build the Ticket doc from the agent-fetched cache. The ticket tab shows
 * only the SZ ticket itself (title, fields, comment thread) — the agent's
 * cache files also carry housekeeping prose that must not leak into this
 * view. Returns not-ready until at least one of the two files exists, so the
 * UI can distinguish "ticket not fetched yet" from "fetched".
 */
export function ticketDoc(base: string): { ready: boolean; markdown: string } {
  const body = docAt(path.join(base, "attachment", "ticket-body.md"));
  const comments = docAt(path.join(base, "attachment", "ticket-comments.md"));
  if (!body.ready && !comments.ready) return { ready: false, markdown: "" };
  const parts: string[] = [];
  // The Ticket tab shows ONLY the SZ ticket itself — title, fields, and the
  // comment thread. The agent's cache files also carry housekeeping prose
  // (fetch notes, verbatim JSON payloads, replay out-of-bounds notes) that
  // must not leak into this view.
  const fence = /```[a-zA-Z]*\s*([\s\S]*?)\s*```/.exec(body.markdown);
  let bug: Record<string, unknown> | null = null;
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1] ?? "") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) bug = parsed as Record<string, unknown>;
    } catch {
      // No structured payload — fall back to the raw body below.
    }
  }
  if (bug && typeof bug.summary === "string" && bug.summary) {
    parts.push(`# #${String(bug.id ?? "")} ${bug.summary}`.trim());
    const fields: Array<[string, unknown]> = [
      ["State", bug.state],
      ["Resolution", bug.resolution],
      ["Severity", bug.severity],
      ["Priority", bug.priority],
      ["Type", bug.type],
      ["Platform", bug.platform],
      ["Assigned", bug.owner ?? bug.assigned_to],
      ["Keywords", bug.keywords],
    ];
    const chips = fields
      .map(([key, value]) => {
        // Nested fields like owner arrive as objects ({name: ...}) — take
        // the readable member instead of stringifying the object.
        let text = "";
        if (value !== undefined && value !== null) {
          const obj = value as Record<string, unknown>;
          text = typeof value === "object" ? String(obj.name ?? obj.login ?? obj.real_name ?? "") : String(value);
        }
        return [key, text] as [string, string];
      })
      .filter(([, text]) => text.trim() !== "");
    if (chips.length > 0) {
      parts.push("");
      parts.push(chips.map(([key, text]) => `**${key}:** ${text}`).join(" · "));
    }
  } else if (body.ready) {
    parts.push(body.markdown);
  }
  if (comments.ready) {
    const md = comments.markdown;
    // Skip the comments file's own header (fetch notes, replay annotations):
    // the thread starts at the first "## Comment" heading.
    const start = md.search(/^## Comment /m);
    parts.push("", "## Comments", "");
    parts.push(start >= 0 ? md.slice(start) : md);
  }
  return { ready: true, markdown: parts.join("\n").trim() };
}

export function deliverablesAt(dir: string, id: string): { ready: boolean; files: Array<{ name: string; content: string }> } {
  const files: Array<{ name: string; content: string }> = [];
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).filter((name) => name.endsWith(".md") || name.endsWith(".wiki") || name.endsWith(".patch")).sort()) {
      files.push({ name, content: fs.readFileSync(path.join(dir, name), "utf8") });
    }
  }
  // The TC wiki lives in ~/sz/TC<SZ>.wiki per the phase-4 workflow
  // (the human's download directory), not in the state dir.
  const digits = id.replace(/^SZ/i, "");
  const wiki = path.join(packageDir(), `TC${digits}.wiki`);
  if (fs.existsSync(wiki) && !files.some((file) => file.name === `TC${digits}.wiki`)) {
    files.push({ name: `TC${digits}.wiki (~/sz)`, content: fs.readFileSync(wiki, "utf8") });
  }
  return { ready: files.length > 0, files };
}



export function docAt(file: string): { ready: boolean; markdown: string } {
  if (!file || !fs.existsSync(file)) return { ready: false, markdown: "" };
  return { ready: true, markdown: fs.readFileSync(file, "utf8") };
}

export function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
