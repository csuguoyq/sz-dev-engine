import {
  Box,
  Button,
  Divider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { ErrorBoundary } from "../ErrorBoundary";
import { TicketForum } from "../TicketForum";
import { LiveLogPanel } from "./LiveLogPanel";
import { ActionButtons } from "./ActionDialogs";
import { DOC_TABS, type RunDetail } from "../shared";
import { renderMarkdown } from "../markdown";
import { SURFACE, COMMENT_BG } from "../palette";

/**
 * The document tabs widget: the tab strip with the Copy button and the run
 * action buttons, plus the tab content (live log, deliverables, ticket
 * forum, markdown docs). The content is wrapped in an ErrorBoundary so a
 * crash while rendering one document (e.g. a pathological JSON ticket)
 * degrades to a local error instead of white-screening the page.
 */
export function DocTabs({
  tab,
  detail,
  selected,
  stopping,
  onTabChange,
  onCopyText,
  onOpenStop,
  onOpenRetry,
  onOpenMessage,
  onOpenDelete,
  onOpenApprove,
  onOpenReject,
}: {
  tab: string;
  detail: RunDetail;
  selected: string;
  /** Stop request in flight (disables the Stop button and shows its spinner). */
  stopping: boolean;
  onTabChange: (tab: string) => void;
  onCopyText: (text: string, successText: string) => void;
  /** Action-button openers (the dialogs live in App). */
  onOpenStop: () => void;
  onOpenRetry: () => void;
  onOpenMessage: () => void;
  onOpenDelete: () => void;
  onOpenApprove: () => void;
  onOpenReject: () => void;
}) {
  const currentDoc = detail.docs[tab];
  const deliverablesFiles = detail.docs.deliverables?.files;

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1, flexShrink: 0 }}>
        <Tabs
          value={tab}
          onChange={(_, value: string) => onTabChange(value)}
          sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0 } }}
        >
          {Object.entries(DOC_TABS).map(([key, label]) => (
            <Tab key={key} value={key} label={label} />
          ))}
        </Tabs>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, alignItems: "center" }}>
          {tab !== "liveLog" ? (
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                const text =
                  tab === "deliverables"
                    ? (deliverablesFiles ?? []).map((file) => `${file.name}\n${file.content}`).join("\n\n")
                    : currentDoc?.markdown ?? "";
                onCopyText(text, tab === "deliverables" ? "All deliverables copied" : "Content copied to clipboard");
              }}
            >
              Copy
            </Button>
          ) : null}
          <ActionButtons
            status={detail.state.status}
            stopping={stopping}
            messageAvailable={
              detail.state.status === "failed" && (["phase1", "phase2", "phase3", "phase4"] as string[]).includes(detail.state.stage)
            }
            onStop={onOpenStop}
            onRetry={onOpenRetry}
            onMessage={onOpenMessage}
            onDelete={onOpenDelete}
            onApprove={onOpenApprove}
            onReject={onOpenReject}
          />
        </Stack>
      </Box>
      <Divider sx={{ mb: 2, flexShrink: 0 }} />
      <ErrorBoundary>
        <Box sx={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {tab === "liveLog" ? (
            <LiveLogPanel runId={selected} stage={detail.state.stage} />
          ) : tab === "deliverables" ? (
            deliverablesFiles?.length ? (
              <Stack spacing={3}>
                {deliverablesFiles.map((file) => (
                  <Box key={file.name}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        mb: 0.5,
                        width: "fit-content",
                      }}
                    >
                      <Typography variant="subtitle2" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        {file.name}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        sx={{ flexShrink: 0 }}
                        onClick={() => onCopyText(file.content, `${file.name} copied`)}
                      >
                        Copy this file
                      </Button>
                    </Box>
                    <Box
                      component="pre"
                      sx={{
                        bgcolor: SURFACE,
                        p: 1.5,
                        borderRadius: 1,
                        overflow: "auto",
                        maxHeight: "40vh",
                        m: 0,
                        fontSize: 12.5,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {file.content}
                    </Box>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">Deliverables not ready yet</Typography>
            )
          ) : tab === "ticket" ? (
            currentDoc?.ready ? (
              <TicketForum markdown={currentDoc.markdown ?? ""} />
            ) : (
              <Typography color="text.secondary">
                Ticket not fetched yet — phase 1 retrieves it from the softzilla MCP and caches it here.
              </Typography>
            )
          ) : currentDoc?.ready ? (
            <Box
              className="markdown"
              sx={{
                "& h1,& h2,& h3": { mt: 1.5, mb: 1 },
                "& p": { my: 1 },
                "& pre": { bgcolor: COMMENT_BG, p: 1.5, overflow: "auto", borderRadius: 1 },
                "& ul": { pl: 2.5 },
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(currentDoc.markdown ?? "") }}
            />
          ) : (
            <Typography color="text.secondary">Not ready yet</Typography>
          )}
        </Box>
      </ErrorBoundary>
    </Box>
  );
}
