#!/usr/bin/env bash
# Runs every platform's module-boundary check and reports one result per platform.
#   web      apps/web/app/scripts/check-feature-boundaries.sh
#   android  apps/android/scripts/check-feature-boundaries.sh
#   apple    apps/apple/scripts/check-feature-boundaries.sh
#   desktop  apps/desktop/scripts/check-feature-boundaries.sh
#   server   go test ./architecturetest/...   (needs Go; skipped with a notice when absent)
# Usage: scripts/check-boundaries.sh [platform ...]   (default: all five). Exit 1 if any check fails.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"
want=("$@")
[[ ${#want[@]} -eq 0 ]] && want=(web android apple desktop server)

if [[ -z "${NO_COLOR:-}" && ( -t 1 || -n "${GITHUB_ACTIONS:-}" ) ]]; then
  g=$'\033[32m' r=$'\033[31m' y=$'\033[33m' z=$'\033[0m'
else
  g="" r="" y="" z=""
fi

failed=0 skipped=0
run() {
  local name="$1"; shift
  echo "--- boundaries: $name"
  if "$@"; then
    printf '%sPASS%s %s\n' "$g" "$z" "$name"
  else
    printf '%sFAIL%s %s\n' "$r" "$z" "$name"
    failed=$((failed + 1))
  fi
}

for p in "${want[@]}"; do
  case "$p" in
    web|android|apple|desktop)
      if [[ -d "apps/$p" ]]; then
        script="apps/$p/scripts/check-feature-boundaries.sh"
        [[ "$p" == web ]] && script="apps/web/app/scripts/check-feature-boundaries.sh" # web hosts its gate in the app project
        run "$p" bash "$script"
      else
        # task template:new --profile core|mobile removes whole platforms
        printf '%sSKIP%s %s (apps/%s is not part of this repository profile)\n' "$y" "$z" "$p" "$p"
        skipped=$((skipped + 1))
      fi
      ;;
    server)
      if command -v go >/dev/null 2>&1; then
        run server bash -c 'cd apps/server && go test ./architecturetest/...'
      else
        printf '%sSKIP%s server (go not installed; CI runs it)\n' "$y" "$z"
        skipped=$((skipped + 1))
      fi
      ;;
    *) echo "unknown platform: $p" >&2; exit 2 ;;
  esac
done

echo
echo "boundaries: $failed failed, $skipped skipped"
[[ $failed -eq 0 ]]
