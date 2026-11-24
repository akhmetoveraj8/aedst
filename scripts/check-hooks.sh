#!/usr/bin/env bash
# Smoke test for the Claude Code hooks (.claude/hooks and apps/server/.claude/hooks).
#
#   bash scripts/check-hooks.sh
#
# Verifies, by really piping JSON into every hook script:
#   1. settings.json files parse, use known hook events, and reference scripts that exist;
#   2. every hook exits 0 and prints nothing or valid JSON when fed `{}`;
#   3. the PreToolUse guard denies generated files (JSON contract) and allows hand-written ones,
#      including Windows-style absolute paths;
#   4. the Stop hooks print {"decision":"block","reason":...} on failure, stay silent on success and
#      honour stop_hook_active (no infinite loop).
# Needs bash and node only (no jq). It runs no formatter and no `task check`: every external command
# is replaced through AEDST_STOP_GATE_CMD / AEDST_SERVER_STOP_CMD.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
fail=0
ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1" >&2; fail=1; }

command -v node >/dev/null 2>&1 || { echo "check-hooks: node is required" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export TMPDIR="$tmp"
export CLAUDE_PROJECT_DIR="$ROOT"

# json_ok <file> <js-predicate over parsed object j>
# (The predicate travels in the environment: MSYS bash rewrites argv entries that look like /paths.)
json_ok() { PRED="$2" node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(eval(process.env.PRED)?0:1)' "$1" 2>/dev/null; }

# --- 1. settings files ----------------------------------------------------------------------
validate_settings() {
  local f="$1" base="$2"
  [ -f "$f" ] || { bad "$f is missing"; return; }
  node - "$f" "$base" <<'JS' || { bad "$f: invalid settings"; return; }
const fs = require("fs"), path = require("path");
const [file, base] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const events = new Set(["PreToolUse","PostToolUse","UserPromptSubmit","Notification","Stop","SubagentStop","PreCompact","SessionStart","SessionEnd"]);
const errs = [];
for (const [ev, groups] of Object.entries(s.hooks ?? {})) {
  if (!events.has(ev)) errs.push(`unknown hook event ${ev}`);
  for (const g of groups) {
    if (["PreToolUse","PostToolUse"].includes(ev)) {
      if (typeof g.matcher !== "string") errs.push(`${ev}: missing matcher`);
      else for (const t of g.matcher.split("|")) if (!/^(Bash|Edit|Write|MultiEdit|NotebookEdit|Read|Glob|Grep|WebFetch|WebSearch|Task|Agent|mcp__.+)$/.test(t)) errs.push(`${ev}: unknown tool ${t}`);
    }
    for (const h of g.hooks ?? []) {
      if (h.type !== "command" || !h.command) { errs.push(`${ev}: hook must be type=command with a command`); continue; }
      const m = /\$CLAUDE_PROJECT_DIR\/([^"\s]+\.sh)/.exec(h.command);
      if (!m) { errs.push(`${ev}: command does not reference $CLAUDE_PROJECT_DIR/<script>.sh`); continue; }
      if (!fs.existsSync(path.join(base, m[1]))) errs.push(`${ev}: ${m[1]} does not exist under ${base}`);
    }
  }
}
for (const k of ["allow","ask","deny"]) if (s.permissions?.[k] && !Array.isArray(s.permissions[k])) errs.push(`permissions.${k} must be an array`);
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
JS
  ok "$f parses; events, matchers and script paths are valid"
}
validate_settings .claude/settings.json "$ROOT"
validate_settings apps/server/.claude/settings.json "$ROOT/apps/server"

# --- 2. every hook survives `{}` -----------------------------------------------------------------
unset AEDST_STOP_GATE  # an operator's "off" switch must not mask the gate under test
export AEDST_STOP_GATE_CMD="true"
export AEDST_SERVER_STOP_CMD="true"
for script in .claude/hooks/*.sh apps/server/.claude/hooks/*.sh; do
  out="$tmp/out.txt"
  if printf '{}' | bash "$script" >"$out" 2>"$tmp/err.txt"; then code=0; else code=$?; fi
  if [ "$code" -ne 0 ]; then bad "$script exited $code on {}"; continue; fi
  if [ -s "$out" ] && ! json_ok "$out" 'typeof j==="object"'; then bad "$script printed non-JSON on {}"; continue; fi
  ok "$script handles {}"
done

# --- 3. PreToolUse guard -------------------------------------------------------------------------
guard=.claude/hooks/pre-edit-guard.sh
expect_deny() { # <relative or absolute path>
  local p="$1" out="$tmp/deny.json"
  node -e 'process.stdout.write(JSON.stringify({tool_name:"Edit",tool_input:{file_path:process.argv[1]}}))' "$p" | bash "$guard" >"$out" 2>/dev/null
  if json_ok "$out" 'j.hookSpecificOutput.hookEventName==="PreToolUse"&&j.hookSpecificOutput.permissionDecision==="deny"&&j.hookSpecificOutput.permissionDecisionReason.length>0'; then
    ok "guard denies $p"
  else bad "guard did not deny $p"; fi
}
expect_allow() {
  local p="$1" out="$tmp/allow.txt"
  node -e 'process.stdout.write(JSON.stringify({tool_name:"Write",tool_input:{file_path:process.argv[1]}}))' "$p" | bash "$guard" >"$out" 2>/dev/null
  if [ -s "$out" ]; then bad "guard wrongly denied $p"; else ok "guard allows $p"; fi
}
for p in \
  "$ROOT/apps/server/gen/aedst/tasks/v1/tasks.pb.go" \
  "apps/server/internal/modules/tasks/infrastructure/postgres/sqlc/query.sql.go" \
  "apps/server/gen/aedst/tasks/v1/tasksv1connect/tasks.connect.go" \
  "apps/web/shared/api/connect/generated/aedst/tasks/v1/tasks_pb.ts" \
  "packages/design-tokens/dist/tokens.css" \
  "apps/web/shared/ui/tokens.css" \
  "apps/android/core/network/src/main/kotlin-gen/com/aedst/tasks/v1/Tasks.kt" \
  "apps/apple/Core/AedstNetwork/Sources/AedstNetwork/Generated/tasks.pb.swift" \
  "apps/desktop/crates/aedst-ui/ui/aedst_tokens.slint" \
  "apps/apple/Core/AedstDesignSystem/Sources/AedstDesignSystem/AedstLightPalette.swift" \
  "apps/web/pnpm-lock.yaml" \
  "apps/server/go.sum" \
  "apps/server/buf.lock" \
  "apps/server/.env" \
  "apps/web/app/.env.production.local"; do
  expect_deny "$p"
done
# Windows-style absolute path, as Claude Code sends it on Windows.
win_root="$(node -e 'process.stdout.write(process.argv[1])' "$ROOT")"
case "$win_root" in
  /?/*) win_root="$(printf '%s' "$win_root" | sed -E 's#^/([a-z])/#\U\1:/#; s#/#\\#g')" ;;
  *) win_root="$(printf '%s' "$win_root" | sed 's#/#\\#g')" ;;
esac
if [[ "$win_root" == *\\* ]]; then
  out="$tmp/winpath.json"
  node -e 'process.stdout.write(JSON.stringify({tool_input:{file_path:process.argv[1]+"\\apps\\server\\gen\\x.pb.go"}}))' "$win_root" \
    | CLAUDE_PROJECT_DIR="$win_root" bash "$guard" >"$out" 2>/dev/null
  if json_ok "$out" 'j.hookSpecificOutput.permissionDecision==="deny"'; then ok "guard denies a backslash path"; else bad "guard did not deny a backslash path"; fi
fi
for p in "apps/server/internal/modules/tasks/domain/task.go" "apps/web/app/src/modules/tasks/ui/task-form.tsx" "apps/web/shared/api/connect/client.ts" "docs/content/status.md" "apps/web/app/src/types/messages.d.ts" "apps/server/.env.example" "apps/web/app/.env.local.example" ".claude/skills/write-spec/SKILL.md"; do
  expect_allow "$p"
done

# Insecure code is refused at write time; the same text with a waiver, and safe code, pass.
out="$tmp/danger.json"
node -e 'process.stdout.write(JSON.stringify({tool_name:"Write",tool_input:{file_path:"apps/web/app/src/modules/tasks/ui/task-form.tsx",content:"const v = eval(input);"}}))' | bash "$guard" >"$out" 2>/dev/null
if json_ok "$out" 'j.hookSpecificOutput.permissionDecision==="deny"&&j.hookSpecificOutput.permissionDecisionReason.includes("js-eval")'; then ok "guard denies eval in a source file"; else bad "guard did not deny eval in a source file"; fi
out="$tmp/danger-ok.txt"
node -e 'process.stdout.write(JSON.stringify({tool_name:"Write",tool_input:{file_path:"apps/web/app/src/modules/tasks/ui/task-form.tsx",content:"// security-ignore: reviewed constant\nconst v = eval(1);"}}))' | bash "$guard" >"$out" 2>/dev/null
if [ -s "$out" ]; then bad "guard denied a waived line"; else ok "guard allows a waived line"; fi

# --- 3b. settings.json denies the shell routes to secrets (Read(...) rules do not cover Bash) ----
if json_ok .claude/settings.json '["Bash(cat *.env.*)","Bash(grep*.env)","Bash(Get-Content*.env*)","Bash(printenv*)","Read(**/.env)","Edit(**/.env)","Bash(git commit*--no-verify*)"].every(r=>j.permissions.deny.includes(r))'; then
  ok "settings.json denies .env reads and edits through Bash, Read and Edit"
else bad "settings.json is missing a .env or --no-verify deny rule"; fi
if json_ok .claude/settings.json 'Array.isArray(j.hooks.SessionStart)&&j.hooks.SessionStart.length>0'; then ok "settings.json wires SessionStart"; else bad "settings.json has no SessionStart hook"; fi

# --- 3c. SessionStart hook ------------------------------------------------------------------------
out="$tmp/session-start.json"
printf '{}' | bash .claude/hooks/session-start.sh >"$out" 2>/dev/null
if json_ok "$out" 'j.hookSpecificOutput.hookEventName==="SessionStart"&&j.hookSpecificOutput.additionalContext.includes("Apple and Desktop were never compiled")'; then
  ok "session-start injects the verification status"
else bad "session-start did not print additionalContext"; fi
out="$tmp/session-start-off.txt"
printf '{}' | AEDST_SESSION_START=off bash .claude/hooks/session-start.sh >"$out" 2>/dev/null
[ -s "$out" ] && bad "session-start ignored AEDST_SESSION_START=off" || ok "session-start honours AEDST_SESSION_START=off"

# --- 4. Stop hooks -------------------------------------------------------------------------------
sid="smoke-$$"
touch_state() { echo "web-app" >"$tmp/aedst-claude-touched-$sid"; }
stop_json() { printf '{"session_id":"%s","stop_hook_active":%s}' "$sid" "$1"; }

touch_state
out="$tmp/stop-fail.json"
stop_json false | AEDST_STOP_GATE_CMD='echo boom-output; exit 1' bash .claude/hooks/stop-gate.sh >"$out" 2>/dev/null
if json_ok "$out" 'j.decision==="block"&&j.reason.includes("boom-output")&&!("hookSpecificOutput" in j)'; then ok "stop-gate blocks with {decision:block,reason} on failure"; else bad "stop-gate did not print block JSON on failure"; fi
[ -f "$tmp/aedst-claude-touched-$sid" ] && ok "stop-gate keeps the touched state while red" || bad "stop-gate dropped the touched state while red"

touch_state
out="$tmp/stop-budget.json"
if command -v timeout >/dev/null 2>&1; then
  stop_json false | AEDST_STOP_GATE_TIMEOUT=1 AEDST_STOP_GATE_CMD='sleep 5' bash .claude/hooks/stop-gate.sh >"$out" 2>/dev/null
  if json_ok "$out" 'j.decision==="block"&&j.reason.includes("sleep 5")'; then ok "stop-gate blocks when the time budget runs out"; else bad "stop-gate ignored AEDST_STOP_GATE_TIMEOUT"; fi
fi

out="$tmp/stop-active.txt"
stop_json true | AEDST_STOP_GATE_CMD='exit 1' bash .claude/hooks/stop-gate.sh >"$out" 2>/dev/null
[ -s "$out" ] && bad "stop-gate ignored stop_hook_active" || ok "stop-gate honours stop_hook_active"

out="$tmp/stop-green.txt"
stop_json false | AEDST_STOP_GATE_CMD='true' bash .claude/hooks/stop-gate.sh >"$out" 2>/dev/null
if [ -s "$out" ] || [ -f "$tmp/aedst-claude-touched-$sid" ]; then bad "stop-gate not silent/clean when green"; else ok "stop-gate is silent and resets state when green"; fi

out="$tmp/stop-untouched.txt"
stop_json false | AEDST_STOP_GATE_CMD='exit 1' bash .claude/hooks/stop-gate.sh >"$out" 2>/dev/null
[ -s "$out" ] && bad "stop-gate gated a session that edited nothing" || ok "stop-gate skips sessions that edited nothing"

out="$tmp/server-fail.json"
stop_json false | AEDST_SERVER_STOP_CMD='echo server-boom; exit 1' bash apps/server/.claude/hooks/on-stop.sh >"$out" 2>/dev/null
if json_ok "$out" 'j.decision==="block"&&j.reason.includes("server-boom")&&!("hookSpecificOutput" in j)'; then ok "server on-stop blocks with {decision:block,reason} on failure"; else bad "server on-stop did not print block JSON on failure"; fi
out="$tmp/server-active.txt"
stop_json true | AEDST_SERVER_STOP_CMD='exit 1' bash apps/server/.claude/hooks/on-stop.sh >"$out" 2>/dev/null
[ -s "$out" ] && bad "server on-stop ignored stop_hook_active" || ok "server on-stop honours stop_hook_active"
out="$tmp/server-green.txt"
stop_json false | AEDST_SERVER_STOP_CMD='true' bash apps/server/.claude/hooks/on-stop.sh >"$out" 2>/dev/null
[ -s "$out" ] && bad "server on-stop not silent when green" || ok "server on-stop is silent when green"

# PreToolUse Bash guard: bulk staging is denied, staging by path is allowed.
bguard=.claude/hooks/pre-bash-guard.sh
bash_json() { node -e 'process.stdout.write(JSON.stringify({tool_name:"Bash",tool_input:{command:process.argv[1]}}))' "$1"; }
for c in "git add -A" "git add ." "cd apps/web && git add --all" "git -C apps/web add -u" "git commit -am x" "git commit --all -m x"; do
  out="$tmp/bdeny.json"
  bash_json "$c" | bash "$bguard" >"$out" 2>/dev/null
  if json_ok "$out" 'j.hookSpecificOutput.permissionDecision==="deny"'; then ok "bash guard denies: $c"; else bad "bash guard did not deny: $c"; fi
done
for c in "git add apps/web/pnpm-workspace.yaml" "git add .claude/settings.json ./docs/a.md" "git commit -m 'Update data'" "git commit --amend -m x" "git status"; do
  out="$tmp/ballow.txt"
  bash_json "$c" | bash "$bguard" >"$out" 2>/dev/null
  if [ -s "$out" ]; then bad "bash guard wrongly denied: $c"; else ok "bash guard allows: $c"; fi
done

# PostToolUse dispatcher records the touched app (a non-existent file: nothing is formatted).
psid="smoke-post-$$"
printf '{"session_id":"%s","tool_input":{"file_path":"apps/desktop/crates/__no_such_file__.rs"}}' "$psid" | bash .claude/hooks/post-edit.sh >/dev/null 2>&1
if grep -qx desktop "$tmp/aedst-claude-touched-$psid" 2>/dev/null; then ok "post-edit records the touched app"; else bad "post-edit did not record the touched app"; fi

if [ "$fail" -eq 0 ]; then echo "check-hooks: OK"; else echo "check-hooks: FAILED" >&2; fi
exit "$fail"
