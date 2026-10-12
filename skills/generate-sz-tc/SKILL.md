---
name: generate-sz-tc
description: Read a SoftZilla task through the configured softzilla MCP server, derive requirement-based test coverage, and generate an English CciWiki/MediaWiki test case. Use when the user gives an SZ number, bug number, or SoftZilla URL and asks to design, generate, draft, or write a TC, test case, CciWiki document, or MediaWiki source from that task.
---

# Generate a TC from SoftZilla

Generate a concise, paste-ready record for a task whose relevant code has already passed verification. Derive coverage from SoftZilla facts without inventing unsupported platforms, data, or behavior.

## Workflow

1. Extract the numeric SZ identifier from the request.
2. Call the `softzilla` MCP tools `bug_info`, `bug_comments`, and `bug_url` for the requested task. Use `bugs_quicksearch` when a focused search is needed to resolve a related SZ that is mentioned without a reliable numeric identifier. Search narrowly using terms from the requested task, then read only materially relevant results. Call read-only tools only; never call `add_comment`. From these results capture (a) the requirement and confirmed clarifications, and (b) the **change-set pointers**: the file list cited in the checkin / final-review comments, any merge-request or patch URL, and any attached code package.
3. Resolve the actual code change set. This is the anchor for the whole TC and is mandatory before any coverage is designed:
   a. First check the local repository for modifications related to the SZ. Inspect `git status`, the current branch diff against its base (`git diff <base>...HEAD`), and `git log --oneline` for the SZ id; cross-check against the file list captured in step 2. If concrete, uncommitted or branch-local changes touching the SZ's files exist, use them as the authoritative change set.
   b. If the local repository has **no** related modification, return to SoftZilla and locate the most recent code package (attached archive / patch) or the MR / patch URL cited in comments. Obtain the diff for it — prefer the MR diff when an MR link is present, otherwise the attached code package — and treat that fetched diff as the authoritative change set.
   c. If neither local changes nor a retrievable patch / MR diff exist, stop and report the gap. Do **not** fall back to generic, feature-level generation.
4. Consult the **internal** knowledge base through the `cci-rag` MCP server — this is required for every task. Do **not** use the built-in `RAG_search` tool: its selected knowledge bases are the Tencent/WeChat public libraries and return unrelated noise for this repo. Instead call `search_knowledge_base` (and `ask_knowledge_base` when a focused answer helps) against the `Default Knowledge Base`, which mirrors CciWiki (cciwiki) content. Run several narrow queries aimed at interpreting the *specific* changed code retrieved in step 3, and read only materially relevant results:
   - The requested SZ's own design discussion and any sibling SZs that touch the same code or feature.
   - Existing `TestCase:` pages for the same feature, device, or interface so the new TC reuses established conventions and the test harness, especially when the SZ has **no existing test case**.
   - Domain references (message structures, field mappings, topics, device / analyte codes) for the exact function, field, or module that changed.
   This source is supplementary to the concrete diff: use it to understand the changed code, never to substitute for it.
5. Read [generation-prompt.md](references/generation-prompt.md) completely. Treat it as the single authoritative source for test design, evidence planning, and CciWiki formatting.
6. Design coverage anchored to the concrete changed code: name the changed file / function, the altered branch or condition, and the new or modified behavior, then derive only the scenarios that exercise those specific paths. Respect explicit exclusions. Do not add generic feature, permission, or unrelated regression coverage beyond what the diff justifies.
7. Build an internal traceability map from each test scenario to (a) a specific diff hunk or changed line from step 3 and (b) the supporting SoftZilla fact or cci-rag page. Do not print the map unless the user asks for it.
8. Apply the shared generation prompt to design and render the TC. Do not add a second set of local formatting or coverage rules.
9. Report missing data separately in concise Chinese. Never invent credentials, URLs, versions, barcodes, device models, unrelated filenames, or unsupported observed outcomes.

## Output

Return, in this order:

1. A short Chinese analysis of the requirement and generated coverage.
2. One `mediawiki` fenced block containing only the complete Wikitext.
3. An `Open Questions` list only when missing information materially affects execution.

Do not publish to CciWiki or modify SoftZilla.

When saving Wikitext to a local file, run:

```bash
python3 scripts/validate_tc_wiki.py path/to/test-case.wiki
```

Fix validation errors before returning the file.
