#!/usr/bin/env bash
# Repo-wide file-size policy (CONVENTIONS.md, "File size"):
#   <= 300 lines  green   fine
#   301-400       yellow  consider splitting
#   401-500       orange  high warning, split when you next touch the file
#   > 500         red     FAILS this check (exit 1)
# Measures hand-written source only; extensions and excludes live in scripts/file-size.config.
#
# Usage:
#   scripts/check-file-size.sh                 # every non-ignored file in the repo
#   scripts/check-file-size.sh --staged        # only staged files (pre-commit)
#   scripts/check-file-size.sh --platform web  # restrict to apps/<platform> (server|web|android|apple|desktop|root)
#   scripts/check-file-size.sh --summary       # per-platform counts only
#   scripts/check-file-size.sh --warn-only     # never exit 1 (reporting mode)
# Colors: on when stdout is a TTY or GITHUB_ACTIONS is set; NO_COLOR disables, FORCE_COLOR enables.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
config="scripts/file-size.config"
staged=0 summary=0 warn_only=0 only=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staged) staged=1 ;;
    --summary) summary=1 ;;
    --warn-only) warn_only=1 ;;
    --platform) only="${2:?--platform needs a value}"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "${NO_COLOR:-}" && ( -t 1 || -n "${GITHUB_ACTIONS:-}" || -n "${FORCE_COLOR:-}" ) ]]; then
  c_g=$'\033[32m' c_y=$'\033[33m' c_o=$'\033[38;5;208m' c_r=$'\033[31m' c_b=$'\033[1m' c_0=$'\033[0m'
else
  c_g="" c_y="" c_o="" c_r="" c_b="" c_0=""
fi

yellow=300 orange=400 red=500
exts=() excludes=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  read -r key val <<<"$line" || true
  [[ -z "${key:-}" ]] && continue
  case "$key" in
    yellow) yellow="$val" ;;
    orange) orange="$val" ;;
    red) red="$val" ;;
    ext) exts+=("$val") ;;
    exclude) excludes+=("$val") ;;
    *) echo "$config: unknown key '$key'" >&2; exit 2 ;;
  esac
done <"$config"

platform_of() {
  case "$1" in
    apps/server/*) echo server ;;
    apps/web/*) echo web ;;
    apps/android/*) echo android ;;
    apps/apple/*) echo apple ;;
    apps/desktop/*) echo desktop ;;
    *) echo root ;;
  esac
}

is_measured() {
  local f="$1" e="${1##*.}" ok=0 g
  [[ "$f" == *.* ]] || return 1
  for x in "${exts[@]}"; do [[ "$e" == "$x" ]] && ok=1 && break; done
  [[ $ok -eq 1 ]] || return 1
  for g in "${excludes[@]}"; do
    # shellcheck disable=SC2053 # intentional glob match
    [[ "$f" == $g ]] && return 1
  done
  return 0
}

if [[ $staged -eq 1 ]]; then
  list=$(git diff --cached --name-only --diff-filter=ACMR)
else
  list=$(git ls-files -co --exclude-standard)
fi

files=()
while IFS= read -r f; do
  [[ -z "$f" || ! -f "$f" ]] && continue
  is_measured "$f" || continue
  p=$(platform_of "$f")
  [[ -n "$only" && "$p" != "$only" ]] && continue
  files+=("$f")
done <<<"$list"

if [[ ${#files[@]} -eq 0 ]]; then
  echo "check-file-size: no measured files"
  exit 0
fi

declare -A n_y n_o n_r n_all
for p in server web android apple desktop root; do n_y[$p]=0 n_o[$p]=0 n_r[$p]=0 n_all[$p]=0; done
rows=()
while read -r count path; do
  [[ "$path" == "total" ]] && continue
  p=$(platform_of "$path")
  n_all[$p]=$((n_all[$p] + 1))
  if (( count > red )); then n_r[$p]=$((n_r[$p] + 1)); rows+=("r $count $path")
  elif (( count > orange )); then n_o[$p]=$((n_o[$p] + 1)); rows+=("o $count $path")
  elif (( count > yellow )); then n_y[$p]=$((n_y[$p] + 1)); rows+=("y $count $path")
  fi
done < <(printf '%s\n' "${files[@]}" | xargs -d '\n' wc -l)

if [[ $summary -eq 0 && ${#rows[@]} -gt 0 ]]; then
  while read -r lvl count path; do
    case "$lvl" in
      r) printf '%s%-6s%s %5d  %s\n' "$c_r" "RED" "$c_0" "$count" "$path" ;;
      o) printf '%s%-6s%s %5d  %s\n' "$c_o" "ORANGE" "$c_0" "$count" "$path" ;;
      y) printf '%s%-6s%s %5d  %s\n' "$c_y" "YELLOW" "$c_0" "$count" "$path" ;;
    esac
  done < <(printf '%s\n' "${rows[@]}" | sort -k1,1r -k2,2nr)
  echo
fi

printf '%s%-9s %7s %8s %8s %8s%s\n' "$c_b" "platform" "files" "yellow" "orange" "red" "$c_0"
total_red=0
for p in server web android apple desktop root; do
  [[ ${n_all[$p]} -eq 0 ]] && continue
  printf '%-9s %7d %s%8d%s %s%8d%s %s%8d%s\n' "$p" "${n_all[$p]}" \
    "$c_y" "${n_y[$p]}" "$c_0" "$c_o" "${n_o[$p]}" "$c_0" "$c_r" "${n_r[$p]}" "$c_0"
  total_red=$((total_red + n_r[$p]))
done
echo "limits: yellow > $yellow, orange > $orange, red (fails) > $red lines"

if (( total_red > 0 && warn_only == 0 )); then
  printf '%sFAIL%s: %d file(s) exceed %d lines. Split them (CONVENTIONS.md, File size).\n' "$c_r" "$c_0" "$total_red" "$red" >&2
  exit 1
fi
printf '%sOK%s\n' "$c_g" "$c_0"
