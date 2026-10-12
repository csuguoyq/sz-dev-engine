#!/bin/bash
# Per-agent session status query: ZCode.
#
# Prints one JSON line describing the latest ZCode session for the directory
# given as $1: model, provider, permission mode, token counts, session title
# and timestamps. The sqlite db is ZCode's own session store, so this fails
# silently (exit 1) when ZCode has never run in that directory.
#
# Contract (shared by every tools/<agent>-status.sh):
#   argv: <workspace directory>
#   stdout: one JSON object line (model/agent/input/output/... keys)
#   exit 0 with a line = live session found; exit non-zero = no session.
set -euo pipefail
DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || exit 1
DB="$HOME/.zcode/cli/db/db.sqlite"
[ -f "$DB" ] || exit 1
sqlite3 -readonly "$DB" "
select json_object(
  'model',      mu.model_id,
  'provider',   mu.provider_id,
  'variant',    mu.variant,
  'agent',      mu.agent,
  'mode',       mu.mode,
  'status',     mu.status,
  'input',      mu.input_tokens,
  'output',     mu.output_tokens,
  'reasoning',  mu.reasoning_tokens,
  'cacheRead',  mu.cache_read_input_tokens,
  'cacheWrite', mu.cache_creation_input_tokens,
  'updatedAt',  s.time_updated,
  'startedAt',  s.time_created,
  'slug',       s.slug,
  'sessionId',  s.id,
  'title',      s.title
)
from model_usage mu join session s on s.id = mu.session_id
where s.directory = '${DIR//\'/\'\'}'
order by mu.started_at desc limit 1;" || exit 1
