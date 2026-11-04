#!/usr/bin/env bash
# Stop hook for apps/server: before the agent hands control back, run the
# same fast gate CI runs (`task check`, from apps/server) and block the stop
# if it fails, feeding the failure back to the model instead of leaving a red
# build for a human to discover later.
#
# Stop-hook contract (Claude Code): to block, print top-level
# {"decision":"block","reason":"..."} and exit 0 (or write the reason to stderr
# and exit 2). `hookSpecificOutput.permissionDecision` is the PreToolUse
# contract and does nothing here. `stop_hook_active` is true when the model is
# already continuing because of a Stop hook; honour it or the hook loops.
#
# Test override: AEDST_SERVER_STOP_CMD replaces `task check` (scripts/check-hooks.sh).
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
IO="$HOOK_DIR/../../../../.claude/hooks/lib/hook-io.mjs"

INPUT="$(cat)"
if command -v node >/dev/null 2>&1 && [ -f "$IO" ]; then
  [ "$(printf '%s' "$INPUT" | node "$IO" field stop_active 2>/dev/null)" = "true" ] && exit 0
fi

CMD="${AEDST_SERVER_STOP_CMD:-task check}"
if [ -z "${AEDST_SERVER_STOP_CMD:-}" ]; then
  command -v task >/dev/null 2>&1 || exit 0
fi
cd "$SERVER_ROOT" || exit 0

OUTPUT="$(bash -c "$CMD" 2>&1)" && exit 0

# Keep the model's context small: the tail of the log is where the failure is.
TAIL="$(printf '%s\n' "$OUTPUT" | tail -n 60)"
REASON="$(printf 'apps/server: `%s` failed. Fix it before stopping.\n\n%s' "$CMD" "$TAIL")"

if command -v node >/dev/null 2>&1 && [ -f "$IO" ]; then
  printf '%s' "$REASON" | node "$IO" block
  exit 0
fi

printf '%s\n' "$REASON" >&2
exit 2
