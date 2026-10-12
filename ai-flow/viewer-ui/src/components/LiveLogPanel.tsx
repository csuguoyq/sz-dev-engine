import { apiFetch, downloadUrl } from "../api";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Link,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";
import { LABELS, STAGES, type Stage } from "../shared";
import { LOG_BG, LOG_FG } from "../palette";
// The structured stream events come from the server-side formatter
// (type-only import: erased at compile time, no runtime coupling).
import type { StreamEvent } from "../../../src/streamFormat";

function ToolRow({ event }: { event: Extract<StreamEvent, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const statusColor = event.status === "FAILED" ? "#ff8a80" : event.status ? "#8fd694" : "#e0b05e";
  const statusText = event.status ? ` → ${event.status}${event.ms ? ` (${(event.ms / 1000).toFixed(1)}s)` : ""}` : " → no result yet";
  return (
    <Box component="div" sx={{ fontSize: 12.5 }}>
      <Box
        component="div"
        onClick={() => event.input && setOpen((v) => !v)}
        sx={{ cursor: event.input ? "pointer" : "default", display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }}
      >
        <Typography component="span" sx={{ color: "#c792ea", fontSize: 12.5, whiteSpace: "nowrap" }}>
          {event.input ? (open ? "▾" : "▸") : "·"} tool: {event.name}
        </Typography>
        <Typography component="span" sx={{ color: "#d5dbe1", fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1, minWidth: 0 }}>
          {event.summary}
          <Typography component="span" sx={{ color: statusColor }}>{statusText}</Typography>
        </Typography>
      </Box>
      {open && event.input ? (
        <Typography component="pre" sx={{ m: 0.5, pl: 3, color: "#aeb8c4", fontSize: 11.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {event.input}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * How many most-recent events StreamEventsView renders. The full event list
 * is unbounded for a long phase (hundreds of tool calls); rendering every
 * row on every 2s poll would grow the DOM and re-layout cost without bound.
 * The tail is what a live reader needs; the complete history is always
 * available in the full-log download.
 */
const MAX_RENDERED_EVENTS = 400;

function StreamEventsView({ events }: { events: StreamEvent[] }) {
  const total = events.length;
  const shown = total > MAX_RENDERED_EVENTS ? events.slice(total - MAX_RENDERED_EVENTS) : events;
  return (
    <Box component="div" sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      {total > shown.length ? (
        <Typography sx={{ color: "#7a8699", fontSize: 12 }}>
          … showing the last {shown.length} of {total} events (older history is in the full-log download) …
        </Typography>
      ) : null}
      {shown.map((event, index) => {
        if (event.kind === "step")
          return (
            <Typography key={index} sx={{ color: "#7a8699", fontSize: 12, mt: 1 }}>
              ── step {event.n} ──
            </Typography>
          );
        if (event.kind === "user")
          return (
            <Typography key={index} sx={{ color: "#9ecbff", fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              [user] {event.text}
            </Typography>
          );
        if (event.kind === "thinking")
          return (
            <Typography key={index} sx={{ color: "#8b93a7", fontSize: 12, fontStyle: "italic", whiteSpace: "pre-wrap", wordBreak: "break-word", borderLeft: "2px solid #333c4d", pl: 1 }}>
              {event.text}
              {event.complete ? "" : " …"}
            </Typography>
          );
        if (event.kind === "assistant")
          return (
            <Typography key={index} sx={{ color: "#d5dbe1", fontSize: 12.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {event.text}
              {event.complete ? "" : " …"}
            </Typography>
          );
        if (event.kind === "tool") return <ToolRow key={index} event={event} />;
        if (event.kind === "turn")
          return (
            <Typography key={index} sx={{ color: "#8fd694", fontSize: 12 }}>
              [turn completed] {event.text}
              {event.tokens ? ` · tokens: ${event.tokens}` : ""}
            </Typography>
          );
        return (
          <Typography key={index} sx={{ color: "#d5dbe1", fontSize: 12 }}>
            {event.text}
          </Typography>
        );
      })}
    </Box>
  );
}

/**
 * Live log view: the current stage's agent output (2s poll, walking backwards
 * to the newest earlier stage that has a log). Earlier stages stay reachable
 * through the stage selector, which pins the view to one stage's log.
 *
 * The polling effect lives here and depends on PRIMITIVE props only
 * (runId, stage), so the timer is created once per real change and keeps its
 * nominal cadence — it is not recreated by the parent's 3s detail poll.
 */
export function LiveLogPanel({
  runId,
  stage,
}: {
  runId: string;
  /** The run's current stage (drives the log walk-back). */
  stage: string;
}) {
  const [liveLog, setLiveLog] = useState<{ exists: boolean; content: string; stage: string; truncated: boolean; events?: StreamEvent[] }>({ exists: false, content: "", stage: "", truncated: false });
  const [autoScroll, setAutoScroll] = useState(true);
  // null = follow the run's current stage; a stage name pins the view.
  const [pinnedStage, setPinnedStage] = useState<Stage | null>(null);
  const logBoxRef = useRef<HTMLPreElement | null>(null);
  /** One fetch at a time: a slow response never piles up overlapping requests. */
  const liveLogInFlightRef = useRef(false);

  useEffect(() => {
    if (!runId || !stage) return;
    let cancelled = false;
    const load = async () => {
      if (liveLogInFlightRef.current) return;
      liveLogInFlightRef.current = true;
      try {
        // A picked stage (the selector) wins; otherwise follow the current
        // stage, falling back to the newest earlier stage that has one.
        const order =
          pinnedStage !== null
            ? [pinnedStage]
            : STAGES.slice(0, STAGES.indexOf(stage as Stage) + 1).reverse();
        for (const s of order) {
          const response = await apiFetch(`/api/runs/${encodeURIComponent(runId)}/logs/${s}`);
          if (!response.ok || cancelled) return;
          const body = (await response.json()) as { exists: boolean; content: string; truncated?: boolean; events?: StreamEvent[] };
          if (!body.exists) continue;
          setLiveLog({
            exists: true,
            stage: s,
            truncated: Boolean(body.truncated),
            events: body.events,
            content: body.content.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, ""),
          });
          return;
        }
        setLiveLog({ exists: false, stage: order[0] ?? stage, content: "", truncated: false });
      } catch {
        // keep the last content; the next tick retries
      } finally {
        liveLogInFlightRef.current = false;
      }
    };
    void load();
    // Skip ticks while the tab is hidden (backgrounded page, no live reader).
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, stage, pinnedStage]);

  useEffect(() => {
    if (!autoScroll) return;
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [liveLog, autoScroll]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          Agent activity for <strong>{LABELS[liveLog.stage as Stage] ?? liveLog.stage}</strong>. Auto-refreshes.
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Stage log:
          </Typography>
          <Select
            size="small"
            value={pinnedStage ?? "following"}
            onChange={(event) => setPinnedStage(event.target.value === "following" ? null : (event.target.value as Stage))}
            sx={{ fontSize: 13, minWidth: 190 }}
          >
            <MenuItem value="following">Following (current stage)</MenuItem>
            {STAGES.map((stage) => (
              <MenuItem key={stage} value={stage}>
                {LABELS[stage as Stage] ?? stage}
              </MenuItem>
            ))}
          </Select>
        </Box>
      </Box>
      {liveLog.truncated ? (
        <Alert
          severity="info"
          sx={{ mb: 1 }}
          action={
            <Button
              component={Link}
              href={downloadUrl(`/api/runs/${encodeURIComponent(runId)}/full-log`)}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              variant="outlined"
            >
              Download complete log
            </Button>
          }
        >
          This stage&apos;s log exceeds 256&nbsp;KB; only the most recent portion is shown. Download the complete run log (all stages) for the full output.
        </Alert>
      ) : null}
      <Box sx={{ position: "relative" }}>
        <Box
          component="pre"
          ref={logBoxRef}
          role="log"
          aria-live="polite"
          onWheel={(event) => {
            // User intent: any upward wheel movement stops
            // following immediately — content refreshes must
            // never fight the user's scroll.
            if (event.deltaY < 0) setAutoScroll(false);
          }}
          onScroll={(event) => {
            // Pin/unpin by position, whatever input caused the scroll
            // (wheel, scrollbar drag, keyboard): leave the bottom → stop
            // following and hold the view; return to the bottom → resume.
            const box = event.currentTarget;
            const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
            if (autoScroll && !atBottom) setAutoScroll(false);
            else if (!autoScroll && atBottom) setAutoScroll(true);
          }}
          sx={{
            bgcolor: LOG_BG,
            color: LOG_FG,
            p: 1.5,
            borderRadius: 1,
            overflow: "auto",
            maxHeight: "60vh",
            m: 0,
            fontSize: 12.5,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {liveLog.exists ? (
            liveLog.events && liveLog.events.length > 0 ? (
              <StreamEventsView events={liveLog.events} />
            ) : (
              liveLog.content
            )
          ) : (
            "No log output yet for this stage."
          )}
        </Box>
        {!autoScroll ? (
          <Tooltip title="Resume following the newest output">
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                setAutoScroll(true);
                const box = logBoxRef.current;
                if (box) box.scrollTop = box.scrollHeight;
              }}
              sx={{ position: "absolute", bottom: 12, right: 16 }}
            >
              ↓ Follow
            </Button>
          </Tooltip>
        ) : null}
      </Box>
    </Box>
  );
}
