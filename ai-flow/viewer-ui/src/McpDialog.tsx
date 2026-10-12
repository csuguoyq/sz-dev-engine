import { apiFetch } from "./api";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

type McpServerType = "stdio" | "sse" | "http";
type McpScopeName = "user" | "project";

interface McpServerEntry {
  name: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

interface McpScope {
  scope: McpScopeName;
  path: string;
  format: string;
  requiresApproval: boolean;
  verified: boolean;
  note: string;
  servers: McpServerEntry[];
}

interface McpStatus {
  agent: string | null;
  label: string | null;
  supported: boolean;
  error?: string;
  scopes: McpScope[];
}

function parseArgs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

export function McpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ scope: McpScopeName; name: string } | null>(null);

  const [editScope, setEditScope] = useState<McpScopeName>("user");
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<McpServerType>("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [envText, setEnvText] = useState("");
  const [enabled, setEnabled] = useState(true);

  const serverEnabled = (server: McpServerEntry): boolean => server.enabled !== false;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/mcp");
      const body = (await res.json()) as McpStatus;
      setStatus(body);
      if (body.scopes.length > 0) setEditScope(body.scopes[0].scope);
    } catch {
      setError("Could not load the MCP configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const resetForm = useCallback(() => {
    setEditName("");
    setEditType("stdio");
    setCommand("");
    setArgsText("");
    setUrl("");
    setEnvText("");
    setEnabled(true);
  }, []);

  const startEdit = useCallback((scope: McpScopeName, server: McpServerEntry) => {
    setEditScope(scope);
    setEditName(server.name);
    setEditType(server.type);
    setCommand(server.command ?? "");
    setArgsText((server.args ?? []).join("\n"));
    setUrl(server.url ?? "");
    setEnvText(Object.entries(server.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    setEnabled(serverEnabled(server));
  }, []);

  const save = useCallback(async () => {
    if (!status) return;
    setBusy(true);
    setError("");
    const spec: Record<string, unknown> = { type: editType, enabled };
    if (editType === "stdio") {
      spec.command = command.trim();
      const args = parseArgs(argsText);
      if (args.length > 0) spec.args = args;
      const env = parseEnv(envText);
      if (Object.keys(env).length > 0) spec.env = env;
    } else {
      spec.url = url.trim();
    }
    try {
      const res = await apiFetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: editScope, name: editName.trim(), spec }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || `Failed to save (${res.status})`);
        return;
      }
      resetForm();
      await load();
    } catch {
      setError("Could not save the server.");
    } finally {
      setBusy(false);
    }
  }, [status, editScope, editName, editType, command, argsText, url, envText, enabled, load, resetForm]);

  const toggle = useCallback(
    async (scope: McpScopeName, name: string, next: boolean) => {
      setBusy(true);
      setError("");
      try {
        const res = await apiFetch(`/api/mcp/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error || `Failed to update (${res.status})`);
          return;
        }
        await load();
      } catch {
        setError("Could not update the server.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const remove = useCallback(
    async (scope: McpScopeName, name: string) => {
      setBusy(true);
      setError("");
      try {
        const res = await apiFetch(
          `/api/mcp/${encodeURIComponent(name)}?scope=${encodeURIComponent(scope)}`,
          { method: "DELETE" },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error || `Failed to delete (${res.status})`);
          return;
        }
        await load();
      } catch {
        setError("Could not delete the server.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const nameInvalid = !/^[A-Za-z0-9_-]+$/.test(editName.trim());
  const canSave =
    !busy &&
    !nameInvalid &&
    (editType === "stdio" ? command.trim().length > 0 : url.trim().length > 0);

  const editScopeFormat = status?.scopes.find((scope) => scope.scope === editScope)?.format ?? "";

  const confirmRemovePath = confirmRemove
    ? (status?.scopes.find((scope) => scope.scope === confirmRemove.scope)?.path ?? confirmRemove.scope)
    : "";

  return (
    <>
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Manage MCP servers</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          You edit the configured agent&apos;s MCP servers here. The agent only consumes them; it cannot
          modify this list itself. Changes apply the next time a run starts the agent — except DeepSeek
          Harness (dsh), which hot-reloads edits via HMR.
        </Alert>

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : error && !status ? (
          <Alert severity="error">{error}</Alert>
        ) : status && !status.supported ? (
          <Alert severity="warning">
            {status.error ?? `MCP management is not configured for agent "${status.agent}".`}
          </Alert>
        ) : status ? (
          <Stack spacing={3}>
            {status.scopes.map((scope) => (
              <Box key={scope.scope}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, textTransform: "capitalize" }}>
                  {scope.scope} scope
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  {scope.path}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {scope.note}
                  {!scope.verified ? " (best-effort: verify with your agent version)" : ""}
                </Typography>
                {scope.requiresApproval ? (
                  <Alert severity="warning" sx={{ mb: 1 }}>
                    This file&apos;s servers stay disabled until you approve them in the agent (for example
                    Claude Code&apos;s <code>/mcp</code>).
                  </Alert>
                ) : null}

                {scope.servers.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                    No servers configured.
                  </Typography>
                ) : (
                  <Stack component="ul" spacing={1} sx={{ pl: 2, m: 0 }}>
                    {scope.servers.map((server) => (
                      <Box
                        component="li"
                        key={server.name}
                        sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
                      >
                        <Box sx={{ flex: 1, minWidth: 220 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {server.name}{" "}
                            <Typography component="span" color="text.secondary">
                              ({server.type})
                            </Typography>
                            {!serverEnabled(server) ? (
                              <Typography component="span" color="warning.main" sx={{ ml: 1 }}>
                                (disabled)
                              </Typography>
                            ) : null}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                            {server.type === "stdio"
                              ? `${server.command ?? ""}${server.args && server.args.length > 0 ? " " + server.args.join(" ") : ""}`
                              : server.url ?? ""}
                          </Typography>
                        </Box>
                        <Switch
                          size="small"
                          checked={serverEnabled(server)}
                          disabled={busy}
                          onChange={(event) => void toggle(scope.scope, server.name, event.target.checked)}
                          slotProps={{ input: { "aria-label": `Enable ${server.name}` } }}
                        />
                        <Button size="small" variant="outlined" onClick={() => startEdit(scope.scope, server)}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={busy}
                          onClick={() => setConfirmRemove({ scope: scope.scope, name: server.name })}
                        >
                          Delete
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                )}
                <Divider sx={{ mt: 2 }} />
              </Box>
            ))}

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {editName ? `Edit server: ${editName}` : "Add a server"}
              </Typography>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Stack direction="row" spacing={2}>
                  <TextField
                    select
                    label="Scope"
                    value={editScope}
                    onChange={(event) => setEditScope(event.target.value as McpScopeName)}
                    sx={{ minWidth: 140 }}
                  >
                    {status.scopes.map((scope) => (
                      <MenuItem key={scope.scope} value={scope.scope}>
                        {scope.scope}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Name"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    error={editName.length > 0 && nameInvalid}
                    helperText={editName.length > 0 && nameInvalid ? "Use letters, digits, - or _" : ""}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    select
                    label="Type"
                    value={editType}
                    onChange={(event) => setEditType(event.target.value as McpServerType)}
                    sx={{ minWidth: 140 }}
                  >
                    <MenuItem value="stdio">stdio</MenuItem>
                    <MenuItem value="sse">sse</MenuItem>
                    <MenuItem value="http">http</MenuItem>
                  </TextField>
                </Stack>

                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Switch
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    slotProps={{ input: { "aria-label": "Enabled" } }}
                  />
                  <Typography variant="body2">{enabled ? "Enabled" : "Disabled"}</Typography>
                </Stack>

                {editType === "stdio" ? (
                  <>
                    <TextField
                      label="Command"
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder="npx"
                      fullWidth
                    />
                    <TextField
                      label="Arguments (one per line)"
                      value={argsText}
                      onChange={(event) => setArgsText(event.target.value)}
                      placeholder="-y\n@modelcontextprotocol/server-filesystem\n/workspace"
                      multiline
                      minRows={2}
                      fullWidth
                    />
                    <TextField
                      label="Environment (KEY=value per line)"
                      value={envText}
                      onChange={(event) => setEnvText(event.target.value)}
                      multiline
                      minRows={2}
                      fullWidth
                    />
                  </>
                ) : (
                  <>
                    {editType === "sse" && editScopeFormat === "dsh-cordis" ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                        dsh&apos;s MCP client supports only stdio and streamable-http, so this sse server is stored as streamable-http.
                      </Typography>
                    ) : null}
                    <TextField
                      label="URL"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com/mcp"
                      fullWidth
                    />
                  </>
                )}

                {error ? <Alert severity="error">{error}</Alert> : null}

                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
                    {busy ? <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} /> : null}
                    Save
                  </Button>
                  <Button variant="outlined" onClick={resetForm} disabled={busy}>
                    Clear
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>

    <Dialog open={confirmRemove !== null} onClose={() => !busy && setConfirmRemove(null)} fullWidth maxWidth="xs">
      <DialogTitle>Delete MCP server</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Delete MCP server <code>{confirmRemove?.name}</code> from <code>{confirmRemovePath}</code>?
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={() => setConfirmRemove(null)} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={busy}
          onClick={() => {
            if (confirmRemove) void remove(confirmRemove.scope, confirmRemove.name);
            setConfirmRemove(null);
          }}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
}
