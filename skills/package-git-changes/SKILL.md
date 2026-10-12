---
name: package-git-changes
description: Package Git working-tree changes into a ZIP, generate a categorized Modified/Added/Deleted file list, and verify Git status, file list, and archive contents against each other. Use when the user asks to package changed code, create an SZ delivery ZIP, generate a Git change Filelist, compare a ZIP with Git changes, or check for missing, extra, misclassified, or deleted files in a delivery package.
---

# Package Git Changes

Use `scripts/package_git_changes.py` for deterministic collection and comparison. Do not stage, commit, reset, or otherwise modify the repository.

## Create a package

1. Resolve the repository root with `git rev-parse --show-toplevel` and show a concise `git status --short` preflight.
2. Obtain the SZ/task number from the user if it is not already present. Default the version to `1` unless the user supplies another value.
3. Package every working-tree change by default, including staged, unstaged, and untracked files. Use `--paths` only when the user explicitly limits the selection.
4. Run:

```bash
python3 <skill-dir>/scripts/package_git_changes.py create \
  --repo <repo> --sz <number> --version <version> \
  --output-dir <directory>
```

Default the output directory to `~/Downloads`. The command creates:

- `SZ<SZ>_V<VERSION>.zip`
- `SZ<SZ>_V<VERSION>_Filelist.txt`

The create command verifies Git status, Filelist, and ZIP contents and prints the result, but does not save a verification report. Use the `verify` command with `--report` only when the user explicitly requests a saved report.

Do not pass `--force` unless the user authorized replacing the same output names. Deleted files belong in Filelist only and must not appear in the ZIP.

## Verify an existing package

Run:

```bash
python3 <skill-dir>/scripts/package_git_changes.py verify \
  --repo <repo> --zip <archive.zip> --filelist <Filelist.txt>
```

Use `--report <path>` when a saved verification report is useful. The comparison covers:

- Git changes missing from Filelist or listed unexpectedly
- category mismatches among Modified, Added, and Deleted
- existing Filelist entries missing from the ZIP
- unexpected ZIP entries
- deleted files incorrectly included in the ZIP

Treat exit code `0` as PASS, `1` as a comparison failure, and `2` as invalid input or an operational error. Report mismatches precisely; do not silently rebuild an existing package unless the user asked for that.

## Path and packaging rules

- Store paths as `<repository-name>/<relative-path>` in both ZIP and Filelist.
- Include regular files and symlinks that currently exist.
- Represent a rename as the old path under Deleted and the new path under Added.
- Reject paths outside the selected repository.
- Exclude ignored and clean files because they are absent from Git status.
