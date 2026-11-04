#!/usr/bin/env bash
# Dependency policy for apps/apple (Library-First, machine-enforced):
#   1. every `.package(url: ...)` in apps/apple/**/Package.swift is listed in scripts/approved-packages.txt;
#   2. Features/*/Package.swift and App/Shared/Package.swift declare NO remote package (3rd-party SDKs live in
#      Core/* wrappers only; features and the composition root consume the wrappers);
#   3. no Core/*/Package.swift references a Features/ path (Core never depends upward);
#   4. an approved URL is declared only by its owning Core package (the `; Core/X` note in the list).
# Needs only bash + grep + sed. Usage:
#   scripts/check-dependencies.sh                 check the real tree
#   scripts/check-dependencies.sh --self-test     fixtures: bad tree must fail (each rule), good tree must pass
#   scripts/check-dependencies.sh ROOT [LIST]     check ROOT as if it were apps/apple
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

run_check() {
  local root="$1" list="$2" status=0
  cd "$root"

  # Approved list (bash 3.2 compatible, no associative arrays): one normalised URL per line, plus a lookup.
  approved="$(sed -E -e 's/#.*//' -e 's/[[:space:]]+//g' -e '/^$/d' "$list")"
  owner_of() { grep -E "^[[:space:]]*$1[[:space:]]*#" "$list" | grep -oE 'Core/[A-Za-z0-9]+' | tail -1 || true; }

  while IFS= read -r manifest; do
    rel="${manifest#./}"; rel="${rel%.fixture}"
    # Drop whole-line comments and trailing " // ..." comments, join lines so multi-line `.package(` calls parse.
    body="$(sed -E -e '/^[[:space:]]*\/\//d' -e 's/[[:space:]]\/\/[[:space:]].*$//' "$manifest" | tr '\n' ' ')"
    urls="$(echo "$body" | grep -oE '\.package\([[:space:]]*url:[[:space:]]*"[^"]+"' | sed -E 's/.*"([^"]+)"/\1/' || true)"

    for url in $urls; do
      norm="${url%.git}"; norm="${norm%/}"
      case "$rel" in
        Features/*|App/Shared/*)
          echo "::error file=apps/apple/$rel::remote package $norm in a feature/composition package; declare it in a Core/* wrapper instead"
          status=1 ;;
      esac
      if ! printf '%s\n' "$approved" | grep -qxF "$norm"; then
        echo "::error file=apps/apple/$rel::$norm is not in scripts/approved-packages.txt (update library-first/apple.md and the list together)"
        status=1
      else
        want="$(owner_of "$norm")"
        if [ -n "$want" ] && [ "$rel" != "$want/Package.swift" ]; then
          echo "::error file=apps/apple/$rel::$norm is owned by $want; only that package may declare it"
          status=1
        fi
      fi
    done

    case "$rel" in
      Core/*/Package.swift)
        if echo "$body" | grep -qE '\.package\([[:space:]]*path:[[:space:]]*"[^"]*Features/'; then
          echo "::error file=apps/apple/$rel::Core package depends on a Features/ package (dependencies point downward only)"
          status=1
        fi ;;
    esac
  done < <(find . '(' -name Package.swift -o -name Package.swift.fixture ')' -not -path '*/.build/*' -not -path '*/checkouts/*' -not -path '*/.swiftpm/*' -not -path '*/scripts/fixtures/*' | sort)

  return "$status"
}

if [ "${1:-}" = "--self-test" ]; then
  fx="$here/fixtures/dependencies"
  ok=0
  if ! run_check "$fx/good" "$fx/approved-packages.txt" >/dev/null 2>&1; then echo "SELF-TEST FAIL: good tree rejected"; ok=1; fi
  for bad in "$fx"/bad/*/; do
    name="$(basename "$bad")"
    if run_check "$bad" "$fx/approved-packages.txt" >/dev/null 2>&1; then echo "SELF-TEST FAIL: bad fixture '$name' was accepted"; ok=1; fi
  done
  [ "$ok" -eq 0 ] && echo "OK self-test: good tree passes, every bad fixture fails (check-dependencies.sh)."
  exit "$ok"
fi

root="${1:-$here/..}"
list="${2:-$here/approved-packages.txt}"
if run_check "$(cd "$root" && pwd)" "$(cd "$(dirname "$list")" && pwd)/$(basename "$list")"; then
  echo "OK: apps/apple dependencies match scripts/approved-packages.txt and the layer rules."
else
  exit 1
fi
