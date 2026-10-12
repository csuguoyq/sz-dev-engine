import { apiFetch } from "../api";
import { useEffect, useRef, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { shownModel, type AgentStatus, type RunDetail } from "../shared";
import { PRIMARY, DARK } from "../palette";

/**
 * Bottom status bar: the configured agent, its model, the live session's
 * token counters and the run count. It polls /api/agent-status itself (3s,
 * keyed on the run's workspace directory — a primitive dep, so the timer
 * keeps its nominal cadence and there is no fetch at all without a workspace).
 */
export function StatusBar({
  detail,
  workspace,
  runCount,
}: {
  detail: RunDetail | null;
  workspace: string;
  runCount: number;
}) {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ dir: "", agent: null, session: null, model: null, label: null });
  /** One fetch at a time: a slow response never piles up overlapping requests. */
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const load = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        try {
          const response = await apiFetch(`/api/agent-status?dir=${encodeURIComponent(workspace)}`);
          if (!response.ok || cancelled) return;
          setAgentStatus((await response.json()) as AgentStatus);
        } catch {
          // status bar is best effort
        }
      } finally {
        inFlightRef.current = false;
      }
    };
    void load();
    // Skip ticks while the tab is hidden: the token counters are a live
    // nicety, not a reason to poll from a backgrounded page.
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workspace]);

  return (
    <Box
      sx={{
        flexShrink: 0,
        borderTop: 2,
        borderColor: PRIMARY,
        bgcolor: "#ffffff",
        color: DARK,
        px: 2,
        py: 0.75,
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
      }}
    >
      <Typography variant="caption" sx={{ color: PRIMARY, fontWeight: 700 }}>
        Agent
      </Typography>
      {agentStatus.label ? <Chip size="small" label={agentStatus.label} color="primary" variant="outlined" /> : null}
      <Chip size="small" label={shownModel(detail, agentStatus)} color="primary" variant="outlined" />
      {agentStatus.session?.agent ? <Chip size="small" label={`agent: ${agentStatus.session.agent}`} variant="outlined" color="primary" /> : null}
      {agentStatus.session?.model && typeof agentStatus.session.model === "object" && (agentStatus.session.model as { variant?: string }).variant ? (
        <Chip
          size="small"
          variant="outlined"
          label={`thinking: ${(agentStatus.session.model as { variant?: string }).variant}`}
          color="primary"
        />
      ) : null}
      {agentStatus.session ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <span>
            context in: <strong>{(agentStatus.session.input ?? 0).toLocaleString()}</strong>
          </span>
          <span>
            cache read: <strong>{(agentStatus.session.cacheRead ?? 0).toLocaleString()}</strong>
          </span>
          <span>
            out: <strong>{(agentStatus.session.output ?? 0).toLocaleString()}</strong>
          </span>
          <span>
            reasoning: <strong>{(agentStatus.session.reasoning ?? 0).toLocaleString()}</strong>
          </span>
          {agentStatus.session.slug ? <span>session: {agentStatus.session.slug}</span> : null}
        </Typography>
      ) : null}
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.secondary">
        {runCount} run{runCount === 1 ? "" : "s"}
      </Typography>
    </Box>
  );
}
