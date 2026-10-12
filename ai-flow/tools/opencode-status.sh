#!/bin/bash
# Per-agent session status query: OpenCode.
#
# Prints one JSON line describing the latest OpenCode session for the
# directory given as $1 — same keys the viewer's built-in OpenCode reader
# produces (model/agent/token counts), implemented as a probe so every agent
# follows the same tools/ contract. Fails silently (exit 1) when OpenCode has
# never run in that directory.
#
# Contract (shared by every tools/<agent>-status.sh):
#   argv: <workspace directory>
#   stdout: one JSON object line
#   exit 0 with a line = live session found; exit non-zero = no session.
set -euo pipefail
DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || exit 1
DB="$HOME/.local/share/opencode/opencode.db"
[ -f "$DB" ] || exit 1
sqlite3 -readonly "$DB" "
select json_object(
  'model',      json_extract(s.model,'$.id'),
  'provider',   json_extract(s.model,'$.providerID'),
  'agent',      s.agent,
  'input',      s.tokens_input,
  'output',     s.tokens_output,
  'reasoning',  s.tokens_reasoning,
  'cacheRead',  s.tokens_cache_read,
  'cacheWrite', s.tokens_cache_write,
  'updatedAt',  s.time_updated,
  'slug',       s.slug
)
from session s
where s.directory = '${DIR//\'/\'\'}'
order by s.time_updated desc limit 1;" || exit 1
