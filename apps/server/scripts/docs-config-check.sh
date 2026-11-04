#!/usr/bin/env bash
# Fail if docs/content/server/config.md is out of date with config.Config's env tags.
# Compares content before and after regeneration (not `git diff`: a dirty tree is fine).
set -euo pipefail
cd "$(dirname "$0")/.."
doc=../../docs/content/server/config.md
before="$(sha256sum "$doc" 2>/dev/null || true)"
go run ./scripts/gen-config-docs
after="$(sha256sum "$doc")"
if [ "$before" != "$after" ]; then
  echo "docs/content/server/config.md was out of date; it has been regenerated (task docs:config), review and commit it" >&2
  exit 1
fi
echo "config.md is up to date"
