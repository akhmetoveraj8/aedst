#!/usr/bin/env bash
# Sets (or checks) the GitHub secrets and variables the Apple release workflows need
# (docs/content/apple/release.md, "Setting the secrets"). Run by the OWNER on their own machine.
#
# Values come from environment variables, or from files named by <NAME>_FILE; never from arguments, and they are
# never printed. Nothing is written to disk. The script only talks to GitHub through the authenticated `gh` CLI.
#
#   set-github-secrets.sh [--environment NAME] [--repo OWNER/REPO] [--dry-run]   set secrets and variables
#   set-github-secrets.sh --check-secrets [--environment NAME] [--repo OWNER/REPO]   list missing NAMES only
#   (also accepted as the subcommand: set-github-secrets.sh check-secrets ...)
#
# Required (set):  APPLE_TEAM_ID  ASC_KEY_ID  ASC_ISSUER_ID  ASC_KEY_P8_FILE (path to AuthKey_XXXX.p8)  MATCH_PASSWORD
# match storage, either git (default):
#                  MATCH_GIT_URL, and MATCH_GIT_BASIC_AUTHORIZATION or both MATCH_GIT_USER + MATCH_GIT_TOKEN
#                  (the header value is base64("user:token"), computed here)
#                  or S3 (MATCH_STORAGE_MODE=s3): MATCH_S3_BUCKET MATCH_S3_REGION MATCH_S3_ACCESS_KEY
#                  MATCH_S3_SECRET_ACCESS_KEY
# Optional:        SENTRY_AUTH_TOKEN (secret), SENTRY_ORG and SENTRY_PROJECT_APPLE (variables); AEDST_* public app config (OIDC issuer, client id, ...) as variables
#
# Status: bash -n checked only; never run against GitHub in the authoring environment (UNVERIFIED).
set -euo pipefail

MODE=set
ENVIRONMENT=""
REPO=""
DRY_RUN=0

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    check-secrets | --check-secrets) MODE=check ;;
    --dry-run) DRY_RUN=1 ;;
    --environment)
      [ $# -ge 2 ] || { echo "--environment needs a name" >&2; exit 2; }
      ENVIRONMENT="$2"
      shift
      ;;
    --repo)
      [ $# -ge 2 ] || { echo "--repo needs OWNER/REPO" >&2; exit 2; }
      REPO="$2"
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

command -v gh >/dev/null || { echo "gh (GitHub CLI) is required" >&2; exit 1; }

GH_SCOPE=()
[ -z "$ENVIRONMENT" ] || GH_SCOPE+=(--env "$ENVIRONMENT")
[ -z "$REPO" ] || GH_SCOPE+=(--repo "$REPO")

if [ "$DRY_RUN" -eq 0 ] || [ "$MODE" = check ]; then
  gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated: run 'gh auth login' first" >&2; exit 1; }
fi

# value NAME -> prints the value of $NAME, or the contents of the file in ${NAME}_FILE, or nothing.
value() {
  local name="$1" fname="${1}_FILE" file
  if [ -n "${!name:-}" ]; then
    printf '%s' "${!name}"
  elif [ -n "${!fname:-}" ]; then
    file="${!fname}"
    [ -r "$file" ] || { echo "$fname points at an unreadable file" >&2; return 1; }
    # strip trailing newlines only
    printf '%s' "$(cat "$file")"
  fi
}

STORAGE_MODE="$(value MATCH_STORAGE_MODE || true)"
case "${STORAGE_MODE:-git}" in
  git | s3) ;;
  *) echo "MATCH_STORAGE_MODE must be git or s3" >&2; exit 1 ;;
esac
STORAGE_MODE="${STORAGE_MODE:-git}"

SECRET_NAMES=(APPLE_TEAM_ID ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_CONTENT MATCH_PASSWORD)
if [ "$STORAGE_MODE" = s3 ]; then
  SECRET_NAMES+=(MATCH_STORAGE_MODE MATCH_S3_BUCKET MATCH_S3_REGION MATCH_S3_ACCESS_KEY MATCH_S3_SECRET_ACCESS_KEY)
else
  SECRET_NAMES+=(MATCH_GIT_URL MATCH_GIT_BASIC_AUTHORIZATION)
fi
OPTIONAL_SECRET_NAMES=(SENTRY_AUTH_TOKEN)
OPTIONAL_VARIABLE_NAMES=(SENTRY_ORG SENTRY_PROJECT_APPLE AEDST_API_ENVIRONMENT AEDST_SENTRY_DSN AEDST_POSTHOG_KEY AEDST_POSTHOG_HOST AEDST_POSTHOG_SESSION_REPLAY AEDST_ROLES_CLAIM AEDST_OIDC_ISSUER AEDST_OIDC_CLIENT_ID AEDST_OIDC_SCOPES AEDST_OIDC_AUDIENCE_SCOPE AEDST_OIDC_REDIRECT_SCHEME AEDST_OIDC_REFRESH_TTL_DAYS AEDST_OIDC_WEBCREDENTIALS_DOMAIN)

where="repository"
[ -z "$ENVIRONMENT" ] || where="environment $ENVIRONMENT"

