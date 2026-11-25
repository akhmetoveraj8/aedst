#!/usr/bin/env bash
# Stop hook (repo root): before the agent hands control back, run the cheap cross-platform gate
# (`task check`) and the lint/check task of every app this session edited, and block the stop
# when one fails so the model fixes it instead of leaving a red build.
#
# Stop-hook contract (Claude Code): block with top-level {"decision":"block","reason":"..."} on
# stdout and exit 0 (or reason on stderr + exit 2). `stop_hook_active` is true when the model is
# already continuing because of a Stop hook; honour it or the hook loops forever.
#
# "Touched apps" come from the PostToolUse dispatcher (post-edit.sh), which appends the app name to
# ${TMPDIR:-/tmp}/aedst-claude-touched-<session_id>. A session that edited nothing under apps/ is not gated.
#
# Environment:
#   AEDST_STOP_GATE=off          skip the lint checks (e.g. while several agents share one working tree);
#                                the dangerous-code scan still runs. Without node the stop is blocked.
#   AEDST_STOP_GATE_TIMEOUT=<s>  time budget in seconds for all checks together (default 600, below the
#                                700 s hook timeout in .claude/settings.json; needs `timeout`)
#   AEDST_STOP_GATE_CMD=<cmd>    replaces the whole check list with one command (used by scripts/check-hooks.sh)
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO="$HOOK_DIR/lib/hook-io.mjs"
ROOT="$(cd "$HOOK_DIR/../.." && pwd)"

INPUT="$(cat)"
# Fail closed: without node the gate cannot run, so the stop is blocked with a static JSON message.
if ! command -v node >/dev/null 2>&1; then
  case "$INPUT" in *'"stop_hook_active":true'*) exit 0 ;; esac
  printf '%s\n' '{"decision":"block","reason":"node is not on PATH, so the stop gate (dangerous-code scan, task check) could not run. Install the pinned toolchain (mise install), or tell the user the gate did not run."}'
  exit 0
fi
[ "$(printf '%s' "$INPUT" | node "$IO" field stop_active 2>/dev/null)" = "true" ] && exit 0

sid="$(printf '%s' "$INPUT" | node "$IO" field session_id 2>/dev/null || echo unknown)"
state="${TMPDIR:-/tmp}/aedst-claude-touched-$sid"
[ -s "$state" ] || exit 0

cd "$ROOT" || exit 0

cmds=()
if [ -n "${AEDST_STOP_GATE_CMD:-}" ]; then
  cmds+=("$AEDST_STOP_GATE_CMD")
elif [ "${AEDST_STOP_GATE:-on}" = "off" ] || ! command -v task >/dev/null 2>&1; then
  # "off" (a human's switch for shared working trees) and a missing `task` only drop the slow lint
  # checks; the security scan always runs.
  cmds+=("node scripts/check-dangerous-code.mjs")
else
  cmds+=("task check")
  while read -r app; do
    case "$app" in
      server) cmds+=("task server:check") ;;
      web-app) cmds+=("task app:lint") ;;
      web-admin) cmds+=("task admin:lint") ;;
      web-marketing) cmds+=("task marketing:lint") ;;
      web-shared) cmds+=("task web:lint") ;; # shared is used by every project
      android) command -v java >/dev/null 2>&1 && cmds+=("task android:lint") ;;
      apple) [ "$(uname -s)" = "Darwin" ] && cmds+=("task apple:lint") ;;
      desktop) cmds+=("task desktop:lint") ;;
    esac
  done < <(sort -u "$state")
fi

# All checks share one budget (AEDST_STOP_GATE_TIMEOUT seconds, default 600) when `timeout` exists: each
# check gets what is left, so the gate finishes before Claude Code kills the hook at 700 s and a hung
# toolchain is reported instead of silently cut off. Exit 124 is reported as a failure.
budget="${AEDST_STOP_GATE_TIMEOUT:-600}"
deadline=$(( $(date +%s) + budget ))
has_timeout=0
command -v timeout >/dev/null 2>&1 && has_timeout=1

failed=""
for c in "${cmds[@]}"; do
  runner=()
  if [ "$has_timeout" = 1 ]; then
    left=$(( deadline - $(date +%s) ))
    if [ "$left" -le 0 ]; then
      failed="$(printf 'The stop gate ran out of its %ss budget before `%s`. Run it yourself before stopping.' "$budget" "$c")"
      break
    fi
    runner=(timeout "$left")
  fi
  out="$(${runner[@]+"${runner[@]}"} bash -c "$c" 2>&1)" && continue
  failed="$(printf '`%s` failed. Fix it before stopping.\n\n%s' "$c" "$(printf '%s\n' "$out" | tail -n 60)")"
  break
done
if [ -z "$failed" ]; then
  rm -f "$state" # green: the next turn is only gated if it edits something again
  exit 0
fi

printf '%s' "$failed" | node "$IO" block
exit 0
