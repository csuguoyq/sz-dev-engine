#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED_MARKERS = (
    "[[Category:SZTest]]",
    "[[Category:Testing]]",
    "== Test Case ==",
)


def validate(text: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    for marker in REQUIRED_MARKERS:
        if marker not in text:
            errors.append(f"Missing required marker: {marker}")

    forbidden = {
        "Markdown fenced block": r"```",
        "Markdown bold": r"\*\*[^*\n]+\*\*",
        "Markdown link": r"\[[^\]\n]+\]\(https?://",
    }
    for label, pattern in forbidden.items():
        if re.search(pattern, text, re.IGNORECASE):
            errors.append(f"Forbidden {label} detected")

    if re.search(r"[\u4e00-\u9fff]", text):
        errors.append("Chinese narrative text remains in the Wikitext")
    if re.search(r"^#\s*(?:\{\||!|\|-|\|)", text, re.MULTILINE):
        errors.append("A table source line incorrectly consumes a numbered step")
    if re.search(r"\[\[File:[^|\]\r\n]+\|(?!200 px\]\])", text, re.IGNORECASE):
        warnings.append("A file placeholder does not use the standard 200 px width")
    if re.search(r"^-\s+", text, re.MULTILINE):
        errors.append("Markdown-style unordered list marker detected; use '*' in Wikitext")
    if re.search(r"^\s*}\s*$", text, re.MULTILINE):
        errors.append("A stray closing brace was found in the Wikitext")
    if re.search(r"^#.*\n\s*\n#", text, re.MULTILINE):
        warnings.append("A blank line may restart a numbered sequence")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated CCI TC Wikitext")
    parser.add_argument("path", nargs="?", help="Wikitext file; stdin when omitted")
    args = parser.parse_args()
    text = Path(args.path).read_text(encoding="utf-8") if args.path else sys.stdin.read()
    errors, warnings = validate(text)
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        return 1
    print("TC Wikitext validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
