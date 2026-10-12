---
name: convert-tc-wiki
description: Convert a tester's Chinese or mixed-language completed test notes into professional English CciWiki/MediaWiki source without inventing test facts. Use when the user supplies an SZ/TC number and actual test actions, environments, results, comparisons, screenshots, or presentation requirements and asks to convert, organize, translate, format, or write them as a TC document. Do not use to design tests from a SoftZilla task; use generate-sz-tc for that.
---

# Convert completed test notes to TC Wiki

Convert only the tester-provided facts into concise, paste-ready English CciWiki source. Treat presentation requests as formatting instructions rather than test content.

## Workflow

1. Identify the SZ/TC number, optional title, environments, preconditions, executed actions, observed results, comparisons, technical strings, figure references, and presentation requests in the user's notes.
2. Read [conversion-prompt.md](references/conversion-prompt.md) completely and apply it as the authoritative conversion and MediaWiki contract.
3. Separate facts from formatting directives, image directives, and meta comments by meaning. A sentence may contain more than one category.
4. Convert every stated test fact while adding no new platform, step, result, comparison, prerequisite, or scope.
5. Convert explicit figure references into sequential `<SZ>-N.png` placeholders. When no SZ/TC number is available, use `draft-N.png` and warn the user to replace it.
6. Return one `mediawiki` fenced block containing only the completed Wikitext, followed by a concise `Open Questions` list only when a real ambiguity or missing execution detail remains.

Do not access SoftZilla, publish to CciWiki, or describe formatting directives as test steps.

When saving Wikitext to a file, run:

```bash
python3 scripts/validate_tc_wiki.py path/to/test-case.wiki
```

Fix validation errors before returning the file.
