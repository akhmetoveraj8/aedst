#!/usr/bin/env bash
# Negative self-test of the sqlc vet rules in sqlc.yaml: runs `sqlc vet` over deliberately bad
# queries in a throwaway project and fails unless each rule that protects an append-only table
# fires. The rules themselves are copied from the real sqlc.yaml so they cannot drift.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/migrations" "$tmp/queries"

cat >"$tmp/migrations/schema.sql" <<'SQL'
CREATE SCHEMA admin;
CREATE TABLE admin.audit_log (id UUID PRIMARY KEY, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
CREATE SCHEMA integrity;
CREATE TABLE integrity.verified_tokens (token_hash BYTEA PRIMARY KEY, verified_at TIMESTAMPTZ NOT NULL);
SQL
cat >"$tmp/queries/bad.sql" <<'SQL'
-- name: RewriteAudit :exec
UPDATE admin.audit_log SET reason = 'x' WHERE id = $1;

-- name: EraseAudit :exec
DELETE FROM admin.audit_log WHERE id = $1;

-- name: BumpToken :exec
UPDATE integrity.verified_tokens SET verified_at = $2 WHERE token_hash = $1;

-- name: PurgeAuditEntries :execrows
DELETE FROM admin.audit_log WHERE created_at < $1;
SQL

# header (version + rules:) of the real config, up to the first `sql:` line
{ sed -n '/^version:/,/^sql:/p' sqlc.yaml | sed '$d'; cat <<'YAML'
sql:
  - schema: migrations
    queries: queries
    engine: postgresql
    gen:
      go:
        package: bad
        out: out
    rules:
      - audit-log-is-append-only
      - verified-tokens-are-insert-only
YAML
} >"$tmp/sqlc.yaml"

out="$(cd "$tmp" && sqlc vet 2>&1)"
fail=0
expect() {
  if ! grep -qF -- "$1" <<<"$out"; then
    echo "sqlc self-test FAILED: no finding for $1 ($2)" >&2
    fail=1
  fi
}
expect 'audit-log-is-append-only' 'an UPDATE or a non-retention DELETE of admin.audit_log'
expect 'verified-tokens-are-insert-only' 'an UPDATE of integrity.verified_tokens'
if grep -qE '^bad.sql: PurgeAuditEntries:' <<<"$out"; then
  echo "sqlc self-test FAILED: the retention purge was flagged" >&2
  fail=1
fi
if [ "$fail" -ne 0 ]; then
  echo "----- sqlc vet output -----" >&2
  echo "$out" >&2
  exit 1
fi
echo "sqlc self-test: the append-only rules fire on bad queries and spare the retention purge"
