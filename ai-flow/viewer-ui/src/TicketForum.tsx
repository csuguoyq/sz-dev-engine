import { useState } from "react";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { JsonView } from "./JsonView";
import { renderFallbackMarkdown } from "./markdown";
import { PRIMARY, SURFACE_ALT, COMMENT_BG } from "./palette";

/**
 * Forum-style renderer for a SoftZilla ticket. The cached ticket body and
 * comments are fetched by the phase-1 agent from the softzilla MCP
 * (`bug_info` / `bug_comments`) and written verbatim into the run state dir.
 * and have a known shape:
 *
 *   bug_info  -> { id, summary, severity, priority, type, platform,
 *                 owner: {email,name}, state, status, keywords }
 *   bug_comments -> [ { user: {email,name}, time, comment(HTML or text) }, ... ]
 *
 * The ticket body is rendered only from an explicit description field when the
 * ticket carries one; all items in bug_comments are rendered uniformly as the
 * comment thread (the first comment is NOT promoted to the post body). Unknown
 * fields are kept in an "Other fields" section so nothing is lost, and the
 * renderer still degrades to plain text if the cached content is not JSON at all.
 */

type Json = unknown;

const TITLE_KEYS = ["summary", "title", "name", "subject", "heading", "topic", "headline"];
const BODY_KEYS = ["description", "long_desc", "longdesc", "detail", "content", "body", "text", "message", "info", "remark"];
const COMMENT_KEYS = ["comments", "comment_list", "commentlist", "replies", "reply_list", "replylist", "bug_comments"];
const COMMENT_AUTHOR_KEYS = ["user", "author", "creator", "owner", "reporter", "name", "nick"];
const COMMENT_BODY_KEYS = ["comment", "content", "body", "text", "message", "description", "detail"];
const COMMENT_TIME_KEYS = ["time", "created", "created_at", "create_time", "comment_time", "updated", "update_time"];

const META_FIELDS: Array<{ keys: string[]; label: string }> = [
  { keys: ["state", "bug_status"], label: "State" },
  { keys: ["status", "resolution"], label: "Resolution" },
  { keys: ["severity", "bug_severity"], label: "Severity" },
  { keys: ["priority"], label: "Priority" },
  { keys: ["type", "bug_class", "category", "kind"], label: "Type" },
  { keys: ["platform", "rep_platform"], label: "Platform" },
  { keys: ["owner", "assigned_to", "assignee"], label: "Assignee" },
  { keys: ["reporter", "creator", "author"], label: "Reporter" },
  { keys: ["keywords"], label: "Keywords" },
  { keys: ["created", "creation_ts", "create_time"], label: "Created" },
  { keys: ["updated", "delta_ts", "modify_time"], label: "Updated" },
];

const SKIP_KEYS = new Set<string>([
  "id",
  ...TITLE_KEYS,
  ...BODY_KEYS,
  ...COMMENT_KEYS,
  ...META_FIELDS.flatMap((f) => f.keys),
]);

function asObject(value: Json): Record<string, Json> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, Json>;
  return null;
}

function findKey(obj: Record<string, Json>, keys: string[]): [string, Json] | null {
  const lower = keys.map((k) => k.toLowerCase());
  for (const [k, v] of Object.entries(obj)) {
    if (lower.includes(k.toLowerCase())) return [k, v];
  }
  return null;
}

/** Unwrap a common envelope (data / result / ticket / ...) when the inner
 *  object carries at least as much as the outer one. */
function unwrap(obj: Record<string, Json>): Record<string, Json> {
  for (const wrapper of ["data", "result", "ticket", "item", "entity", "value", "record"]) {
    const inner = asObject(obj[wrapper]);
    if (inner && Object.keys(inner).length >= Object.keys(obj).length) return inner;
  }
  return obj;
}

function isCommentLike(value: Json): boolean {
  const o = asObject(value);
  if (!o) return false;
  return findKey(o, COMMENT_BODY_KEYS) !== null || findKey(o, COMMENT_AUTHOR_KEYS) !== null;
}

function detectComments(data: Json): Json[] | null {
  if (Array.isArray(data)) {
    return data.length > 0 && data.every(isCommentLike) ? data : null;
  }
  const o = asObject(data);
  if (!o) return null;
  const direct = findKey(o, COMMENT_KEYS);
  if (direct && Array.isArray(direct[1])) return direct[1];
  const inner = unwrap(o);
  if (inner !== o) {
    const nested = findKey(inner, COMMENT_KEYS);
    if (nested && Array.isArray(nested[1])) return nested[1];
  }
  return null;
}

