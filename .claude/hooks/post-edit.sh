#!/usr/bin/env bash
# PostToolUse hook (matcher Edit|Write|MultiEdit|NotebookEdit): format / regenerate by app,
# using only tools that are installed (each branch is skipped when its binary is missing),
# and remember which apps this session touched so the Stop gate checks only those.
#
#   apps/server   -> apps/server/.claude/hooks/post-edit.sh (gofumpt; task gen on .sql/.proto)
#   apps/web      -> biome check --write from the workspace root (one biome.json for shared, app, admin, landing);
#                    unfixable findings go to stderr, exit 2, so the model sees them. Touched project is recorded
#                    as web-app / web-admin / web-landing / web-shared so the Stop gate lints the right project(s).
#   apps/android  -> ktlint -F
#   apps/apple    -> swift-format format -i
#   apps/desktop -> rustfmt (single file, best effort)
#
# Formatting never fails an edit: every branch except biome's report is best effort and exits 0.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO="$HOOK_DIR/lib/hook-io.mjs"
ROOT="$(cd "$HOOK_DIR/../.." && pwd)"

command -v node >/dev/null 2>&1 || exit 0
INPUT="$(cat)"
rel="$(printf '%s' "$INPUT" | node "$IO" field file_path 2>/dev/null || true)"
[ -n "$rel" ] || exit 0

app=""
case "$rel" in
  apps/server/*) app=server ;;
  apps/web/app/*) app=web-app ;;
  apps/web/admin/*) app=web-admin ;;
  apps/web/landing/*) app=web-landing ;;
  apps/web/shared/*) app=web-shared ;;
  apps/web/*) app=web-shared ;;
  apps/android/*) app=android ;;
  apps/apple/*) app=apple ;;
  apps/desktop/*) app=desktop ;;
  *) exit 0 ;;
esac

# Record the touched app for stop-gate.sh (per session, outside the repo).
sid="$(printf '%s' "$INPUT" | node "$IO" field session_id 2>/dev/null || echo unknown)"
state="${TMPDIR:-/tmp}/aedst-claude-touched-$sid"
{ grep -qx "$app" "$state" 2>/dev/null || echo "$app" >>"$state"; } 2>/dev/null || true

abs="$ROOT/$rel"
[ -f "$abs" ] || exit 0

case "$app" in
  server)
    # The server keeps its own hook so it works when Claude Code is launched inside apps/server.
    printf '%s' "$INPUT" | CLAUDE_PROJECT_DIR="$ROOT/apps/server" bash "$ROOT/apps/server/.claude/hooks/post-edit.sh" || true
    ;;
  web-*)
    case "$rel" in
      *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.css)
        [ -d "$ROOT/apps/web/node_modules" ] || exit 0
        command -v pnpm >/dev/null 2>&1 || exit 0
        out="$(cd "$ROOT/apps/web" && pnpm --silent biome check --write --no-errors-on-unmatched "$abs" 2>&1)" || {
          printf 'biome check --write left findings in %s:\n%s\n' "$rel" "$out" >&2
          exit 2
        }
        ;;
    esac
    ;;
  android)
    case "$rel" in
      *.kt | *.kts) command -v ktlint >/dev/null 2>&1 && (cd "$ROOT/apps/android" && ktlint -F "$abs" >/dev/null 2>&1) ;; esac
    ;;
  apple)
    case "$rel" in
      *.swift)
        if command -v swift-format >/dev/null 2>&1; then
          swift-format format -i --configuration "$ROOT/apps/apple/.swift-format" "$abs" >/dev/null 2>&1
        elif command -v swift >/dev/null 2>&1; then
          swift format -i --configuration "$ROOT/apps/apple/.swift-format" "$abs" >/dev/null 2>&1
        fi
        ;;
    esac
    ;;
  desktop)
    case "$rel" in
      *.rs) command -v rustfmt >/dev/null 2>&1 && (cd "$ROOT/apps/desktop" && rustfmt --edition 2024 "$abs" >/dev/null 2>&1) ;; esac
    ;;
esac

exit 0
