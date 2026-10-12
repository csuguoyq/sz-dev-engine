#!/usr/bin/env python3
"""CQL module static gates (the five lint checks of automation.md §2.5).

Runs on a Windows checkout with zero environment cost; equally usable on Linux CI.
Rule sources: references/cql/domain/facts.md, skills/sz-dev/references/cql/automation.md.

Usage:
    python skills/sz-dev/references/cql/tools/cql_lint.py            # enforce only git-changed files (the default mode)
    python skills/sz-dev/references/cql/tools/cql_lint.py --all      # full scan (pre-existing issues downgraded to warnings)
    python skills/sz-dev/references/cql/tools/cql_lint.py --strict   # report pre-existing issues as errors too
    python skills/sz-dev/references/cql/tools/cql_lint.py --base <ref>  # git comparison base (default HEAD)

Exit code: any error → 1; warnings only → 0.

The five checks:
  1. help-sync        primitives registered in cci.c must have a signature entry in cql/lisp/cql.hlp.
  2. disable-storage  primitives whose body takes the write path (db-start-write/db-newd)
                      must contain the disable_storage check (protects -n read-only mode).
  3. makefile         new .scm files under cql/lisp/ (and subdirectories) must be
                      registered in that directory's Makefile SCRTn.
  4. load-path        (load "...") with a directory separator must use the
                      (string-append (getenv "CCRUN") "/cql/...") absolute-prefix style
                      (path ambiguity, domain/facts.md fact 3).
  5. template-install when changing files with a .TRGT := X.template install convention
                      (menu.scm etc.), remind to confirm the template install convention
                      is kept in sync (IN/TC must cover the site-copy merge).
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

def _explicit_repo():
    """Pre-argparse scan for a repo override: --repo <dir> / --repo=<dir> /
    CQL_LINT_REPO env. Replay trees have no .git by design, so the git walk
    below cannot resolve there — the replay runner points --repo at the
    baseline tree (or any dir that carries the repo-relative paths)."""
    argv = sys.argv[1:]
    for i, a in enumerate(argv):
        if a == "--repo" and i + 1 < len(argv):
            return Path(argv[i + 1]).resolve()
        if a.startswith("--repo="):
            return Path(a.split("=", 1)[1]).resolve()
    if os.environ.get("CQL_LINT_REPO"):
        return Path(os.environ["CQL_LINT_REPO"]).resolve()
    return None

def _find_repo_root() -> Path:
    """Repository root: an explicit --repo / CQL_LINT_REPO override, else the
    git toplevel of this file's checkout, else walk up to
    the nearest .git entry (file or dir, so worktrees match). Never derive
    the root from __file__ depth: moving this file silently repoints every
    repo path (the earlier pack move to skills/sz-dev/references/cql broke
    parents[3]). The walk-up matches .git only — an AGENTS.md marker would
    stop early at skills/sz-dev/AGENTS.md."""
    explicit = _explicit_repo()
    if explicit is not None:
        if not explicit.is_dir():
            sys.exit("cql_lint: --repo is not a directory: " + str(explicit))
        return explicit
    here = Path(__file__).resolve().parent
    try:
        top = subprocess.run(
            ["git", "-C", str(here), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True).stdout.strip()
        if top and Path(top).is_dir():
            return Path(top)
    except (subprocess.CalledProcessError, OSError):
        pass
    for p in here.parents:
        if (p / ".git").exists():
            return p
    sys.exit("cql_lint: cannot locate the repository root from " + str(here)
             + " — pass --repo <dir> (or set CQL_LINT_REPO) on a replay/gitless tree")


REPO = _find_repo_root()
CCI_C = REPO / "cclib" / "cqlA" / "cci.c"
CQLA_DIR = REPO / "cclib" / "cqlA"
HLP = REPO / "cql" / "lisp" / "cql.hlp"
LISP_DIR = REPO / "cql" / "lisp"


WRITE_PRIMITIVES = ("db-start-write", "db-newd")  # write-path API entry points


class Finding:
    def __init__(self, check: str, path: Path, line: int, msg: str, error: bool):
        self.check, self.path, self.line, self.msg, self.error = check, path, line, msg, error

    def format(self) -> str:
        level = "ERROR" if self.error else "WARN"
        loc = f"{self.path.relative_to(REPO).as_posix()}:{self.line}" if self.line else \
              self.path.relative_to(REPO).as_posix()
        return f"[{self.check}] {level} {loc} {self.msg}"


def git_changed(base: str) -> set[str]:
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", "--diff-filter=ACMR", base],
            cwd=REPO, capture_output=True, text=True, check=True).stdout
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=REPO, capture_output=True, text=True, check=True).stdout
        return {REPO.joinpath(p).resolve() for p in (out + untracked).splitlines() if p.strip()}
    except subprocess.CalledProcessError:
        return set()


def git_added_lines(path: Path, base: str) -> set[int]:
    """Line numbers of lines added in git diff -U0 for this file (untracked new file = all lines)."""
    try:
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard", "--",
             str(path.relative_to(REPO))],
            cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
        if untracked:
            return set(range(1, len(path.read_text(errors="replace").splitlines()) + 2))
        p = subprocess.run(["git", "diff", "-U0", base, "--", str(path.relative_to(REPO))],
                           cwd=REPO, capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError:
        return set()
    lines: set[int] = set()
    new_start = 0
    for ln in p.splitlines():
        m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", ln)
        if m:
            new_start = int(m.group(1))
            continue
        if ln.startswith("+") and not ln.startswith("+++"):
            lines.add(new_start)
            new_start += 1
        elif not ln.startswith("-"):
            new_start += 1
    return lines


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


# ---------- 1. help-sync ----------

def parse_registrations() -> list[tuple[str, str, int]]:
    """cci.c's init_subr("name", tc_*, cciFunc) → (name, func, line)."""
    regs = []
    for m in re.finditer(
            r'init_subr\("([^"]+)",\s*tc_\w+,\s*\(obj\s*\*\(\*\)\s*\(\)\)\s*(\w+)\)',
            read(CCI_C)):
        line = read(CCI_C)[:m.start()].count("\n") + 1
        regs.append((m.group(1), m.group(2), line))
    return regs


