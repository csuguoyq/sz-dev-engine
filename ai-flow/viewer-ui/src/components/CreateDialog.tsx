import { apiFetch } from "../api";
import { useEffect, useState } from "react";
import {
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  createFilterOptions,
} from "@mui/material";

const filterModelOptions = createFilterOptions<string>();

/**
 * Create-task dialog. Fetches the agent's model list itself whenever it
 * opens (GET /api/models); the start action stays in App.
 */
export function CreateDialog({
  open,
  ticketId,
  taskModel,
  creating,
  createError,
  onClose,
  onTicketIdChange,
  onTaskModelChange,
  onStart,
}: {
  open: boolean;
  ticketId: string;
  taskModel: string;
  creating: boolean;
  createError: string;
  onClose: () => void;
  onTicketIdChange: (value: string) => void;
  onTaskModelChange: (value: string) => void;
  onStart: () => void;
}) {
  const [modelChoices, setModelChoices] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [agentLabel, setAgentLabel] = useState("");
  const [modelOptional, setModelOptional] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setModelsLoading(true);
    const load = async () => {
      try {
        const response = await apiFetch("/api/models");
        const body = (await response.json()) as { models?: string[]; model?: string | null; label?: string | null; modelOptional?: boolean };
        if (cancelled) return;
        const models = body.models ?? [];
        setModelChoices(models);
        setAgentLabel(body.label ?? "");
        setModelOptional(body.modelOptional ?? false);
        const preferred = body.model && (models.length === 0 || models.includes(body.model)) ? body.model : (models[0] ?? "");
        onTaskModelChange(preferred);
      } catch {
        if (!cancelled) {
          setModelChoices([]);
          setAgentLabel("");
          setModelOptional(false);
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, onTaskModelChange]);

  return (
    <Dialog open={open} onClose={() => !creating && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Create task</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Runs on this machine with {agentLabel || "the configured agent"}. The model you pick is saved on this run and shown in the status bar.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="Ticket id"
          value={ticketId}
          onChange={(event) => onTicketIdChange(event.target.value)}
          disabled={creating}
          onFocus={(event) => {
            const input = event.target;
            const len = input.value.length;
            input.setSelectionRange(len, len);
          }}
        />
        <Autocomplete
          options={modelChoices}
          value={taskModel || null}
          onChange={(_event, value) => onTaskModelChange(value ?? "")}
          filterOptions={filterModelOptions}
          freeSolo
          disabled={creating || modelsLoading}
          loading={modelsLoading}
          sx={{ mt: 2 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={`Model${agentLabel ? ` (${agentLabel})` : ""}`}
              placeholder={modelOptional ? "not needed for this agent" : "pick a model"}
              helperText={
                modelsLoading
                  ? "Loading models…"
                  : modelOptional
                    ? "This agent does not take a model flag."
                    : modelChoices.length === 0 && taskModel
                      ? "No model list available; the configured model is used."
                      : undefined
              }
            />
          )}
        />
        {createError ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {createError}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose} disabled={creating}>
          Cancel
        </Button>
        <Button variant="contained" onClick={onStart} disabled={creating || modelsLoading || !ticketId.trim() || (!modelOptional && !taskModel.trim())}>
          {creating ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
          {creating ? "Starting…" : "Start"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
