import fs from "node:fs";
import path from "node:path";

/**
 * Resolve the sz-dev skill directory visible to the agent: prefer the
 * copy seeded inside the sz-dev workspace (a full ccsrc clone or a
 * replay tree) so the agent never needs to read outside its working
 * directory; fall back to the orchestrator's configured skill dir.
 */
export function skillDirFor(workspace: string, configured: string): string {
  const seeded = path.join(workspace, "skills", "sz-dev");
  return fs.existsSync(path.join(seeded, "SKILL.md")) ? seeded : configured;
}

const COMMON = `You are executing one phase of a sz-dev run driven by the ai-flow orchestrator.

Hard rules (from skills/sz-dev/SKILL.md, binding in every phase):
- The SZ ticket is read-only. Fetch it through your configured softzilla MCP whenever you need it — use \`bug_info\` for the ticket body and \`bug_comments\` for the comment thread; never write back to the ticket system. Read-only tools on that MCP also include \`bug_url\` (canonical ticket link), \`bugs_quicksearch\` (search by id/keyword when the id is ambiguous), \`bug_comments_raw\` (raw comment payload) and \`summarize_bug_prompt\` (condensed summary). Do NOT use the \`add_comment\` write-back tool. ai-flow no longer runs a separate MCP client — your agent runtime supplies the softzilla MCP connection.
- Never git commit or git push. All work stays in the working tree. Snapshots use git add -N + git diff (or sz-replay diff in replay mode).
- Every "passed"/"done" statement in an artifact needs evidence on disk (file, command output, or exit code).
- Generated files are written in English.
- Execute only the phase document named below. Do NOT advance to a later phase and do NOT run sz-progress set phase/gate commands: the orchestrator advances phases and passes gates after checking your evidence. You MAY run sz-progress bump/awaiting/note per the phase document.
- Do not run find, or any recursive search, over $HOME, /project, or any tree outside this workspace and ~/sz for this ticket. Open a sibling SZ example only when its path is already named in the phase inputs or the sz-dev workspace registry. Do not discover it by walking the filesystem.
- The orchestrator already chose this workspace, mode, and baseline. Do not run sz-workspace ensure, and do not use git log to look for commits other than this ticket's own fix candidates (replay Phase 1 may inspect its own candidates, stat only — never the hunks). Do not run a tool's --help.
- Install commands, the designated test host, and engine invocation come only from the pack architecture-cache.md sections "Designated test host" and "Install / build". Do not search the filesystem, cclib, or /fbch for those commands.
- Do not open existing tar archives under ~/sz.
- Replay mode: plans, reviews, handoffs, and deliverables must not contain the fix commit SHA or ticket attachment ids. Those literals stay only in progress.md, phase1-requirement.md, and the ticket caches.`;

export function phase1Prompt(options: {
  skillDir: string;
  ticketPath: string;
  workspace: string;
  mode: "standard" | "replay";
  id: string;
  fixCommit?: string;
  baselineCommit?: string;
}): string {
  const workflow = path.join(options.skillDir, "workflows", "phase1-requirement.md");
  const ticketCommentsPath = options.ticketPath.replace(/ticket-body\.md$/, "ticket-comments.md");
  const replay = options.mode === "replay"
    ? `\nREPLAY MODE: this SZ's fix commit ${options.fixCommit} is already in git history. The working tree is at the pre-fix baseline ${options.baselineCommit}. Follow workflows/replay-mode.md Delta 1/Delta 2 rules; use sz-replay diff instead of raw git diff and never open the fix commit's diff.\n` +
      `\nSanctioned exception — the replay switch (workflows/replay-mode.md "The switch"): if your Phase-1 commit disambiguation establishes that the supplied fix commit is wrong (for example a harness commit that only mentions this ticket in its body, or a baseline that already contains the fix), re-baseline the tree to the TRUE pre-fix baseline: run sz-replay init ${options.id} <true-fix-commit> (in the single-workspace tree this re-checkouts in place), then re-anchor with sz-progress set ${options.id} meta base <new-baseline-sha> (this meta re-anchor is permitted — only sz-progress set phase/gate is reserved to the orchestrator) and record a note in progress.md. The orchestrator adopts a valid re-baseline — detached HEAD, clean tracked tree, new baseline is the parent of the genuine fix — and re-anchors its own state and the replay registry automatically. Do NOT run sz-replay init --force (it destroys the tree and the run state).\n`
    : "";
  return `${COMMON}

Phase 1 (requirement). Working directory: ${options.workspace}.
Execution specification: read and follow ${workflow} exactly.

Inputs:
- Ticket: ai-flow no longer seeds the ticket cache. Fetch ${options.id} yourself through your configured softzilla MCP — use \`bug_info\` for the ticket body and \`bug_comments\` for the comment thread — and write the verbatim body to ${options.ticketPath} and the comments to ${ticketCommentsPath}. If the id is ambiguous, resolve it first with \`bugs_quicksearch\`; use \`bug_url\` for the canonical link when you need to cite it; \`summarize_bug_prompt\` gives a condensed view when the raw ticket is long. The ticket is read-only; never write back to the ticket system.
- Module packs live under ${path.join(options.skillDir, "references")}.
${replay}
Deliverables in the .sz-dev/SZxxxx state directory (relative to the workspace):
- attachment/ticket-body.md and attachment/ticket-comments.md (verbatim ticket cache you fetched)
- phase1-requirement.md with the fixed section outline, including the "repro: red|n/a|manual" conclusion line (and "driver data: ..." when repro is red)
- deliverables/clarification-comments.md rendering any blocking questions for the human
- record the selected module pack by running: bash <skillDir>/tools/sz-progress note SZxxxx "module pack: <name>"

If a blocking clarification is required, record it in clarification-comments.md and run \`bash <skillDir>/tools/sz-progress awaiting SZxxxx E1\` (SZxxxx is this ticket id), then stop. Otherwise stop at the end of the phase document's Phase-1 checklist without touching later phases.
`;
}

