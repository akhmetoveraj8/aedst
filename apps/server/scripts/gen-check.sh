#!/usr/bin/env bash
# Fail if generated code in gen/ is out of date with its sources.
#
# Regenerates (`task gen` equivalent: buf, sqlc, gofumpt) and compares the content
# of gen/ before and after, instead of using `git diff`, which also flags
# uncommitted but already-regenerated output on a dirty tree. On drift the
# regenerated files are left in place so `git diff -- gen/` shows what changed.
set -euo pipefail

cd "$(dirname "$0")/.."

hash_gen() {
  find gen -type f | LC_ALL=C sort | xargs sha256sum
}

before="$(hash_gen)"
buf generate
sqlc generate
gofumpt -l -w gen
after="$(hash_gen)"

if [ "$before" != "$after" ]; then
  echo "generated code in gen/ was out of date; it has been regenerated, review and commit it:" >&2
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
  exit 1
fi
echo "gen/ is up to date"
