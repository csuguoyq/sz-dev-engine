import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { REWORK_STAGES, type ReworkStage } from "../shared";

/**
 * The run action buttons shown next to the document tabs. Which buttons
 * appear depends on the run status; Stop and Delete (for a failed run) and
 * every mutating action go through a confirmation dialog (see below).
 */
export function ActionButtons({
  status,
  stopping,
  messageAvailable,
  onStop,
  onRetry,
  onMessage,
  onDelete,
  onApprove,
  onReject,
}: {
  status: string;
  stopping: boolean;
  /** True when the failed stage can carry a message (phase1..phase4). */
  messageAvailable: boolean;
  onStop: () => void;
  onRetry: () => void;
  onMessage: () => void;
  onDelete: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <>
      {status === "running" ? (
        <Button variant="contained" color="error" size="small" onClick={onStop} disabled={stopping}>
          {stopping ? <CircularProgress size={16} color="inherit" sx={{ mr: 1 }} /> : null}
          Stop
        </Button>
      ) : null}
      {status === "failed" ? (
        <>
          <Button variant="contained" color="warning" size="small" onClick={onRetry}>
            Retry
          </Button>
          {messageAvailable ? (
            <Button variant="outlined" size="small" onClick={onMessage}>
              Message agent
            </Button>
          ) : null}
          <Button variant="outlined" color="error" size="small" onClick={onDelete}>
            Delete
          </Button>
        </>
      ) : null}
      {status === "awaiting_review" ? (
        <>
          <Button variant="contained" color="success" size="small" onClick={onApprove}>
            Approve
          </Button>
          <Button variant="contained" color="error" size="small" onClick={onReject}>
            Reject
          </Button>
        </>
      ) : null}
    </>
  );
}

export function RetryDialog({
  open,
  busy,
  error,
  runId,
  stageLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  runId: string | null;
  stageLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Retry from the failed stage</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Resume <code>{runId}</code> from {stageLabel}? Stages that already passed are not run again.
        </Typography>
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="warning" onClick={onConfirm} disabled={busy}>
          {busy ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          {busy ? "Starting…" : "Retry"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ApproveDialog({
  open,
  busy,
  error,
  awaitingKind,
  runId,
  answer,
  onAnswerChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  awaitingKind: "gate4" | "clarification" | "escalation" | null;
  runId: string | null;
  answer: string;
  onAnswerChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {awaitingKind === "gate4" ? "Confirm gate 4 approval" : "Answer the escalation"}
      </DialogTitle>
      <DialogContent>
        {awaitingKind === "gate4" ? (
          <Typography variant="body2" color="text.secondary">
            Approve <code>{runId}</code>? Gate 4 is recorded as passed and the package downloads. A person still commits and submits the change.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {awaitingKind === "clarification"
                ? "The run is blocked on clarifying questions (E1). Write your answers here; they are injected into the phase and the run continues."
                : "The run is blocked on an escalation. Describe how it was resolved; the answer is injected into the phase and the run continues."}
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={4}
              label="Answer / resolution"
              value={answer}
              disabled={busy}
              onChange={(event) => onAnswerChange(event.target.value)}
            />
          </>
        )}
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="success" onClick={onConfirm} disabled={busy}>
          {busy ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          {busy ? "Submitting…" : awaitingKind === "gate4" ? "Approve" : "Send answer"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function RejectDialog({
  open,
  busy,
  error,
  stage,
  comment,
  onStageChange,
  onCommentChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  stage: ReworkStage;
  comment: string;
  onStageChange: (value: ReworkStage) => void;
  onCommentChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Send back for rework</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Later stages rerun from the stage you choose. The comment is injected into that stage&apos;s agent prompt only (the orchestrator drops it once the phase finishes).
        </Typography>
        <TextField
          select
          fullWidth
          label="Rewind to"
          value={stage}
          disabled={busy}
          onChange={(event) => onStageChange(event.target.value as ReworkStage)}
          sx={{ mb: 2 }}
        >
          {REWORK_STAGES.map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          fullWidth
          multiline
          minRows={4}
          label="Comment"
          value={comment}
          disabled={busy}
          onChange={(event) => onCommentChange(event.target.value)}
        />
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={busy || !comment.trim()}>
          {busy ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          {busy ? "Submitting…" : "Reject"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function StopDialog({
  open,
  busy,
  runId,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  runId: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Stop run</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Stop run <code>{runId}</code>? The live agent will be killed; state is preserved and you can Retry from the same stage.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={busy}>
          {busy ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          {busy ? "Stopping…" : "Stop"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function DeleteDialog({
  open,
  busy,
  error,
  target,
  running,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  target: string | null;
  /** The run being deleted is still in progress. */
  running: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Delete task</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Delete <code>{target}</code>? This removes its local run folder and cannot be undone.
        </Typography>
        {running ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            This run is still in progress. Deleting it stops the live run (pipeline and agent) first, then removes the record, workspaces and registry entries.
          </Alert>
        ) : null}
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={busy}>
          {busy ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function MessageDialog({
  open,
  busy,
  error,
  runId,
  stageLabel,
  comment,
  onCommentChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  runId: string | null;
  stageLabel: string;
  comment: string;
  onCommentChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Message the agent</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Send a human message to the agent of failed run <code>{runId}</code>? It is stored as rework
          guidance on {stageLabel} and the run respawns from that stage.
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={4}
          label="Message"
          value={comment}
          disabled={busy}
          onChange={(event) => onCommentChange(event.target.value)}
        />
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={onConfirm} disabled={busy || !comment.trim()}>
          {busy ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          {busy ? "Sending…" : "Send message"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
