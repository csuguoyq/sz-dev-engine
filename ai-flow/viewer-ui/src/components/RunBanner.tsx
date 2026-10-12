import { Alert, Box, Button, Chip, Link, Typography } from "@mui/material";
import { downloadUrl } from "../api";
import { LABELS, statusColor, statusLabel, type RunDetail, type Stage } from "../shared";

/**
 * Top strip of the run detail: test-result chip, package download, and the
 * failure / escalation alerts.
 */
export function RunBanner({ detail, selected }: { detail: RunDetail; selected: string }) {
  const testVerdict = detail.state.test?.verdict;
  return (
    <Box
      sx={{
        gridColumn: "1 / -1",
        display: "flex",
        flexWrap: "wrap",
        gap: 2,
        alignItems: "center",
        justifyContent: "space-between",
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        px: 2,
        py: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", minHeight: 32 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ display: "flex", alignItems: "center", m: 0 }}>
          Test result
        </Typography>
        <Chip label={testVerdict ? statusLabel(testVerdict) : "Not tested yet"} color={statusColor(testVerdict ?? "pending")} />
        {detail.state.artifacts?.package ? (
          <Button component={Link} href={downloadUrl(`/api/runs/${encodeURIComponent(selected)}/package`)} underline="none" variant="outlined" size="small">
            Download package
          </Button>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Package not ready
          </Typography>
        )}
      </Box>
      {detail.genericPack ? (
        <Alert severity="warning" sx={{ flex: "1 1 280px", py: 0 }}>
          Pack <strong>{detail.state.szdev?.pack ?? "(none recorded)"}</strong> has no dedicated module adapter: no scope
          guard and no automatic pack check were applied to this run. The gate-4 audit is the ONLY backstop that the
          change is limited to what it should be — review the full diff at gate 4 with extra care.
        </Alert>
      ) : null}
      {detail.state.error ? (
        <Alert severity="error" sx={{ flex: "1 1 280px", py: 0 }}>
          Failed at {LABELS[detail.state.stage as Stage] ?? detail.state.stage}: {detail.state.error}
        </Alert>
      ) : null}
      {detail.state.awaiting && detail.state.awaiting.kind !== "gate4" ? (
        <Alert severity="warning" sx={{ flex: "1 1 280px", py: 0 }}>
          {detail.state.awaiting.kind === "clarification" ? "Clarification needed" : "Escalation"}{" "}
          {detail.state.awaiting.code ?? ""} — see the Clarifications tab and answer via Approve.
        </Alert>
      ) : null}
    </Box>
  );
}
