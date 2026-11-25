#!/usr/bin/env bash
# Dependency policy of the two Rust projects, apps/desktop and apps/gateway (Library-First, machine-enforced
# without cargo). Rules A1-A4, V1, L1, T1 are described at the top of check-approved-crates.mjs:
#   - every direct dependency is in that project's approved-crates.txt (next to deny.toml) and named on its
#     Library-First page; desktop crates take versions from the workspace only; nothing banned in deny.toml;
#   - a crate both projects declare has the same version requirement; lint levels and the toolchain agree.
# It lives in scripts/rust because it serves both Rust projects, so removing one (task template:new)
# never removes the other's gate.
#
# Usage: check-approved-crates.sh                  check the real tree, then the negative self-test
#        check-approved-crates.sh --self-test      only the negative self-test (fixtures in a temp dir)
#        check-approved-crates.sh --no-self-test   only the real tree
set -uo pipefail

cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "check-approved-crates: node is required" >&2; exit 1; }

status=0
mode="${1:-}"

if [ "$mode" != "--self-test" ]; then
  node check-approved-crates.mjs || status=1
fi
if [ "$mode" != "--no-self-test" ]; then
  node check-approved-crates.mjs --self-test || status=1
fi

exit "$status"