/** Try to extract JSON from text that may be wrapped in a markdown code fence
 *  (with any language tag, e.g. ```json, ```JSON, or no tag) or appear as raw
 *  JSON after a leading heading. */
function extractJson(text: string): Json {
  const trimmed = text.trim();
  if (trimmed && (trimmed[0] === "{" || trimmed[0] === "[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }
  const fence = /```[a-zA-Z]*\s*([\s\S]*?)\s*```/.exec(text);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }
  // Last resort: grab the first balanced-looking object/array.
  const raw = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(text);
  if (raw) {
    try {
      return JSON.parse(raw[1]);
    } catch {
      // fall through
    }
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Turn a possibly-HTML comment body into readable text, preserving newlines. */
function toText(s: string): string {
  if (!/<[a-z!][\s\S]*>/i.test(s)) return s;
  const withBreaks = s
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(withBreaks).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Render a person value ({email,name}) or primitive as a short label. */
function personLabel(value: Json): string | null {
  if (value === null || value === undefined || value === "") return null;
  const o = asObject(value);
  if (o) {
    if (typeof o["name"] === "string" && o["name"]) return o["name"] as string;
    if (typeof o["email"] === "string" && o["email"]) return o["email"] as string;
    return JSON.stringify(o);
  }
  return String(value);
}

function metaValue(value: Json): string | null {
  const label = personLabel(value);
  return label;
}

function stringifyValue(value: Json): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

function commentField(item: Record<string, Json>, keys: string[]): Json | null {
  const found = findKey(item, keys);
  return found ? found[1] : null;
}

function commentText(item: Json): string {
  const o = asObject(item);
  if (!o) return toText(stringifyValue(item));
  const body = commentField(o, COMMENT_BODY_KEYS);
  return body !== null ? toText(String(body)) : stringifyValue(o);
}

function OtherFields({ data }: { data: Record<string, Json> }) {
  const rest = Object.entries(data).filter(([k]) => !SKIP_KEYS.has(k.toLowerCase()));
  const [open, setOpen] = useState(false);
  if (rest.length === 0) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Typography
        component="button"
        onClick={() => setOpen((o) => !o)}
        sx={{
          border: "none",
          background: "none",
          cursor: "pointer",
          color: PRIMARY,
          p: 0,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {open ? "▾" : "▸"} Other fields ({rest.length})
      </Typography>
      {open && (
        <Box sx={{ mt: 1, pl: 1, borderLeft: "2px solid", borderColor: "divider" }}>
          {rest.map(([key, value]) => (
            <Box key={key} sx={{ mb: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
                {key}
              </Typography>
              {typeof value === "object" && value !== null ? (
                <JsonView data={value} />
              ) : (
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {stringifyValue(value)}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function ForumPost({ ticket, comments }: { ticket: Json; comments: Json[] | null }) {
  const obj = asObject(ticket);
  const data = obj ? unwrap(obj) : null;
  if (!data) {
    return (
      <Typography color="text.secondary">Ticket body is not a JSON object — showing raw below.</Typography>
    );
  }

  const id = data["id"] ?? data["key"] ?? data["ticket_id"] ?? data["workitem_id"];
  const titleKey = (() => {
    const found = findKey(data, TITLE_KEYS);
    return found && typeof found[1] === "string" ? found[0] : null;
  })();
  const title = (titleKey ? (data[titleKey] as string) : "") || "Ticket";

  // Body: only an explicit description field (if the ticket carries one).
  // Comments are rendered uniformly in the thread — the first comment is NOT
  // promoted to the post body.
  const descFound = findKey(data, BODY_KEYS.filter((k) => k.toLowerCase() !== titleKey?.toLowerCase()));
  const bodyText = descFound && typeof descFound[1] === "string" ? toText(descFound[1] as string) : null;

  const commentsArray = comments ?? detectComments(data);

  return (
    <Stack spacing={2}>
      <Box sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: PRIMARY, mb: 1 }}>
          {id ? `#${stringifyValue(id)}  ` : ""}
          {title}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mb: bodyText ? 1.5 : 0 }}>
          {META_FIELDS.map((field) => {
            const found = findKey(data, field.keys);
            const value = found ? metaValue(found[1]) : null;
            if (!value) return null;
            return (
              <Chip
                key={field.label}
                size="small"
                variant="outlined"
                sx={{ borderColor: "divider", color: "text.secondary" }}
                label={
                  <span>
                    <Typography component="strong" sx={{ color: "text.primary" }}>
                      {field.label}:
                    </Typography>{" "}
                    {value}
                  </span>
                }
              />
            );
          })}
        </Stack>

        {bodyText && (
          <Box sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 14, lineHeight: 1.7, color: "text.primary" }}>
            {bodyText}
          </Box>
        )}

        <OtherFields data={data} />
      </Box>

      {commentsArray && commentsArray.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Comments ({commentsArray.length})
          </Typography>
          <Stack spacing={1.5}>
            {commentsArray.map((raw, index) => {
              const item = asObject(raw);
              if (!item) {
                return (
                  <Box key={index} sx={{ p: 1.5, borderLeft: `3px solid ${PRIMARY}`, bgcolor: SURFACE_ALT, borderRadius: 1 }}>
                    <JsonView data={raw} />
                  </Box>
                );
              }
              const author = personLabel(commentField(item, COMMENT_AUTHOR_KEYS));
              const timeLabel = commentField(item, COMMENT_TIME_KEYS) ? stringifyValue(commentField(item, COMMENT_TIME_KEYS)) : null;
              const text = commentText(item);
              return (
                <Box key={index} sx={{ p: 1.5, borderLeft: `3px solid ${PRIMARY}`, bgcolor: SURFACE_ALT, borderRadius: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "baseline" }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {author ?? `Comment ${index + 1}`}
                    </Typography>
                    {timeLabel !== null && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {timeLabel}
                      </Typography>
                    )}
                  </Stack>
                  <Box sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13.5, lineHeight: 1.6 }}>
                    {text}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

export function TicketForum({ markdown }: { markdown: string }) {
  const marker = "## Comments";
  const index = markdown.indexOf(marker);
  const bodyText = index >= 0 ? markdown.slice(0, index) : markdown;
  const commentsText = index >= 0 ? markdown.slice(index + marker.length) : "";

  const bodyJson = extractJson(bodyText);
  const commentsJson = extractJson(commentsText);

  if (bodyJson === null && !commentsText.trim()) {
    // Not JSON at all — fall back to rendered markdown so we never lose content.
    return (
      <Box
        className="markdown"
        sx={{
          "& h1,& h2,& h3": { mt: 1.5, mb: 1 },
          "& p": { my: 1 },
          "& pre": { bgcolor: COMMENT_BG, p: 1.5, overflow: "auto", borderRadius: 1 },
          "& ul": { pl: 2.5 },
        }}
        dangerouslySetInnerHTML={{ __html: renderFallbackMarkdown(markdown) }}
      />
    );
  }

  // The cached ticket-comments.md is the verbatim bug_comments output, which
  // may be a bare array OR an object wrapper (e.g. {"bug_comments":[...]}).
  // A bare array is used directly; otherwise fall back to comment detection
  // so a wrapped object still yields the thread instead of silently vanishing.
  const commentsArg = Array.isArray(commentsJson) ? commentsJson : detectComments(commentsJson);
  return (
    <Stack spacing={2}>
      {bodyText.trim() ? (
        <Box
          className="markdown"
          sx={{
            "& h1,& h2,& h3": { mt: 1.5, mb: 1 },
            "& p": { my: 1 },
            "& pre": { bgcolor: "#f0f2f5", p: 1.5, overflow: "auto", borderRadius: 1 },
            "& ul": { pl: 2.5 },
          }}
          dangerouslySetInnerHTML={{ __html: renderFallbackMarkdown(bodyText) }}
        />
      ) : null}
      {bodyJson !== null ? <ForumPost ticket={bodyJson} comments={commentsArg} /> : null}
      {commentsArg === null && commentsText.trim() ? (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Comments
          </Typography>
          <Box
            className="markdown"
            sx={{
              "& h1,& h2,& h3": { mt: 1.5, mb: 1 },
              "& p": { my: 1 },
              "& pre": { bgcolor: "#f0f2f5", p: 1.5, overflow: "auto", borderRadius: 1 },
            }}
            dangerouslySetInnerHTML={{ __html: renderFallbackMarkdown(commentsText) }}
          />
        </Box>
      ) : null}
    </Stack>
  );
}
