import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { formatLocalDateTime, statusColor, statusLabel, type RunSummary } from "../shared";

const DRAWER_WIDTH = 280;

function DeleteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

/**
 * Left aside listing all runs. The delete button is a sibling of the row
 * button (absolutely positioned on the right), not nested inside it, so the
 * row keeps a single role=button tab stop.
 */
export function RunList({
  runs,
  selectedId,
  loading,
  error,
  onSelect,
  onDelete,
}: {
  runs: RunSummary[];
  selectedId: string | null;
  /** First load still in flight: show a spinner instead of "No runs yet." */
  loading: boolean;
  /** The last list load failed (and there is no data to show). */
  error: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Box
      component="aside"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "auto",
      }}
    >
      <List dense disablePadding>
        {loading ? (
          <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        ) : runs.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography color="text.secondary">{error ? "Could not load the run list." : "No runs yet."}</Typography>
          </Box>
        ) : (
          runs.map((run) => (
            <Box key={run.id} sx={{ position: "relative" }}>
              <ListItemButton
                selected={run.id === selectedId}
                onClick={() => onSelect(run.id)}
                alignItems="flex-start"
                sx={{ gap: 1, pr: 5 }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                      <Typography sx={{ fontWeight: 700 }}>{run.id}</Typography>
                      <Chip size="small" label={statusLabel(run.status)} color={statusColor(run.status)} />
                      {run.genericPack ? (
                        <Tooltip title={`Pack ${run.pack ?? "(unrecorded)"} has no dedicated module adapter — no scope guard or automatic pack check was applied; the gate-4 audit is the only backstop.`}>
                          <Chip size="small" label="⚠ no scope guard" color="warning" variant="outlined" />
                        </Tooltip>
                      ) : null}
                    </Stack>
                  }
                  secondary={formatLocalDateTime(run.startedAt)}
                />
              </ListItemButton>
              {run.status !== "running" && (
                <Tooltip title={`Delete ${run.id}`}>
                  <IconButton
                    className="run-delete"
                    aria-label={`Delete ${run.id}`}
                    size="small"
                    sx={{ position: "absolute", top: 8, right: 4, opacity: 0.5, "&:hover": { opacity: 1 } }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(run.id);
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          ))
        )}
      </List>
    </Box>
  );
}
