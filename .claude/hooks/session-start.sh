#!/usr/bin/env bash
# SessionStart hook (repo root): put the three facts an agent most often gets wrong into context
# before the first prompt, so it does not have to be told (or to guess):
#   1. which platforms were actually built (Apple and Desktop were not: never claim they build);
#   2. how big the uncommitted tree is (a large one means "do not start unrelated work on top of it");
#   3. that `task` is the single entry point and `docs/agent/INDEX.md` the map.
#
# Contract (Claude Code hooks): stdout JSON {"hookSpecificOutput":{"hookEventName":"SessionStart",
# "additionalContext":"..."}} and exit 0. This hook never fails a session: any problem prints nothing.
#
# Environment:
#   AEDST_SESSION_START=off   print nothing
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO="$HOOK_DIR/lib/hook-io.mjs"
ROOT="$(cd "$HOOK_DIR/../.." && pwd)"

[ "${AEDST_SESSION_START:-on}" = "off" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0
cat >/dev/null # the hook input is not needed

dirty=0
if command -v git >/dev/null 2>&1; then
  dirty="$(cd "$ROOT" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
fi

msg="AEDST reminders. Verification status: Server and Web build and test; Android is verified on the JVM only (never on a device); Apple and Desktop were never compiled, so do not claim they build (docs/content/status.md). Use \`task\` (not ad-hoc commands); \`task doctor\` shows what this machine can verify. Start at docs/agent/INDEX.md and read only the rows for your platform and task."
if [ "${dirty:-0}" -gt 200 ] 2>/dev/null; then
  msg="$msg WARNING: the working tree has $dirty uncommitted changes. Do not start unrelated work on top of it; ask the user to commit in atomic steps first (see 'Working tree hygiene' in docs/agent/github-setup.md)."
fi

printf '%s' "$msg" | node "$IO" context
exit 0
