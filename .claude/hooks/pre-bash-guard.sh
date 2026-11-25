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

# Fail closed: without node no guard can run, so refuse instead of silently allowing.
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"node is not on PATH, so the security hooks cannot run. Install the pinned toolchain (mise install) and retry."}}'
  exit 0
fi
input="$(cat)"
cmd="$(printf '%s' "$input" | node "$IO" field command 2>/dev/null || true)"
[ -n "$cmd" ] || exit 0

# Mark the start of this command: post-bash.sh scans every source file changed after the marker, so
# writing a file through the shell (heredoc, sed -i, tee) cannot skip the dangerous-code gate.
sid="$(printf '%s' "$input" | node "$IO" field session_id 2>/dev/null || echo unknown)"
touch "${TMPDIR:-/tmp}/aedst-claude-bash-$sid" 2>/dev/null || true

# One git invocation per segment of a compound command (&&, ||, ;, |, newline).
git_re='(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+'
bulk_add="${git_re}add([[:space:]]+[^;&|]*)?[[:space:]](-A|--all|-u|--update|\.|\./|:/|\*)([[:space:];&|]|$)"
commit_all="${git_re}commit([[:space:]]+[^;&|]*)?[[:space:]](--all|-[a-zA-Z]*a[a-zA-Z]*)([[:space:];&|]|$)"

# The security gate's own files are human-maintained (same list as isProtectedGateFile in
# scripts/dangerous-code/scan.mjs). A shell command that names one of them and writes, moves or deletes
# is refused; reading them is fine.
gate_files='(\.claude/(settings\.json|hooks/)|scripts/check-dangerous-code\.mjs|scripts/dangerous-code|scripts/test/check-dangerous-code|scripts/check-hooks\.sh|\.semgrep/|lefthook\.yml)'
# Only an actual write to a gate file is refused, never a mere mention (`bash scripts/check-hooks.sh 2>&1`):
#   1. a redirection whose target is a gate file (`> lefthook.yml`, `>> .claude/hooks/x.sh`); `2>&1` is not one;
#   2. a mutating command, first word of a segment, with a gate file among its arguments;
#   3. a script call that writes a file and names a gate file in the same segment.
redirect_to_gate=">{1,2}[[:space:]]*[\"']?[^[:space:];&|<>]*${gate_files}"
mutate_gate="(^|[;&|(])[[:space:]]*(sudo[[:space:]]+)?(tee|mv|cp|rm|truncate|install|ln|chmod|sed[[:space:]]+(-[a-zA-Z]*i|--in-place)|perl[[:space:]]+-[a-zA-Z]*i|git[[:space:]]+(checkout|restore|rm|mv|apply)|Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Move-Item|Copy-Item)([[:space:]][^;&|]*)?${gate_files}"
script_write_gate="(writeFile|appendFile|WriteAllText)[^;&|]*${gate_files}|${gate_files}[^;&|]*(writeFile|appendFile|WriteAllText)"

reason=""
if printf '%s\n' "$cmd" | grep -Eq -- "$redirect_to_gate|$mutate_gate|$script_write_gate"; then
  node "$IO" deny "Refusing a shell command that changes a security gate file (.claude/settings.json, .claude/hooks, scripts/check-dangerous-code.mjs, scripts/dangerous-code, .semgrep, lefthook.yml). These files are human-maintained: ask the user to make the change."
  exit 0
fi
if printf '%s\n' "$cmd" | grep -Eq -- "$bulk_add"; then
  reason="bulk staging (git add -A / . / -u / --all)"
elif printf '%s\n' "$cmd" | grep -Eq -- "$commit_all"; then
  reason="git commit -a / --all"
fi
[ -n "$reason" ] || exit 0

node "$IO" deny "Refusing $reason: several sessions share this working tree, so it would commit other sessions' uncommitted work. Stage only the files you changed by path (git add <path> ...), check git diff --staged, then commit. See docs/agent/rules.md (\"Working tree hygiene\")."
exit 0
