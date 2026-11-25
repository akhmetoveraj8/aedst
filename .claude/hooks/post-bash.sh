#!/usr/bin/env bash
# PostToolUse hook (matcher Bash): run the dangerous-code gate over every source file the command
# changed. pre-bash-guard.sh touches ${TMPDIR:-/tmp}/aedst-claude-bash-<session_id> right before the
# command; every tracked-modified or untracked file newer than that marker is scanned in full. The
# same pass refuses new security waivers and changes to the gate's own files.
#
# Contract (Claude Code PostToolUse): the command already ran, so the hook cannot undo it; it prints
# {"decision":"block","reason":...} so the model is told to fix the file at once. Silent when clean.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO="$HOOK_DIR/lib/hook-io.mjs"
ROOT="$(cd "$HOOK_DIR/../.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '{"decision":"block","reason":"node is not on PATH, so the dangerous-code scan of this shell command did not run. Install the pinned toolchain (mise install)."}'
  exit 0
fi
input="$(cat)"
sid="$(printf '%s' "$input" | node "$IO" field session_id 2>/dev/null || echo unknown)"
marker="${TMPDIR:-/tmp}/aedst-claude-bash-$sid"
[ -f "$marker" ] || exit 0
(cd "$ROOT" && node scripts/check-dangerous-code.mjs --post-bash "$marker" 2>/dev/null)
exit 0