# --- check-secrets: names only -------------------------------------------------
if [ "$MODE" = check ]; then
  have_secrets="$(gh secret list ${GH_SCOPE[@]+"${GH_SCOPE[@]}"} --json name --jq '.[].name')"
  have_vars="$(gh variable list ${GH_SCOPE[@]+"${GH_SCOPE[@]}"} --json name --jq '.[].name')"
  missing=0
  for n in "${SECRET_NAMES[@]}"; do
    if ! grep -qx "$n" <<<"$have_secrets"; then
      echo "MISSING secret   $n ($where)"
      missing=1
    fi
  done
  for n in "${OPTIONAL_SECRET_NAMES[@]}"; do
    grep -qx "$n" <<<"$have_secrets" || echo "optional, not set: secret   $n ($where)"
  done
  for n in "${OPTIONAL_VARIABLE_NAMES[@]}"; do
    grep -qx "$n" <<<"$have_vars" || echo "optional, not set: variable $n ($where)"
  done
  [ "$missing" -eq 0 ] && echo "all required secrets are present in the $where (storage mode: $STORAGE_MODE)"
  # Secrets the old workflows used; they should be deleted.
  for n in ASC_KEY_P8_BASE64 DEVELOPER_ID_CERT_P12_BASE64 DEVELOPER_ID_CERT_PASSWORD APP_STORE_CONNECT_API_KEY_ID; do
    ! grep -qx "$n" <<<"$have_secrets" || echo "obsolete secret still present: $n (delete it)"
  done
  exit "$missing"
fi

# --- set: collect and validate every value before touching GitHub ---------------
# Values live in VAL_<NAME> variables (no associative arrays: macOS ships bash 3.2).
store() { printf -v "VAL_$1" '%s' "$2"; } # NAME VALUE
fetch() { local k="VAL_$1"; printf '%s' "${!k:-}"; } # NAME
problems=0

need() { # NAME
  local v
  v="$(value "$1")" || { problems=1; return; }
  if [ -z "$v" ]; then
    echo "required value is empty: $1 (or ${1}_FILE)" >&2
    problems=1
  else
    store "$1" "$v"
  fi
}

need APPLE_TEAM_ID
need ASC_KEY_ID
need ASC_ISSUER_ID
need MATCH_PASSWORD

if [ -z "${ASC_KEY_P8_FILE:-}" ]; then
  echo "required value is empty: ASC_KEY_P8_FILE (path to AuthKey_XXXX.p8)" >&2
  problems=1
elif [ ! -s "$ASC_KEY_P8_FILE" ]; then
  echo "ASC_KEY_P8_FILE does not point at a non-empty file" >&2
  problems=1
else
  # base64 of the file, single line (GNU base64 wraps at 76 columns; tr removes the newlines)
  store ASC_KEY_CONTENT "$(base64 <"$ASC_KEY_P8_FILE" | tr -d '\r\n')"
fi

if [ "$STORAGE_MODE" = s3 ]; then
  store MATCH_STORAGE_MODE s3
  need MATCH_S3_BUCKET
  need MATCH_S3_REGION
  need MATCH_S3_ACCESS_KEY
  need MATCH_S3_SECRET_ACCESS_KEY
else
  need MATCH_GIT_URL
  basic="$(value MATCH_GIT_BASIC_AUTHORIZATION || true)"
  if [ -n "$basic" ]; then
    store MATCH_GIT_BASIC_AUTHORIZATION "$basic"
  else
    user="$(value MATCH_GIT_USER || true)"
    token="$(value MATCH_GIT_TOKEN || true)"
    if [ -z "$user" ] || [ -z "$token" ]; then
      echo "required value is empty: MATCH_GIT_BASIC_AUTHORIZATION, or both MATCH_GIT_USER and MATCH_GIT_TOKEN" >&2
      problems=1
    else
      store MATCH_GIT_BASIC_AUTHORIZATION "$(printf '%s:%s' "$user" "$token" | base64 | tr -d '\r\n')"
    fi
    unset user token
  fi
  unset basic
fi

for n in "${OPTIONAL_SECRET_NAMES[@]}" "${OPTIONAL_VARIABLE_NAMES[@]}"; do
  v="$(value "$n" || true)"
  [ -z "$v" ] || store "$n" "$v"
done
unset v

if [ "$problems" -ne 0 ]; then
  echo "refusing to continue: fix the values above (nothing was sent)" >&2
  exit 1
fi

# --- send (or only list names with --dry-run) -----------------------------------
set_one() { # kind NAME ; kind = secret|variable
  local kind="$1" name="$2"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] would set $kind $name ($where)"
    return
  fi
  # The value goes through stdin, never through argv, so it is not visible in the process list.
  fetch "$name" | gh "$kind" set "$name" ${GH_SCOPE[@]+"${GH_SCOPE[@]}"}
  echo "set $kind $name ($where)"
}

for n in "${SECRET_NAMES[@]}"; do set_one secret "$n"; done
for n in "${OPTIONAL_SECRET_NAMES[@]}"; do
  [ -z "$(fetch "$n")" ] || set_one secret "$n"
done
for n in "${OPTIONAL_VARIABLE_NAMES[@]}"; do
  [ -z "$(fetch "$n")" ] || set_one variable "$n"
done

[ "$DRY_RUN" -eq 1 ] && echo "dry run: nothing was sent. Re-run without --dry-run to set them."
echo "Verify with: $0 --check-secrets ${ENVIRONMENT:+--environment $ENVIRONMENT}"
