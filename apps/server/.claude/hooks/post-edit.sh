#!/usr/bin/env bash
# PostToolUse hook (Edit|Write) for apps/server: keeps generated/formatted
# code from drifting while an agent is actively editing, instead of only
# catching it at `task check` time. Also invoked by the repo-root dispatcher
# (.claude/hooks/post-edit.sh) when Claude Code is launched at the repo root.
#
# No jq: JSON is read with the shared Node helper (.claude/hooks/lib/hook-io.mjs).
# Paths are resolved from this script's location, never from CLAUDE_PROJECT_DIR
# (which is apps/server or the repo root depending on where Claude Code started).
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
IO="$HOOK_DIR/../../../../.claude/hooks/lib/hook-io.mjs"

command -v node >/dev/null 2>&1 && [ -f "$IO" ] || exit 0
cd "$SERVER_ROOT" || exit 0

REL="$(CLAUDE_PROJECT_DIR="$SERVER_ROOT" node "$IO" field file_path 2>/dev/null || true)"
[ -n "$REL" ] || exit 0
FILE_PATH="$SERVER_ROOT/$REL"
case "$REL" in /* | [A-Za-z]:/*) FILE_PATH="$REL" ;; esac

case "$REL" in
  *.go)
    if command -v gofumpt >/dev/null 2>&1 && [ -f "$FILE_PATH" ]; then gofumpt -w "$FILE_PATH" || true; fi
    ;;
  sql/*/*.sql | */sql/*/*.sql | *.proto)
    if command -v task >/dev/null 2>&1; then task gen >/dev/null 2>&1 || true; fi
    ;;
esac

exit 0
