import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import { apiFetch, downloadUrl, onUnauthorized, prefillTokenFromUrl, setStoredToken } from "./api";
import { useActionDialog } from "./useActionDialog";
import { McpDialog } from "./McpDialog";
import { CreateDialog } from "./components/CreateDialog";
import { ErrorBoundary } from "./ErrorBoundary";
import { RunList } from "./components/RunList";
import { RunBanner } from "./components/RunBanner";
import { StagePanel } from "./components/StagePanel";
import { DocTabs } from "./components/DocTabs";
import { StatusBar } from "./components/StatusBar";
import {
  ApproveDialog,
  DeleteDialog,
  MessageDialog,
  RejectDialog,
  RetryDialog,
  StopDialog,
} from "./components/ActionDialogs";
import {
  LABELS,
  STAGES,
  copyToClipboard,
  type RunDetail,
  type RunSummary,
  type ReworkStage,
  type Stage,
} from "./shared";
import { PRIMARY } from "./palette";

export default function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get("run"));
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState("liveLog");
  const [mcpOpen, setMcpOpen] = useState(false);
  const [ticketId, setTicketId] = useState("SZ");
  const [taskModel, setTaskModel] = useState("");
  const [approveAnswer, setApproveAnswer] = useState("");
  const [rejectStage, setRejectStage] = useState<ReworkStage>("phase2");
  const [rejectComment, setRejectComment] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [messageComment, setMessageComment] = useState("");
  // One open/busy/error/lock quad per run action (see useActionDialog).
  const createAction = useActionDialog();
  const retryAction = useActionDialog();
  const approveAction = useActionDialog();
  const rejectAction = useActionDialog();
  const stopAction = useActionDialog();
  const messageAction = useActionDialog();
  const deleteAction = useActionDialog();
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  /** Monotonic request sequence: a refresh's responses are ignored once a newer refresh has started. */
  const seqRef = useRef(0);
  const loadedForRef = useRef<string | null>(null);

  /**
   * Primitive view of the detail object: the workspace dir for the status
   * bar. With this stable value driving child pollers the timers keep their
   * nominal cadence instead of being recreated by every 3s detail poll.
   */
  const workspace = detail?.state.szdev?.workspace ?? "";

  const selectRun = useCallback((id: string) => {
    setSelected(id);
    history.replaceState(null, "", `?run=${encodeURIComponent(id)}`);
  }, []);

  /**
   * One sequenced refresh for both the runs list and the selected run's
   * detail: the sequence number captured at the start is checked before any
   * state write, so a slow response can never overwrite newer data.
   */
  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const response = await apiFetch("/api/runs");
      if (!response.ok) throw new Error(`runs list request failed (${response.status})`);
      const body = (await response.json()) as { runs: RunSummary[] };
      if (seq === seqRef.current) {
        setRuns(body.runs);
        setListState("ready");
      }
    } catch (err) {
      if (seq !== seqRef.current) return;
      setListState("error");
      setToast({ kind: "error", text: err instanceof Error ? `Could not load runs: ${err.message}` : "Could not load runs." });
    }
    if (!selected) {
      if (seq === seqRef.current) {
        loadedForRef.current = null;
        setDetail(null);
        setDetailError(null);
      }
      return;
    }
    try {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(selected)}`);
      if (seq !== seqRef.current) return;
      if (!response.ok) {
        setDetail(null);
        setDetailError(`Could not load ${selected} (${response.status}).`);
        setToast({ kind: "error", text: `Could not load ${selected} (${response.status}).` });
        return;
      }
      const body = (await response.json()) as RunDetail;
      if (seq !== seqRef.current) return;
      setDetail(body);
      setDetailError(null);
      // Default the tab only when switching to a different run — never on
      // the polling refresh, which must not fight the user's tab choice.
      // Live agent output while running; the audit packet once stopped.
      if (loadedForRef.current !== selected) {
        loadedForRef.current = selected;
        setTab(body.state.status === "running" ? "liveLog" : "handoff");
      }
    } catch (err) {
      if (seq !== seqRef.current) return;
      const message = err instanceof Error ? `Could not load ${selected}: ${err.message}` : `Could not load ${selected}.`;
      setDetailError(message);
      setToast({ kind: "error", text: message });
    }
  }, [selected]);

  useEffect(() => {
    void refresh();
    // Skip ticks while the tab is hidden: a backgrounded page has no reason
    // to hold the API to a 3s cadence (the next visible tick catches up).
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Token auth (ui.token on the server): remember ?token= from the initial
  // URL, and surface a 401 as a prompt instead of a dead page.
  useEffect(() => {
    prefillTokenFromUrl();
    const unsubscribe = onUnauthorized(() => setTokenOpen(true));
    return unsubscribe;
  }, []);

  // Toasts are dismissible and also disappear on their own after ~6s.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const createTask = useCallback(async () => {
    await createAction.run(async ({ fail, done }) => {
      const response = await apiFetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: ticketId.trim(), model: taskModel.trim() }),
      });
      const body = (await response.json().catch(() => ({ error: "Could not parse the response" }))) as {
        id?: string;
        error?: string;
        started?: boolean;
      };
      if (!response.ok) {
        fail(body.error || `Failed to start (${response.status})`);
        return;
      }
      if (body.started === false) {
        fail(body.error || "The run did not start. Check the agent command and its configuration.");
        return;
      }
      done();
      setTicketId("SZ");
      if (body.id) {
        selectRun(body.id);
        setToast({ kind: "success", text: `${body.id} started${taskModel.trim() ? ` with ${taskModel.trim()}` : ""}` });
      }
      await refresh();
    });
  }, [createAction, ticketId, taskModel, selectRun, refresh]);

  const retryTask = useCallback(async () => {
    if (!selected || !detail || detail.state.status !== "failed") return;
    await retryAction.run(async ({ fail, done }) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const response = await apiFetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selected }),
      });
      const body = (await response.json().catch(() => ({ error: "Could not parse the response" }))) as {
        id?: string;
        error?: string;
        started?: boolean;
      };
      if (!response.ok) {
        fail(body.error || `Retry failed (${response.status})`);
        return;
      }
      if (body.started === false) {
        fail(body.error || "The run did not start. Check the agent command and its configuration.");
        return;
      }
      const stageName = LABELS[detail.state.stage as Stage] ?? detail.state.stage;
      done();
      setToast({ kind: "success", text: `${selected} resumed from ${stageName}` });
      await refresh();
    });
  }, [selected, detail, retryAction, refresh]);

  const approveTask = useCallback(async () => {
    if (!selected || !detail || detail.state.status !== "awaiting_review") return;
    const kind = detail.state.awaiting?.kind ?? "gate4";
    await approveAction.run(async ({ fail, done }) => {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(selected)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", comment: approveAnswer.trim() }),
      });
      const body = (await response.json().catch(() => ({ error: "Could not parse the response" }))) as { error?: string };
      if (!response.ok) {
        fail(body.error || `Approve failed (${response.status})`);
        return;
      }
      done();
      if (kind === "gate4") {
        const link = document.createElement("a");
        // Plain navigation (no headers possible): the token rides the query.
        link.href = downloadUrl(`/api/runs/${encodeURIComponent(selected)}/package`);
        link.click();
        setToast({ kind: "success", text: `${selected} approved (gate 4). The package downloads started. Submit it manually.` });
      } else {
        setToast({ kind: "success", text: `${selected} continues with your answer injected.` });
      }
      await refresh();
    });
  }, [selected, detail, approveAction, approveAnswer, refresh]);

  const rejectTask = useCallback(async () => {
    if (!selected || !detail || detail.state.status !== "awaiting_review") return;
    const comment = rejectComment.trim();
    if (!comment) {
      rejectAction.fail("Enter a comment");
      return;
    }
    await rejectAction.run(async ({ fail, done }) => {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(selected)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "reject", stage: rejectStage, comment }),
      });
      const body = (await response.json().catch(() => ({ error: "Could not parse the response" }))) as { error?: string };
      if (!response.ok) {
        fail(body.error || `Reject failed (${response.status})`);
        return;
      }
      const stageName = LABELS[rejectStage];
      done();
      setRejectComment("");
      setToast({ kind: "success", text: `${selected} will rerun from ${stageName}` });
      await refresh();
    });
  }, [selected, detail, rejectAction, rejectComment, rejectStage, refresh]);

  const stopTask = useCallback(async () => {
    if (!selected) return;
    await stopAction.run(async ({ done }) => {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(selected)}/stop`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        // StopDialog has no error slot; surface via toast, dialog stays open.
        setToast({ kind: "error", text: body.error || `Stop failed (${response.status})` });
        return;
      }
      done();
      setToast({ kind: "success", text: `${selected} stopped. Retry resumes from the interrupted stage; Delete removes it.` });
      await refresh();
    });
  }, [selected, stopAction, refresh]);

  const messageTask = useCallback(async () => {
    if (!selected || !detail || detail.state.status !== "failed") return;
    const comment = messageComment.trim();
    if (!comment) {
      messageAction.fail("Enter a message");
      return;
    }
    await messageAction.run(async ({ fail, done }) => {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(selected)}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const body = (await response.json().catch(() => ({ error: "Could not parse the response" }))) as {
        error?: string;
        resumedFrom?: string;
      };
      if (!response.ok) {
        fail(body.error || `Message failed (${response.status})`);
        return;
      }
      const stageName = body.resumedFrom ?? detail.state.stage;
      done();
      setMessageComment("");
      setToast({ kind: "success", text: `Message sent; run resumed from ${stageName}` });
      await refresh();
    });
  }, [selected, detail, messageAction, messageComment, refresh]);

  const deleteTask = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteAction.run(async ({ fail, done }) => {
      const response = await apiFetch(`/api/runs/${encodeURIComponent(deleteTarget)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({ error: "Could not parse the response" }))) as { error?: string };
      if (!response.ok) {
        fail(body.error || `Delete failed (${response.status})`);
        return;
      }
      const removed = deleteTarget;
      done();
      setDeleteTarget(null);
      if (removed === selected) {
        setSelected(null);
        setDetail(null);
        history.replaceState(null, "", location.pathname);
      }
      setToast({ kind: "success", text: `${removed} deleted` });
      await refresh();
    });
  }, [deleteTarget, deleteAction, selected, refresh]);

  const copyText = useCallback((text: string, successText: string) => {
    void copyToClipboard(text).then((ok) => {
      setToast(ok
        ? { kind: "success", text: successText }
        : { kind: "error", text: "Copy failed — select the text and press Ctrl+C" });
    });
  }, []);

  const openDeleteDialog = useCallback(
    (id: string) => {
      setDeleteTarget(id);
      deleteAction.openDialog();
    },
    [deleteAction],
  );

  const totalDuration = useMemo(() => {
    if (!detail) return "";
    const stages = Object.values(detail.state.stages);
    const start = stages.map((stage) => stage.startedAt).filter(Boolean).sort()[0];
    const end = stages.map((stage) => stage.finishedAt).filter(Boolean).sort().at(-1);
    if (!start || !end) return "";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (!(ms > 0)) return "";
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
  }, [detail]);
  const deleteRunSummary = deleteTarget ? runs.find((run) => run.id === deleteTarget) : undefined;
  const failedStageLabel = LABELS[detail?.state.stage as Stage] ?? detail?.state.stage ?? "the failed stage";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "background.default" }}>
      <AppBar
        position="static"
        elevation={0}
        color="inherit"
        sx={{ borderBottom: 2, borderColor: PRIMARY, flexShrink: 0, bgcolor: "#ffffff" }}
      >
        <Toolbar sx={{ gap: 2, minHeight: 56 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" component="h1" sx={{ color: PRIMARY, fontWeight: 700 }}>
              ai-flow
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Local progress. You can create a task and download a package when one exists. After approval, a person submits the change.
            </Typography>
          </Box>
          <Button variant="outlined" sx={{ fontWeight: 600 }} onClick={() => setMcpOpen(true)}>
            Manage MCP
          </Button>
          <Button
            variant="contained"
            sx={{ fontWeight: 700 }}
            onClick={() => {
              setTicketId("SZ");
              createAction.openDialog();
            }}
          >
            Create task
          </Button>
        </Toolbar>
      </AppBar>

      <ErrorBoundary>
        <Box sx={{ display: "flex", flex: 1, minHeight: 0, width: "100%" }}>
          <RunList
            runs={runs}
            selectedId={selected}
            loading={listState === "loading" && runs.length === 0}
            error={listState === "error"}
            onSelect={selectRun}
            onDelete={openDeleteDialog}
          />

          <Box component="main" sx={{ flex: 1, minWidth: 0, p: 2, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {toast ? (
              <Alert severity={toast.kind} sx={{ mb: 2 }} onClose={() => setToast(null)}>
                {toast.text}
              </Alert>
            ) : null}

            {!selected || !detail ? (
              !selected ? (
                <Typography color="text.secondary">Select a run.</Typography>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1 }}>
                  <CircularProgress size={20} />
                  <Typography color="text.secondary">
                    {detailError ? detailError : `Loading ${selected}…`}
                  </Typography>
                </Box>
              )
            ) : (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "280px 1fr" },
                  gridTemplateRows: "auto 1fr",
                  gap: 2,
                  flex: 1,
                  minHeight: 0,
                  alignItems: "stretch",
                }}
              >
                <RunBanner detail={detail} selected={selected} />

                {detail.state.test?.skipped?.length ? (
                  <Box component="ul" sx={{ gridColumn: "1 / -1", m: 0, pl: 2.5 }}>
                    {detail.state.test.skipped.map((item) => (
                      <li key={item}>
                        <Typography variant="body2">{item}</Typography>
                      </li>
                    ))}
                  </Box>
                ) : null}

                <StagePanel stages={detail.state.stages} tab={tab} totalDuration={totalDuration} onSelect={setTab} />

                <DocTabs
                  tab={tab}
                  detail={detail}
                  selected={selected}
                  stopping={stopAction.busy}
                  onTabChange={setTab}
                  onCopyText={copyText}
                  onOpenStop={() => stopAction.openDialog()}
                  onOpenRetry={() => retryAction.openDialog()}
                  onOpenMessage={() => {
                    setMessageComment("");
                    messageAction.openDialog();
                  }}
                  onOpenDelete={() => openDeleteDialog(selected)}
                  onOpenApprove={() => approveAction.openDialog()}
                  onOpenReject={() => rejectAction.openDialog()}
                />
              </Box>
            )}
          </Box>
        </Box>
      </ErrorBoundary>

      <StatusBar detail={detail} workspace={workspace} runCount={runs.length} />

      <CreateDialog
        open={createAction.open}
        ticketId={ticketId}
        taskModel={taskModel}
        creating={createAction.busy}
        createError={createAction.error}
        onClose={() => createAction.close()}
        onTicketIdChange={setTicketId}
        onTaskModelChange={setTaskModel}
        onStart={() => void createTask()}
      />

      <McpDialog open={mcpOpen} onClose={() => setMcpOpen(false)} />

      <RetryDialog
        open={retryAction.open}
        busy={retryAction.busy}
        error={retryAction.error}
        runId={selected}
        stageLabel={failedStageLabel}
        onClose={() => retryAction.close()}
        onConfirm={() => void retryTask()}
      />

      <ApproveDialog
        open={approveAction.open}
        busy={approveAction.busy}
        error={approveAction.error}
        awaitingKind={detail?.state.awaiting?.kind ?? null}
        runId={selected}
        answer={approveAnswer}
        onAnswerChange={setApproveAnswer}
        onClose={() => approveAction.close()}
        onConfirm={() => void approveTask()}
      />

      <RejectDialog
        open={rejectAction.open}
        busy={rejectAction.busy}
        error={rejectAction.error}
        stage={rejectStage}
        comment={rejectComment}
        onStageChange={setRejectStage}
        onCommentChange={setRejectComment}
        onClose={() => rejectAction.close()}
        onConfirm={() => void rejectTask()}
      />

      <StopDialog
        open={stopAction.open}
        busy={stopAction.busy}
        runId={selected}
        onClose={() => stopAction.close()}
        onConfirm={() => void stopTask()}
      />

      <DeleteDialog
        open={deleteAction.open}
        busy={deleteAction.busy}
        error={deleteAction.error}
        target={deleteTarget}
        running={deleteRunSummary?.status === "running"}
        onClose={() => deleteAction.close()}
        onConfirm={() => void deleteTask()}
      />

      <MessageDialog
        open={messageAction.open}
        busy={messageAction.busy}
        error={messageAction.error}
        runId={selected}
        stageLabel={failedStageLabel}
        comment={messageComment}
        onCommentChange={setMessageComment}
        onClose={() => messageAction.close()}
        onConfirm={() => void messageTask()}
      />

      <Dialog open={tokenOpen} onClose={() => setTokenOpen(false)} maxWidth="xs">
        <DialogTitle>Viewer token required</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This viewer is protected. Enter the token from <code>ai-flow.config.json</code> (the{" "}
            <code>ui.token</code> field). It is kept in this browser tab only (sessionStorage) and
            never sent anywhere but this viewer.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            type="password"
            label="Token"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && tokenInput.trim()) {
                setStoredToken(tokenInput.trim());
                setTokenOpen(false);
                setTokenInput("");
                void refresh();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTokenOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!tokenInput.trim()}
            onClick={() => {
              setStoredToken(tokenInput.trim());
              setTokenOpen(false);
              setTokenInput("");
              void refresh();
            }}
          >
            Save and continue
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
