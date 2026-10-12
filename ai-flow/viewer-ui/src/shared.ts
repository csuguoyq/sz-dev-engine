/**
 * Shared types, constants and pure helpers for the viewer UI, extracted from
 * App so the page components (run list, stage panel, live log, dialogs,
 * status bar) can be plain-prop components without importing each other.
 */

export const STAGES = ["workspace", "phase1", "phase2", "phase3", "phase4", "review"] as const;
export type Stage = (typeof STAGES)[number];

export const LABELS: Record<Stage, string> = {
  workspace: "Workspace",
  phase1: "Requirement",
  phase2: "Implementation",
  phase3: "Testing",
  phase4: "Deliverables",
  review: "Manual review",
};

// The API response shapes are owned by the server (src/viewer/apiTypes.ts);
// re-exporting them here keeps the UI and the viewer process on one
// definition — the same relative-import-into-src pattern LiveLogPanel uses
// for StreamEvent.
import type { AgentSessionInfo, AgentStatus, RunDetail, RunSummary, StageInfo } from "../../src/viewer/apiTypes";
import type { StageStatus } from "../../src/types";
export type { AgentSessionInfo, AgentStatus, RunDetail, RunSummary, StageInfo } from "../../src/viewer/apiTypes";
export type { StageStatus } from "../../src/types";

export const REWORK_STAGES = [
  ["phase1", "Phase 1 · Requirement"],
  ["phase2", "Phase 2 · Implementation"],
  ["phase3", "Phase 3 · Testing"],
  ["phase4", "Phase 4 · Deliverables"],
] as const;
export type ReworkStage = (typeof REWORK_STAGES)[number][0];

/** Which document tab shows a stage's artifacts. */
export const STAGE_TAB: Record<Stage, string> = {
  workspace: "ticket",
  phase1: "requirement",
  phase2: "review",
  phase3: "testPlan",
  phase4: "deliverables",
  review: "deliverables",
};

/** Document tab keys and labels, in display order. */
export const DOC_TABS: Record<string, string> = {
  liveLog: "Live log",
  ticket: "Ticket",
  requirement: "Requirement",
  review: "Review findings",
  testPlan: "Test plan",
  testReport: "Test report",
  handoff: "Handoff",
  clarifications: "Clarifications",
  deliverables: "Deliverables",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local wall clock as MM/DD/YYYY HH:MM:SS */
export function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Compact MM/DD HH:MM for tight list rows */
export function formatShortDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function statusColor(status: string): "default" | "success" | "error" | "warning" | "info" {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "error";
    case "running":
    case "passed_with_blocked":
      return "warning";
    case "awaiting_review":
      return "info";
    case "approved":
      return "success";
    case "unverified":
    case "skipped":
    case "pending":
      return "default";
    default:
      return "default";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "passed_with_blocked":
      return "Passed with blocked";
    case "awaiting_review":
      return "Awaiting review";
    case "approved":
      return "Approved";
    case "unverified":
      return "Unverified (no totals)";
    default:
      return status;
  }
}

export function shownModel(detail: RunDetail | null, agentStatus: AgentStatus): string {
  // The status probe reports what the run ACTUALLY used (zcode resolves its
  // own model; the init-time choice in state.model may differ). Prefer it,
  // qualified with the provider when the probe exposes one; fall back to the
  // recorded choice only while no live session exists yet.
  const session = agentStatus.session ?? null;
  const sessionModel =
    session?.model && typeof session.model === "object"
      ? String((session.model as { id?: string }).id ?? "")
      : typeof session?.model === "string"
        ? session.model
        : "";
  if (sessionModel) {
    const provider = session && typeof session.provider === "string" && session.provider ? `${session.provider}/` : "";
    return `${provider}${sessionModel}`;
  }
  return detail?.state.model || agentStatus.model || (agentStatus.label ? "default" : "model unknown");
}

/**
 * Copy text to the clipboard. navigator.clipboard requires a secure
 * context (https or localhost); the viewer is served over plain http
 * from a LAN address, so fall back to a hidden textarea +
 * document.execCommand("copy") which still works there.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}
