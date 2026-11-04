#!/usr/bin/env bash
# Static mirror of the SwiftLint custom_rules in apps/apple/.swiftlint.yml (library-first enforcement).
# Works without SwiftLint/Xcode. Default: scan the real tree, then run the negative self-test
# (fixtures under scripts/fixtures/swiftlint that MUST fail). Needs Node (already required by the repo).
set -euo pipefail
cd "$(dirname "$0")"
node swiftlint-rules-static.mjs "$@"
if [ "$#" -eq 0 ]; then
  node swiftlint-rules-static.mjs --self-test
fi
