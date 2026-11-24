#!/usr/bin/env bash
# PreToolUse hook (matcher Edit|Write|MultiEdit|NotebookEdit): refuse to edit generated files.
# Generated code is regenerated from its source (task gen, pnpm connect:generate, make generate,
# pnpm --dir packages/design-tokens build), never edited by hand. The globs mirror the
# "generated code" block of scripts/file-size.config; keep the two in step.
#
# Contract (Claude Code hooks): reads the hook JSON on stdin; to deny, prints
# {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}} and exits 0.
# Anything else (including unparsable input such as `{}`) allows the edit: print nothing, exit 0.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO="$HOOK_DIR/lib/hook-io.mjs"

command -v node >/dev/null 2>&1 || exit 0
input="$(cat)"
rel="$(printf '%s' "$input" | node "$IO" field file_path 2>/dev/null || true)"
[ -n "$rel" ] || exit 0

regen=""
case "$rel" in
  apps/server/gen/* | apps/server/internal/*/sqlc/* | apps/server/internal/*/db/*.sql.go | *.pb.go | *_connect.go)
    regen="task server:gen" ;;
  apps/web/shared/api/*/generated/* | *_pb.ts | *_pb.js)
    regen="task web:generate (pnpm connect:generate)" ;;
  apps/web/*/next-env.d.ts)
    regen="next dev / next build rewrites it" ;;
  apps/web/shared/ui/tokens.css | packages/design-tokens/dist/* | */aedst_tokens.slint | */AedstLightPalette.* | */AedstDarkPalette.*)
    regen="pnpm --dir packages/design-tokens build" ;;
  apps/android/core/network/src/main/kotlin-gen/*)
    regen="task android:generate (make generate)" ;;
  apps/apple/Core/*/Generated/* | apps/apple/*/Derived/*)
    regen="task apple:generate (make generate) / tuist generate" ;;
  apps/desktop/*/generated/* | apps/desktop/docs/generated/*)
    regen="the desktop cargo build (build.rs output is generated at build time)" ;;
  *.pb.* | *.connect.*)
    regen="the buf/protoc generation step of the owning app" ;;
  # Lock files are written by the package manager; a hand edit breaks integrity hashes.
  */pnpm-lock.yaml | pnpm-lock.yaml | */go.sum | go.sum | */Cargo.lock | */buf.lock | */Package.resolved | */gradle.lockfile | */.terraform.lock.hcl)
    regen="the package manager (pnpm install, go mod tidy, cargo update, buf dep update, swift package resolve, gradle --write-locks, tofu init)" ;;
esac

# Real secret files (anything named .env or .env.<x>, except the committed *.example templates).
case "$(basename "$rel")" in
  .env.example | .env.*.example) ;;
  .env | .env.*)
    node "$IO" deny "Refusing to edit '$rel': real .env files hold secrets and are never written by the agent. Edit the committed .env.example template and tell the user which values to set."
    exit 0 ;;
esac

# Insecure code (eval, raw HTML sinks, disabled TLS checks, hard-coded secrets, ...): the same rules as
# `task check:dangerous`, applied to the text about to be written. Docs: docs/content/engineering/ai-safe-code.md.
if [ -z "$regen" ]; then
  printf '%s' "$input" | node "$HOOK_DIR/../../scripts/check-dangerous-code.mjs" --hook 2>/dev/null
  exit 0
fi

node "$IO" deny "Refusing to edit generated or tool-written file '$rel'. Change its source and regenerate: $regen. See AGENTS.md (\"Generated files are never hand-edited\")."
exit 0
