#!/usr/bin/env bash
# Run a command only when its binary exists; otherwise print a one-line skip notice and succeed.
# Used by lefthook.yml for the native linters (ktlint, swiftlint, clang-format, gitleaks): their
# toolchains are optional locally, CI is the authority. Keeping this in a script (not inline in
# lefthook.yml) avoids multi-line `run:` quoting differences between sh on Linux/macOS and Git Bash.
#
#   scripts/run-if-installed.sh <binary> "<why it is skipped / what CI runs>" [args...]
#
# Runs `<binary> [args...]` in the current directory (lefthook's `root:`).
set -uo pipefail

bin="${1:?usage: run-if-installed.sh <binary> <hint> [args...]}"
hint="${2:?usage: run-if-installed.sh <binary> <hint> [args...]}"
shift 2

if ! command -v "$bin" >/dev/null 2>&1; then
  echo "skip: $bin is not installed ($hint)"
  exit 0
fi
exec "$bin" "$@"
