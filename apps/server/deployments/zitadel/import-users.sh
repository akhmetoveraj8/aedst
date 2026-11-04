#!/usr/bin/env bash
# Import first-party users (auth.credentials) into ZITADEL with their EXISTING
# password hashes, so users keep their password when first-party auth is removed
# (ADR-0019; docs/content/server/runbook.md, "Removing first-party auth").
# RUN IT BEFORE migration auth/00004 drops auth.credentials: afterwards the hashes
# exist only in a database backup (restore one into a scratch database and point
# DATABASE_DSN at it).
#
# STATUS: verified on 2026-10-08 against ZITADEL v4.19.4 (official Windows release
# binary + Postgres 17; README.md "Verification log"): --dry-run, a real import of an
# argon2id (m=65536,t=3,p=4, alexedwards/argon2id as the server writes it) and a bcrypt
# ($2a$, cost 12) user, an idempotent re-run, and POST /v2/sessions with the old password
# (accepted; a wrong password is rejected).
#   - POST /v2/users/human accepts userId and hashedPassword{hash, changeRequired}.
#   - PREREQUISITE: ZITADEL must be started with the verifiers enabled, e.g.
#     ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_VERIFIERS=argon2,bcrypt (the compose idp profile
#     sets it). By default only the active hasher (bcrypt) is accepted and an argon2id hash
#     fails with HTTP 400 "Password is invalid (CRYPT-r8Qm2)", log "passwap: not a bcrypt version".
#   - Cost bounds (SystemDefaults PasswordHasher.Limits, read in source): bcrypt cost 10-16;
#     argon2 time 1-10, memory 8192-524288 KiB, threads 1-16. m=8192..131072 were all accepted.
#
# user_id is preserved on purpose: a UUID subject is used as-is by the server
# (ids.FromExternal), so every row keyed by the old user id stays attached to the
# same person. Without it each user would get a new id and lose their data.
#
# Idempotent: users that already exist in ZITADEL are skipped. Needs curl, jq and
# psql. The dump contains password hashes: keep it in memory (this script pipes
# it, nothing is written to disk) and run it from a trusted machine.
#
# Usage:
#   ZITADEL_URL=https://auth.example.com ZITADEL_ADMIN_PAT_FILE=./admin.pat \
#   ZITADEL_PROJECT_ID=<project id> DATABASE_DSN=postgres://... \
#     deployments/zitadel/import-users.sh [--dry-run]
set -euo pipefail

BASE_URL="${ZITADEL_URL:-http://localhost:8085}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAT_FILE="${ZITADEL_ADMIN_PAT_FILE:-$HERE/.local/admin.pat}"
PROJECT_ID="${ZITADEL_PROJECT_ID:?set ZITADEL_PROJECT_ID (the aedst-api project id)}"
DSN="${DATABASE_DSN:?set DATABASE_DSN (direct connection to the aedst database)}"
ROLE="${ZITADEL_IMPORT_ROLE:-user}"
# First-party emails were never verified; default to unverified so ZITADEL
# decides (mark them verified only if you have verified them elsewhere).
EMAIL_VERIFIED="${ZITADEL_IMPORT_EMAIL_VERIFIED:-false}"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

for bin in curl jq psql; do command -v "$bin" >/dev/null || { echo "$bin is required" >&2; exit 1; }; done
[ -s "$PAT_FILE" ] || { echo "admin PAT not found at $PAT_FILE" >&2; exit 1; }
PAT="$(tr -d '\r\n' <"$PAT_FILE")"

api() { # method path [json-body]; prints body, returns curl's status via exit code
  curl -sS -w '\n%{http_code}' -X "$1" "$BASE_URL$2" \
    -H "Authorization: Bearer $PAT" -H 'Content-Type: application/json' ${3:+-d "$3"}
}

created=0 skipped=0 failed=0
while IFS=$'\t' read -r user_id email hash; do
  [ -n "$user_id" ] || continue

  resp="$(api GET "/v2/users/$user_id")"
  if [ "${resp##*$'\n'}" = "200" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  local_part="${email%@*}"
  body="$(jq -n --arg id "$user_id" --arg email "$email" --arg given "$local_part" \
    --arg hash "$hash" --argjson verified "$EMAIL_VERIFIED" '{
      userId: $id,
      username: $email,
      profile: {givenName: $given, familyName: "-"},
      email: {email: $email, isVerified: $verified},
      hashedPassword: {hash: $hash, changeRequired: false}
    }')"

  if $DRY_RUN; then
    echo "would import $user_id <$email>"
    continue
  fi

  resp="$(api POST /v2/users/human "$body")"
  code="${resp##*$'\n'}"
  if [ "$code" != "200" ]; then
    echo "FAILED $user_id <$email>: HTTP $code: ${resp%$'\n'*}" >&2
    failed=$((failed + 1))
    continue
  fi
  # Same role every migrated user had (the first-party store has no roles).
  api POST "/management/v1/users/$user_id/grants" \
    "{\"projectId\":\"$PROJECT_ID\",\"roleKeys\":[\"$ROLE\"]}" >/dev/null || true
  created=$((created + 1))
done < <(psql "$DSN" -At -F $'\t' -c \
  "SELECT user_id, email, password_hash FROM auth.credentials ORDER BY created_at")

echo "imported=$created skipped(existing)=$skipped failed=$failed dry_run=$DRY_RUN"
[ "$failed" -eq 0 ]