def hlp_keys() -> set[str]:
    return set(re.findall(r"^\(([a-zA-Z0-9?<>!=+_*/-]+)", read(HLP), re.M))


# ---------- 2. disable-storage ----------

def function_span(src: str, start_line: int) -> tuple[int, int]:
    """From the LISP <func>( definition line, take the function body line range by brace balancing."""
    lines = src.splitlines()
    depth = 0
    opened = False
    for i in range(start_line, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if "{" in lines[i]:
            opened = True
        if opened and depth <= 0:
            return start_line, i + 1
    return start_line, len(lines)


# ---------- 3. makefile SCRTn ----------

def scrt_files(makefile: Path) -> set[str]:
    return set(re.findall(r"^SCRT\d+\s*:=\s*(\S+)", read(makefile), re.M))


# ---------- main ----------

def run(changed_only: bool, strict: bool, base: str,
        explicit: list[Path] | None = None) -> int:
    if explicit:
        # replay/gitless mode: the caller names the files (changed-paths.txt);
        # every named file is enforced, nothing needs git
        changed = set()
        for p in explicit:
            fp = p if p.is_absolute() else REPO / p
            if not fp.is_file():
                sys.exit(f"cql_lint: explicit path is not a file (under {REPO}): {p}")
            changed.add(fp.resolve())
    else:
        changed = git_changed(base)
    if changed_only and not changed:
        print("cql_lint: no changed files vs", base)
        return 0

    def enforce(p: Path) -> bool:
        """Whether this file is enforced as error: --strict enforces everything;
        otherwise only changed files in changed mode, --all downgrades everything to warning."""
        return strict or (changed_only and p.resolve() in changed)

    def skip(p: Path) -> bool:
        """In changed mode, skip pre-existing debt in unchanged files (avoids flooding the output)."""
        return changed_only and not strict and p.resolve() not in changed

    findings: list[Finding] = []

    # 1. help-sync: enforce only on registration lines added this time; pre-existing debt is skipped in changed mode
    regs = parse_registrations()
    keys = hlp_keys()
    added_reg_lines = git_added_lines(CCI_C, base) if CCI_C.resolve() in changed else set()
    for name, _fn, line in regs:
        if name not in keys:
            is_new = line in added_reg_lines
            if changed_only and not strict and not is_new:
                continue  # pre-existing debt would flood the output; skipped (visible under --all / --strict)
            findings.append(Finding(
                "help-sync", CCI_C, line,
                f'primitive "{name}" has no cql.hlp entry '
                f'({"new registration" if is_new else "existing debt"})',
                enforce(CCI_C) if is_new else strict))

    # 2. disable-storage: check the write path for every registered C function
    seen_funcs: set[str] = set()
    for _name, fn, _line in regs:
        if fn in seen_funcs:
            continue
        seen_funcs.add(fn)
        for cfile in CQLA_DIR.glob("*.c"):
            src = read(cfile)
            m = re.search(rf"^LISP\s+{fn}\s*\(", src, re.M)
            if not m:
                continue
            start = src[:m.start()].count("\n") + 1
            lo, hi = function_span(src, start)
            body = "\n".join(src.splitlines()[lo - 1:hi])
            hits = [w for w in WRITE_PRIMITIVES if w in body]
            if hits and "disable_storage" not in body:
                if skip(cfile):
                    continue
                findings.append(Finding(
                    "disable-storage", cfile, lo,
                    f'write primitive {fn} (uses {hits[0]}) lacks disable_storage check '
                    f'({"new code" if enforce(cfile) else "existing debt"})',
                    enforce(cfile)))
            break

    # 3. makefile SCRTn (cql/lisp and subdirectories)
    for makefile in [LISP_DIR / "Makefile", *(LISP_DIR.glob("*/Makefile"))]:
        if not makefile.exists():
            continue
        known = scrt_files(makefile)
        for f in makefile.parent.glob("*.scm"):
            if f.name not in known:
                if skip(f):
                    continue
                findings.append(Finding(
                    "makefile", f, 0,
                    f"not registered in {makefile.relative_to(REPO).as_posix()} SCRTn "
                    f'({"new file" if enforce(f) else "existing debt"})',
                    enforce(f)))

    # 4. load-path: relative loads with a directory separator must use the absolute prefix
    for scm in list(LISP_DIR.rglob("*.scm")):
        if changed_only and scm.resolve() not in changed:
            continue
        for i, ln in enumerate(read(scm).splitlines(), 1):
            for m in re.finditer(r'\(load\s+"([^"]+)"', ln):
                path = m.group(1)
                if "/" in path and not re.search(
                        r'\$\{?(CCRUN|CCSYSDIR|HL7BASEDIR)\}?|string-append|getenv', ln):
                    findings.append(Finding(
                        "load-path", scm, i,
                        f'relative load "{path}" — use (string-append (getenv "CCRUN") "/cql/...") style '
                        f"(path ambiguity, domain/facts.md fact 3)", enforce(scm)))

    # 5. template-install: a file with a .TRGT := X.template convention changed → remind
    if (LISP_DIR / "Makefile").exists():
        mk = read(LISP_DIR / "Makefile")
        for m in re.finditer(r"^SCRT\d+\s*:=\s*(\S+)\s*$\n^\(SCRT\d+\)\.TRGT\s*:=\s*\1\.template",
                             mk, re.M):
            f = LISP_DIR / m.group(1)
            if f.exists() and (enforce(f) and f.resolve() in changed):
                findings.append(Finding(
                    "template-install", f, 0,
                    "installed as *.template — confirm site runtime copies merge "
                    "(IN/TC must cover the template install convention)", error=False))

    errors = 0
    for f in sorted(findings, key=lambda x: (not x.error, str(x.path))):
        print(f.format())
        if f.error:
            errors += 1
    print(f"cql_lint: {errors} error(s), "
          f"{sum(1 for f in findings if not f.error)} warning(s)")
    return 1 if errors else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--changed", action="store_true", default=True,
                    help="enforce only git-changed files (default)")
    ap.add_argument("--all", action="store_true", help="full scan mode")
    ap.add_argument("--strict", action="store_true", help="report pre-existing issues as errors too")
    ap.add_argument("--base", default="HEAD", help="git comparison base")
    ap.add_argument("--repo", default=None,
                    help="explicit repo/tree root (replay trees have no .git; "
                         "CQL_LINT_REPO env works too)")
    ap.add_argument("paths", nargs="*",
                    help="explicit files to enforce, repo-relative or absolute "
                         "(replay/gitless mode — replaces the git-changed set)")
    args = ap.parse_args()
    return run(changed_only=not args.all, strict=args.strict, base=args.base,
               explicit=[Path(p) for p in args.paths] or None)


if __name__ == "__main__":
    sys.exit(main())
