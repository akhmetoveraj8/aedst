#!/usr/bin/env bash
# Fail if `go mod tidy` would change go.mod or go.sum.
#
# Compares the files before and after tidy instead of using `git diff`, so it
# works on a dirty working tree (uncommitted edits elsewhere do not matter).
# go.mod and go.sum are always restored to what they were on entry; the fix is
# a deliberate `go mod tidy` by the developer.
set -euo pipefail

cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
cp go.mod "$tmp/go.mod"
cp go.sum "$tmp/go.sum"
restore() {
  cp "$tmp/go.mod" go.mod
  cp "$tmp/go.sum" go.sum
  rm -rf "$tmp"
}
trap restore EXIT

go mod tidy

if ! cmp -s go.mod "$tmp/go.mod" || ! cmp -s go.sum "$tmp/go.sum"; then
  echo "go.mod/go.sum are not tidy: run 'go mod tidy' in apps/server and commit the result" >&2
  diff -u "$tmp/go.mod" go.mod >&2 || true
  diff -u "$tmp/go.sum" go.sum >&2 || true
  exit 1
fi
echo "go.mod/go.sum are tidy"
