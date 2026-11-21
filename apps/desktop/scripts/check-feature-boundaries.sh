#!/usr/bin/env bash
# Module-boundary gates for apps/desktop (docs/content/desktop/boundaries.md). Needs bash and node only:
# no cargo, so it runs on every machine and in policies-ci. It reads the crates' Cargo.toml files and the
# `.rs` / `.slint` sources; it does not prove that anything compiles.
#
#   D1  a feature crate never depends on another feature crate (Cargo.toml and `use` level)
#   D2  a feature depends only on the allowed core crates (aedst-api, aedst-common, aedst-contract,
#       aedst-outbox; tests also aedst-persistence)
#   D3  the same at source level (`aedst_<crate>` paths, `../aedst-<crate>` build paths)
#   D4  only the aedst-desktop binary composes features; a core crate never names a feature
#   D5  a feature `.slint` never imports `std-widgets.slint` (the kit aedst-ui wraps it) or another crate's views
#   D6  layout: flat (one capability) or `src/<feature>/` + `ui/<feature>/` (+ `shared`), never mixed
#
# The dependency policy rides on this entry point, like the Apple gates do (CI and `task check:boundaries`
# both call it): approved direct dependencies, shared versions with apps/gateway, lint parity.
#
# Usage: check-feature-boundaries.sh               check the real tree, then run the negative self-tests
#        check-feature-boundaries.sh --self-test   only the negative self-tests
#        check-feature-boundaries.sh --no-self-test   only the real tree (pre-commit)
set -uo pipefail

cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "check-feature-boundaries: node is required" >&2; exit 1; }

status=0
mode="${1:-}"

if [ "$mode" != "--self-test" ]; then
  node check-feature-boundaries.mjs || status=1
  bash check-approved-crates.sh --no-self-test || status=1
fi

if [ "$mode" != "--no-self-test" ]; then
  # A gate that stops failing on its seeded violations is broken.
  node check-feature-boundaries.mjs --self-test >/dev/null || { echo "::error::check-feature-boundaries self-test failed (run with --self-test)"; status=1; }
  bash check-approved-crates.sh --self-test >/dev/null || { echo "::error::check-approved-crates self-test failed (run with --self-test)"; status=1; }
  [ "$status" -eq 0 ] && echo "OK: negative self-tests of both desktop gates pass."
fi

exit "$status"
