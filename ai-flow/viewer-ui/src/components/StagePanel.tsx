import { Box, Chip, List, ListItemButton, ListItemText, Typography } from "@mui/material";
import {
  LABELS,
  STAGES,
  STAGE_TAB,
  formatShortDateTime,
  statusColor,
  statusLabel,
  type StageInfo,
} from "../shared";

/**
 * The six-stage list with status chips. Clicking a stage opens the document
 * tab that shows its artifacts.
 */
export function StagePanel({
  stages,
  tab,
  totalDuration,
  onSelect,
}: {
  stages: Record<string, StageInfo>;
  /** Currently active document tab (marks the matching stage as selected). */
  tab: string;
  totalDuration: string;
  onSelect: (tab: string) => void;
}) {
  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1,
        alignSelf: "stretch",
        overflow: "auto",
        minHeight: 0,
      }}
    >
      <Typography variant="subtitle2" sx={{ px: 1, py: 0.5 }}>
        Stages
        {totalDuration ? (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            total {totalDuration}
          </Typography>
        ) : null}
      </Typography>
      <List dense disablePadding>
        {STAGES.map((name) => {
          const stageState = stages[name];
          const status = stageState?.status ?? "pending";
          const active = tab === STAGE_TAB[name];
          const passedAt = stageState?.finishedAt ? formatShortDateTime(stageState.finishedAt) : null;
          return (
            <ListItemButton
              key={name}
              disableRipple
              onClick={() => onSelect(STAGE_TAB[name])}
              selected={active}
              sx={{ borderRadius: 1, py: 0.75, cursor: "pointer" }}
            >
              <ListItemText
                sx={{ minWidth: 0, mr: 1, my: 0 }}
                primary={
                  <Typography variant="body2">{LABELS[name]}</Typography>
                }
                secondary={
                  passedAt ? (
                    <Typography variant="caption" noWrap sx={{ display: "block", minWidth: 0 }}>
                      {passedAt}
                    </Typography>
                  ) : undefined
                }
              />
              <Chip size="small" label={status === "awaiting_review" ? "Review" : statusLabel(status)} color={statusColor(status)} sx={{ flexShrink: 0 }} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
