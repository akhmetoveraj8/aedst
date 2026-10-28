#!/usr/bin/env bash
# clang-format check for C++ sources (dry-run, fails on any diff).
#
#   ./scripts/check-format.sh          # check (what CI runs)
#   ./scripts/check-format.sh --fix    # rewrite files in place
#
# Picks the binary from $CLANG_FORMAT, else clang-format-<major of CLANG_FORMAT_VERSION>,
# else plain clang-format. CI pins CLANG_FORMAT_VERSION (23.1.3, the PyPI `clang-format`
# wheel, see .github/workflows/desktop-ci.yml) and passes the wheel's binary in $CLANG_FORMAT.
# Locally: `pip install clang-format==23.1.3`. When CLANG_FORMAT_VERSION is set the binary's
# version must match it (full version, or just the major number), so a different formatter
# cannot silently reformat or approve the tree.
set -euo pipefail

cd "$(dirname "$0")/.."

mode=check
[ "${1:-}" = "--fix" ] && mode=fix

bin="${CLANG_FORMAT:-}"
if [ -z "$bin" ]; then
  for candidate in "clang-format-${CLANG_FORMAT_VERSION:-23}" clang-format; do
    if command -v "$candidate" >/dev/null 2>&1; then bin="$candidate"; break; fi
  done
fi
if [ -z "$bin" ]; then
  echo "error: clang-format not found (pip install clang-format==${CLANG_FORMAT_VERSION:-23.1.3}, or set CLANG_FORMAT)." >&2
  exit 127
fi

if [ -n "${CLANG_FORMAT_VERSION:-}" ]; then
  actual=$("$bin" --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  case "$actual" in
    "$CLANG_FORMAT_VERSION" | "$CLANG_FORMAT_VERSION".*) ;;
    *) echo "error: $bin is clang-format $actual, CLANG_FORMAT_VERSION pins $CLANG_FORMAT_VERSION." >&2; exit 1 ;;
  esac
fi

# Sources under Modules/ and App/ (headers, TUs), never build output.
files=$(find Modules App -type f \( -name '*.hpp' -o -name '*.cpp' -o -name '*.h' \) -not -path '*/build/*')
if [ -z "$files" ]; then
  echo "no C++ sources found"; exit 0
fi

if [ "$mode" = fix ]; then
  echo "$files" | tr '\n' '\0' | xargs -0 "$bin" -i
  echo "OK: formatted with $("$bin" --version | head -1)"
else
  echo "$files" | tr '\n' '\0' | xargs -0 "$bin" --dry-run --Werror
  echo "OK: clang-format clean ($("$bin" --version | head -1))"
fi
