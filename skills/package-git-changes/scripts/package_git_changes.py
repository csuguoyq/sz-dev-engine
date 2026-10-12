#!/usr/bin/env python3
"""Create and verify Git change delivery packages."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable


CATEGORIES = ("Modified", "Added", "Deleted")
SAFE_LABEL = re.compile(r"^[A-Za-z0-9._-]+$")


class PackageError(Exception):
    pass


@dataclass(frozen=True)
class ChangeSet:
    repo: Path
    categories: dict[str, set[str]]

    @property
    def prefix(self) -> str:
        return self.repo.name

    def archive_path(self, relative_path: str) -> str:
        return f"{self.prefix}/{relative_path}"

    def expected_archive_entries(self) -> set[str]:
        return {
            self.archive_path(path)
            for category in ("Modified", "Added")
            for path in self.categories[category]
        }


def run_git(repo: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise PackageError("git is not installed or not on PATH") from exc
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", "replace").strip()
        raise PackageError(message or "git command failed") from exc
    return result.stdout


def resolve_repo(value: str) -> Path:
    candidate = Path(value).expanduser().resolve()
    output = run_git(candidate, "rev-parse", "--show-toplevel")
    return Path(output.decode("utf-8", "surrogateescape").strip()).resolve()


def normalize_selected_paths(repo: Path, paths: list[str] | None) -> list[str]:
    if not paths:
        return []
    normalized: list[str] = []
    for value in paths:
        candidate = Path(value).expanduser()
        absolute = candidate.resolve() if candidate.is_absolute() else (repo / candidate).resolve()
        try:
            relative = absolute.relative_to(repo).as_posix()
        except ValueError as exc:
            raise PackageError(f"path is outside repository: {value}") from exc
        normalized.append(relative)
    return normalized


def decode_path(raw: bytes) -> str:
    value = raw.decode("utf-8", "surrogateescape")
    if "\n" in value or "\r" in value:
        raise PackageError(f"paths containing newlines are unsupported: {value!r}")
    return PurePosixPath(value).as_posix()


def collect_changes(repo: Path, selected_paths: list[str] | None = None) -> ChangeSet:
    args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"]
    if selected_paths:
        args.extend(["--", *selected_paths])
    records = run_git(repo, *args).split(b"\0")
    categories = {name: set() for name in CATEGORIES}
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if not record:
            continue
        if len(record) < 4 or record[2:3] != b" ":
            raise PackageError(f"unrecognized git status record: {record!r}")
        status = record[:2].decode("ascii", "replace")
        path = decode_path(record[3:])
        rename_or_copy = "R" in status or "C" in status
        old_path = None
        if rename_or_copy:
            if index >= len(records) or not records[index]:
                raise PackageError("incomplete rename/copy record from git status")
            old_path = decode_path(records[index])
            index += 1

        disk_path = repo / path
        if "R" in status:
            categories["Deleted"].add(old_path or path)
            if disk_path.exists() or disk_path.is_symlink():
                categories["Added"].add(path)
            else:
                categories["Deleted"].add(path)
        elif "C" in status:
            categories["Added"].add(path)
        elif "D" in status or not (disk_path.exists() or disk_path.is_symlink()):
            categories["Deleted"].add(path)
        elif status == "??" or "A" in status:
            categories["Added"].add(path)
        else:
            categories["Modified"].add(path)

    return ChangeSet(repo=repo, categories=categories)


def write_atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def render_filelist(changes: ChangeSet) -> str:
    lines = ["File list:"]
    for category in CATEGORIES:
        values = sorted(changes.categories[category])
        if not values:
            continue
        lines.extend(["", f"{category}:"])
        lines.extend(changes.archive_path(value) for value in values)
    return "\n".join(lines) + "\n"


def parse_filelist(path: Path) -> dict[str, set[str]]:
    result = {name: set() for name in CATEGORIES}
    active = None
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise PackageError(f"cannot read Filelist: {exc}") from exc
    for number, raw_line in enumerate(lines, 1):
        line = raw_line.strip()
        if not line or line == "File list:":
            continue
        if line.endswith(":") and line[:-1] in CATEGORIES:
            active = line[:-1]
            continue
        if active is None:
            raise PackageError(f"Filelist line {number} is outside a category: {raw_line!r}")
        normalized = PurePosixPath(line).as_posix().lstrip("/")
        if ".." in PurePosixPath(normalized).parts:
            raise PackageError(f"unsafe path in Filelist line {number}: {raw_line!r}")
        result[active].add(normalized)
    return result


def make_zip(path: Path, changes: ChangeSet) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary_name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for category in ("Modified", "Added"):
                for relative in sorted(changes.categories[category]):
                    source = changes.repo / relative
                    if not (source.is_file() or source.is_symlink()):
                        raise PackageError(f"changed path is not a file: {source}")
                    archive.write(source, changes.archive_path(relative))
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def zip_entries(path: Path) -> tuple[set[str], list[str]]:
    try:
        with zipfile.ZipFile(path, "r") as archive:
            bad = archive.testzip()
            if bad:
                raise PackageError(f"corrupt member in ZIP: {bad}")
            entries = {
                PurePosixPath(info.filename).as_posix().lstrip("/")
                for info in archive.infolist()
                if not info.is_dir()
            }
            duplicates = sorted(
                name for name in set(archive.namelist()) if archive.namelist().count(name) > 1
            )
    except (OSError, zipfile.BadZipFile) as exc:
        raise PackageError(f"cannot read ZIP: {exc}") from exc
    return entries, duplicates


def prefixed_git_categories(changes: ChangeSet) -> dict[str, set[str]]:
    return {
        category: {changes.archive_path(path) for path in values}
        for category, values in changes.categories.items()
    }


def add_section(lines: list[str], title: str, values: Iterable[str]) -> bool:
    values = sorted(values)
    lines.extend(["", f"{title}: {len(values)}"])
    lines.extend(f"  {value}" for value in values)
    return bool(values)


def compare(changes: ChangeSet, archive_path: Path, filelist_path: Path) -> tuple[bool, str]:
    git_categories = prefixed_git_categories(changes)
    listed_categories = parse_filelist(filelist_path)
    archived, duplicates = zip_entries(archive_path)
    failed = False
    lines = [
        "Git package verification",
        f"Repository: {changes.repo}",
        f"ZIP: {archive_path}",
        f"Filelist: {filelist_path}",
    ]

    for category in CATEGORIES:
        failed |= add_section(
            lines,
            f"Git {category} missing from Filelist",
            git_categories[category] - listed_categories[category],
        )
        failed |= add_section(
            lines,
            f"Filelist {category} not present in Git status",
            listed_categories[category] - git_categories[category],
        )

    listed_existing = listed_categories["Modified"] | listed_categories["Added"]
    failed |= add_section(lines, "Existing Filelist entries missing from ZIP", listed_existing - archived)
    failed |= add_section(lines, "Unexpected ZIP entries", archived - listed_existing)
    failed |= add_section(lines, "Deleted Filelist entries incorrectly present in ZIP", listed_categories["Deleted"] & archived)
    failed |= add_section(lines, "Duplicate ZIP members", duplicates)
    lines.extend(["", f"Result: {'FAIL' if failed else 'PASS'}"])
    return not failed, "\n".join(lines) + "\n"


def ensure_writable_targets(paths: Iterable[Path], force: bool) -> None:
    existing = [str(path) for path in paths if path.exists()]
    if existing and not force:
        joined = "\n  ".join(existing)
        raise PackageError(f"output already exists; choose another version or use --force:\n  {joined}")


def validate_label(label: str, value: str) -> str:
    if not SAFE_LABEL.fullmatch(value):
        raise PackageError(f"{label} must contain only letters, digits, dot, underscore, or hyphen")
    return value


def command_create(args: argparse.Namespace) -> int:
    repo = resolve_repo(args.repo)
    selected = normalize_selected_paths(repo, args.paths)
    changes = collect_changes(repo, selected)
    if not any(changes.categories.values()):
        print("No Git changes found; no package was created.")
        return 0

    sz = validate_label("SZ number", args.sz)
    version = validate_label("version", args.version)
    output_dir = Path(args.output_dir).expanduser().resolve()
    stem = f"SZ{sz}_V{version}"
    archive_path = output_dir / f"{stem}.zip"
    filelist_path = output_dir / f"{stem}_Filelist.txt"
    ensure_writable_targets((archive_path, filelist_path), args.force)

    write_atomic_text(filelist_path, render_filelist(changes))
    make_zip(archive_path, changes)
    passed, report = compare(changes, archive_path, filelist_path)
    print(report, end="")
    print(f"Created: {archive_path}")
    print(f"Created: {filelist_path}")
    return 0 if passed else 1


def command_verify(args: argparse.Namespace) -> int:
    repo = resolve_repo(args.repo)
    selected = normalize_selected_paths(repo, args.paths)
    changes = collect_changes(repo, selected)
    archive_path = Path(args.zip).expanduser().resolve()
    filelist_path = Path(args.filelist).expanduser().resolve()
    passed, report = compare(changes, archive_path, filelist_path)
    if args.report:
        report_path = Path(args.report).expanduser().resolve()
        if report_path.exists() and not args.force:
            raise PackageError(f"report already exists; use --force to replace: {report_path}")
        write_atomic_text(report_path, report)
        print(f"Created: {report_path}")
    print(report, end="")
    return 0 if passed else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="create and verify a Git change package")
    create.add_argument("--repo", default=".", help="path inside the Git repository")
    create.add_argument("--sz", required=True, help="SZ/task number used in output names")
    create.add_argument("--version", default="1", help="package version (default: 1)")
    create.add_argument("--output-dir", default="~/Downloads", help="output directory")
    create.add_argument("--paths", nargs="+", help="optional repository-relative path selection")
    create.add_argument("--force", action="store_true", help="replace outputs with identical names")
    create.set_defaults(handler=command_create)

    verify = subparsers.add_parser("verify", help="compare Git status, ZIP, and Filelist")
    verify.add_argument("--repo", default=".", help="path inside the Git repository")
    verify.add_argument("--zip", required=True, help="ZIP archive to verify")
    verify.add_argument("--filelist", required=True, help="categorized Filelist to verify")
    verify.add_argument("--paths", nargs="+", help="optional repository-relative path selection")
    verify.add_argument("--report", help="optional path for a saved verification report")
    verify.add_argument("--force", action="store_true", help="replace an existing report")
    verify.set_defaults(handler=command_verify)
    return parser


def main() -> int:
    try:
        args = build_parser().parse_args()
        return args.handler(args)
    except PackageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
