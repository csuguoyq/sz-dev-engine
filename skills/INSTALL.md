# Install Agent Skills

Copy Agent Skills from this repo's `skills/` tree into each AI client's personal skills directory so Claude Code / Cursor / ZCode / OpenCode can discover them.

> When working **inside this repository**, agents should still prefer reading from `skills/` via the root `AGENTS.md` (single source of truth). This installer is for making the same skills discoverable **from any workspace** (personal global dirs).

## One-command install

Run from the **repository root**:

```bash
node scripts/install-skills.js              # install every skill (auto-detect clients)
node scripts/install-skills.js registration # install one skill (by SKILL.md name)
node scripts/install-skills.js --list       # list installable skills; do not copy
node scripts/install-skills.js --claude     # Claude Code only (~/.claude/skills)
node scripts/install-skills.js --cursor     # Cursor only (~/.cursor/skills)
node scripts/install-skills.js --zcode      # ZCode only (~/.zcode/skills)
node scripts/install-skills.js --opencode   # OpenCode only (~/.config/opencode/skills)
```

- With no client flag, **auto-detect**: install into every client whose home config dir exists; if none are found, default to Claude Code.
- Use **at most one** client flag.
- Override the destination with `CCSRC_SKILLS_TARGET=<dir>` (all selected skills copy into that directory).
- A skill is any directory that contains `SKILL.md` (grouped layouts OK, e.g. `ehr-workflow/registration/`). The install name comes from the frontmatter `name`; the whole directory is copied (including `workflows/`, `scripts/`, `references/`, etc.).
- Does **not** change MCP configs (use `node scripts/install-mcp.js` for that).
- Restart the client or start a new session after installing.



## Client destination directories


| Client      | Flag         | Personal skills dir                 |
| ----------- | ------------ | ----------------------------------- |
| Claude Code | `--claude`   | `~/.claude/skills/<name>/`          |
| Cursor      | `--cursor`   | `~/.cursor/skills/<name>/`          |
| ZCode       | `--zcode`    | `~/.zcode/skills/<name>/`           |
| OpenCode    | `--opencode` | `~/.config/opencode/skills/<name>/` |


On Windows, `~` is the user home directory, e.g. `C:\Users\<you>\.cursor\skills\`.

## Skills available to install

Authoritative list is whatever `**/SKILL.md` exists under `skills/`. Common ones:


| name                  | Source path                  | Summary                                          |
| --------------------- | ---------------------------- | ------------------------------------------------ |
| `registration`        | `ehr-workflow/registration/` | Registration / create patient / book appointment |
| `scheduling`          | `ehr-workflow/scheduling/`   | Appointment Management                           |
| `flowsheet`           | `ehr-workflow/flowsheet/`    | Flowsheet clinical charting                      |
| `navigation`          | `ehr-ui/navigation/`         | Left icon-rail app entry                         |
| `browser-testing`     | `ehr-ui/browser-testing/`    | EHR browser test URL / credentials               |
| `patient-control`     | `ehr-ui/patient-control/`    | Patient Control patient selection                |
| `package-git-changes` | `package-git-changes/`       | Package Git changes into an SZ delivery ZIP      |
| `sz-dev`              | `sz-dev/`                    | SoftZilla SZ end-to-end development workflow     |


List names:

```bash
node scripts/install-skills.js --list
```



## Behavior notes

1. **Same-name overwrite**: if the destination already has that skill name, it is removed and recopied (other unrelated skills are left alone).
2. **No repo mutation**: writes only under the user home (or `CCSRC_SKILLS_TARGET`).
3. **Name collisions**: if multiple `SKILL.md` files share the same `name`, the script exits with an error.
4. **In-repo preference**: when developing in this repo, keep reading `skills/...`; global installs are for other checkouts / chat-only sessions.



## Verify the install

```bash
# Claude
ls ~/.claude/skills/*/SKILL.md

# Cursor
ls ~/.cursor/skills/*/SKILL.md

# ZCode
ls ~/.zcode/skills/*/SKILL.md

# OpenCode
ls ~/.config/opencode/skills/*/SKILL.md
```

In a new client session, trigger a task that matches the skill `description`, or explicitly ask to follow the `registration` / `sz-dev` skill.

## Manual install (optional)

Without the script, copy a skill directory to the target, for example:

```bash
cp -R skills/ehr-workflow/registration ~/.cursor/skills/registration
cp -R skills/sz-dev ~/.claude/skills/sz-dev
```

Prefer a directory name that matches the `name` field in `SKILL.md`.