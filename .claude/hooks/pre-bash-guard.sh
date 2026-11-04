#!/usr/bin/env bash
# PreToolUse hook (matcher Bash): refuse bulk git staging in a working tree that several
# sessions share. `git add -A` / `git add .` / `git commit -a` stage every session's
# uncommitted work, so one session's commit silently absorbs another's half-done change
# (this happened on 2026-11-04: a Next.js security bump and a lint migration landed under an
# unrelated admin commit). Stage the paths you changed, by name.
#
# Contract: same as pre-edit-guard.sh (deny JSON on stdout, exit 0; anything else allows).
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IO="$HOOK_DIR/lib/hook-io.mjs"

command -v node >/dev/null 2>&1 || exit 0
cmd="$(node "$IO" field command 2>/dev/null || true)"
[ -n "$cmd" ] || exit 0

# One git invocation per segment of a compound command (&&, ||, ;, |, newline).
git_re='(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+'
bulk_add="${git_re}add([[:space:]]+[^;&|]*)?[[:space:]](-A|--all|-u|--update|\.|\./|:/|\*)([[:space:];&|]|$)"
commit_all="${git_re}commit([[:space:]]+[^;&|]*)?[[:space:]](--all|-[a-zA-Z]*a[a-zA-Z]*)([[:space:];&|]|$)"

reason=""
if printf '%s\n' "$cmd" | grep -Eq -- "$bulk_add"; then
  reason="bulk staging (git add -A / . / -u / --all)"
elif printf '%s\n' "$cmd" | grep -Eq -- "$commit_all"; then
  reason="git commit -a / --all"
fi
[ -n "$reason" ] || exit 0

node "$IO" deny "Refusing $reason: several sessions share this working tree, so it would commit other sessions' uncommitted work. Stage only the files you changed by path (git add <path> ...), check git diff --staged, then commit. See docs/agent/rules.md (\"Working tree hygiene\")."
exit 0
