#!/usr/bin/env bash
# Lint goose SQL migrations for unsafe changes with squawk (Postgres).
#
# Only the `-- +goose Up` half of each file is linted: squawk has no notion of
# goose's `-- +goose Down` marker and would flag every rollback's DROP TABLE /
# DROP COLUMN as if it were a forward change. Files marked
# `-- +goose NO TRANSACTION` are linted with --no-assume-in-transaction so
# CREATE INDEX CONCURRENTLY is accepted there (and only there).
#
# squawk is a Rust binary. Resolution order: `squawk` on PATH, then
# `npx squawk-cli` (Node), then Docker. Pin with SQUAWK_VERSION.
set -euo pipefail

cd "$(dirname "$0")/.."
SQUAWK_VERSION="${SQUAWK_VERSION:-2.73.0}"
MODULES="${MODULES:-platform auth tasks notifications search media admin integrity appattest}"

if command -v squawk >/dev/null 2>&1; then
  run_squawk() { squawk "$@"; }
elif command -v npx >/dev/null 2>&1; then
  run_squawk() { npx --yes "squawk-cli@${SQUAWK_VERSION}" "$@"; }
elif command -v docker >/dev/null 2>&1; then
  run_squawk() { docker run --rm -v "$PWD:/work:ro" -w /work "ghcr.io/sbdchd/squawk:v${SQUAWK_VERSION}" "$@"; }
else
  echo "lint-migrations: need squawk, npx or docker on PATH" >&2
  exit 127
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

status=0
for module in $MODULES; do
  for file in migrations/"$module"/*.sql; do
    [ -e "$file" ] || continue
    up_only="$tmp/$module-$(basename "$file")"
    # Keep everything before the Down marker (or the whole file if absent).
    sed -E '/^-- *\+goose +[Dd][Oo][Ww][Nn]/,$d' "$file" >"$up_only"

    flags=()
    if grep -qi '^-- +goose no transaction' "$file"; then
      flags+=(--no-assume-in-transaction)
    fi

    echo "== $file"
    # Report paths relative to the temp copy would be confusing: label them.
    if ! run_squawk --stdin-filepath "$file" "${flags[@]}" <"$up_only"; then
      status=1
    fi
  done
done
exit "$status"