export function phase2Prompt(options: {
  skillDir: string;
  workspace: string;
  pack: string;
  mode: "standard" | "replay";
  requirementPath: string;
}): string {
  const workflow = path.join(options.skillDir, "workflows", "phase2-implementation.md");
  return `${COMMON}

Phase 2 (implementation and self-review). Working directory: ${options.workspace}.
Execution specification: read and follow ${workflow} exactly.

Inputs:
- Requirement analysis: ${options.requirementPath} (the phase1-requirement.md in the state directory)
- Module pack: ${path.join(options.skillDir, "references", options.pack)} — use its check/review-checklist capabilities per the workflow.
${options.mode === "replay" ? "REPLAY MODE: snapshot and diff through sz-replay diff (see workflows/replay-mode.md); the baseline is the pre-fix parent commit.\n" : ""}
Deliverables in the .sz-dev/SZxxxx state directory:
- phase2-plan.md (or phase2-plan-<slice>.md) with the checklist and changed-paths.txt
- checkpoints/ step patches per the workflow, ending with the reviewed gate-2 patch SZxxxx_gate2.patch
- phase2-review.md with the two-part "## Self-review" / "## Independent review" sections
- phase4-handoff.md

Preflight already passed for this ai-flow run. Do not run sz-preflight again.

Use pack check tooling after each step; cap self-fix rounds at 2 via sz-progress bump. Run the pack build capability at the end if it exists. The independent reviewer reads only the review checklist, the for-review diff, the requirement, and the paths listed in changed-paths.txt. It does not grep the repository to rediscover the change surface. Copy that bound into the reviewer prompt. Stop after Phase 2; the orchestrator passes gate 2.
`;
}

export function phase3Prompt(options: {
  skillDir: string;
  workspace: string;
  pack: string;
  testPlanPath: string;
  testReportPath: string;
}): string {
  const workflow = path.join(options.skillDir, "workflows", "phase3-testing.md");
  return `${COMMON}

Phase 3 (testing). Working directory: ${options.workspace}.
Execution specification: read and follow ${workflow} exactly.

Inputs:
- Handoff: the phase4-handoff.md in the state directory.
- Module pack: ${path.join(options.skillDir, "references", options.pack)} — its accept capability (or manual-track rendering when absent).

Deliverables in the .sz-dev/SZxxxx state directory:
- ${path.basename(options.testPlanPath)} (the reviewed case set; machine review is the only pre-execution gate)
- ${path.basename(options.testReportPath)} (per-case results with evidence)

Preflight already passed for this ai-flow run. Do not run sz-preflight again.

The change surface is changed-paths.txt. Do not grep the repository to find it again. Still execute the case set. If the pack has no executable accept capability or no designated test host is available, degrade to manual track: render the cases for a human, mark the report accordingly, and do not fake results. Stop after Phase 3; the orchestrator passes gate 3.
`;
}

export function phase4Prompt(options: {
  skillDir: string;
  workspace: string;
  pack: string;
  deliverablesDir: string;
}): string {
  const workflow = path.join(options.skillDir, "workflows", "phase4-deliverables.md");
  return `${COMMON}

Phase 4 (deliverables). Working directory: ${options.workspace}.
Execution specification: read and follow ${workflow} exactly.

Inputs:
- phase4-handoff.md and phase3-test-report.md in the state directory.
- Module pack: ${path.join(options.skillDir, "references", options.pack)} — its deliverables capability (or sz-gen-deliverable skeletons when absent).

Deliverables in ${options.deliverablesDir}:
- RN and TC always; CN and IN when the change needs config/install steps
- CHANGES-SZxxxx.patch copied from the reviewed gate-2 patch
- clarification-comments.md updated if new questions surfaced

Deletion semantics (so the gate-4 audit reads it right): the delivery
tarball contains only changed files that EXIST in the tree — a deleted file
is not in it. Deletions are represented exclusively by CHANGES-SZxxxx.patch
(which the gate-4 reviewer applies/audits as the authoritative change
record). RN/TC must describe the deletion, not the surviving file.

Preflight already passed for this ai-flow run. Do not run sz-preflight again.

If Phase 2 install evidence is still on disk and the command and the source bytes are unchanged, transcribe that output. Do not install again.

The change surface is changed-paths.txt. Decide RN/TC/CN/IN from that file and the Phase 3 report. Do not grep the repository to rediscover it. Still regenerate the handoff, run sz-replay verify in replay mode (or the workflow's tree check otherwise), and run the wiki validator. Do not package: the orchestrator builds the delivery tarball and the audit packet after this phase. Stop after the deliverables are written and validated.
`;
}

export function withReviewFeedback(prompt: string, comment: string | undefined): string {
  const text = comment?.trim();
  if (!text) return prompt;
  return `${prompt}\n\nHuman review comment (address this before finishing this phase):\n${text}\n`;
}
