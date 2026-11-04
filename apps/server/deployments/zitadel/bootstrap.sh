#!/usr/bin/env bash
# Idempotent dev bootstrap for the local ZITADEL (docker compose --profile idp).
#
# Creates, via ZITADEL's management API and the admin machine-user PAT that the
# compose file writes to deployments/zitadel/.local/admin.pat:
#   - project "aedst-api" (role assertion on; its project id IS the audience)
#   - roles "admin" and "user" (the names AEDST_ROLE_POLICY refers to)
#   - an OIDC PKCE app "aedst-web" (no secret; web + native redirect URIs)
#   - an OIDC PKCE app "aedst-admin" (no secret; own client of apps/web/admin, redirect ${ADMIN_ORIGIN}/api/auth/callback)
#   - native OIDC PKCE apps "aedst-android" (com.aedst.android:/oauth2redirect) and "aedst-android-tv"
#     (com.aedst.android.tv:/oauth2redirect, plus the device code grant); see android-app.md
#   - native OIDC PKCE app "aedst-apple" (com.aedst.apple:/oauth2redirect, overridable via APPLE_REDIRECT_URIS);
#     created, or repaired via PUT oidc_config when it exists; prints the AEDST_OIDC_* xcconfig lines
#   - a service user "aedst-service" with the "user" role (JWT access tokens)
#   - a dev human "dev" with both roles
# and prints the AEDST_OIDC_* settings. Re-running reuses what exists.
#
# STATUS: run end to end (first run, then a second idempotent run) on 2026-10-08
# against ZITADEL v4.19.4 (official Windows release binary + Postgres 17, not the
# compose stack): every object was created and the re-run converged; see
# README.md "Verification log".
set -euo pipefail

BASE_URL="${ZITADEL_URL:-http://localhost:8085}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAT_FILE="${ZITADEL_ADMIN_PAT_FILE:-$HERE/.local/admin.pat}"
PROJECT_NAME="${ZITADEL_PROJECT_NAME:-aedst-api}"
DEV_PASSWORD="${ZITADEL_DEV_PASSWORD:-Dev-Password-1!}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
[ -s "$PAT_FILE" ] || { echo "admin PAT not found at $PAT_FILE; start the stack first: task up PROFILES=\"--profile idp\"" >&2; exit 1; }
PAT="$(tr -d '\r\n' <"$PAT_FILE")"

api() { # method path [json-body]
  curl -fsS -X "$1" "$BASE_URL$2" -H "Authorization: Bearer $PAT" \
    -H 'Content-Type: application/json' ${3:+-d "$3"}
}

echo "Waiting for ZITADEL at $BASE_URL ..."
for _ in $(seq 1 60); do
  curl -fsS "$BASE_URL/debug/ready" >/dev/null 2>&1 && break
  sleep 2
done

# --- project -----------------------------------------------------------------
PROJECT_ID="$(api POST /management/v1/projects/_search \
  "{\"queries\":[{\"nameQuery\":{\"name\":\"$PROJECT_NAME\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" |
  jq -r '.result[0].id // empty')"
if [ -z "$PROJECT_ID" ]; then
  # projectRoleAssertion: roles are added to tokens without requesting a scope.
  PROJECT_ID="$(api POST /management/v1/projects \
    "{\"name\":\"$PROJECT_NAME\",\"projectRoleAssertion\":true,\"projectRoleCheck\":false}" | jq -r .id)"
  echo "created project $PROJECT_ID"
else
  # Idempotent repair: an existing project must also assert roles in tokens
  # (urn:zitadel:iam:org:project:roles). The PUT body replaces the settings.
  api PUT "/management/v1/projects/$PROJECT_ID" \
    "{\"name\":\"$PROJECT_NAME\",\"projectRoleAssertion\":true,\"projectRoleCheck\":false}" >/dev/null 2>&1 || true
fi

# --- roles (matching AEDST_ROLE_POLICY) -------------------------------------
for role in admin user; do
  api POST "/management/v1/projects/$PROJECT_ID/roles" \
    "{\"roleKey\":\"$role\",\"displayName\":\"$role\"}" >/dev/null 2>&1 || true
done

# --- OIDC PKCE apps (web SPA/BFF, Android, Android TV) -------------------------
# ensure_app NAME CREATE_JSON -> prints the client id; creates the app only when no app of that name exists
# (idempotent: an existing app is reused untouched). Public clients: authMethodType NONE = PKCE, no secret.
ensure_app() {
  local name="$1" body="$2" id
  id="$(api POST "/management/v1/projects/$PROJECT_ID/apps/_search" \
    "{\"queries\":[{\"nameQuery\":{\"name\":\"$name\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" |
    jq -r '.result[0].oidcConfig.clientId // empty')"
  if [ -z "$id" ]; then
    id="$(api POST "/management/v1/projects/$PROJECT_ID/apps/oidc" "$body" | jq -r .clientId)"
    echo "created app $name ($id)" >&2
  fi
  printf '%s' "$id"
}

CLIENT_ID="$(ensure_app aedst-web '{
  "name":"aedst-web",
  "redirectUris":["http://localhost:3000/api/auth/callback","aedst://auth/callback","http://127.0.0.1:53682/callback"],
  "postLogoutRedirectUris":["http://localhost:3000"],
  "responseTypes":["OIDC_RESPONSE_TYPE_CODE"],
  "grantTypes":["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN"],
  "appType":"OIDC_APP_TYPE_NATIVE",
  "authMethodType":"OIDC_AUTH_METHOD_TYPE_NONE",
  "version":"OIDC_VERSION_1_0",
  "devMode":true,
  "accessTokenType":"OIDC_TOKEN_TYPE_JWT",
  "accessTokenRoleAssertion":true,
  "idTokenRoleAssertion":true,
  "idTokenUserinfoAssertion":true
}')"

# Admin panel (apps/web/admin): its OWN OIDC client, separate from aedst-web, so its session cookies and
# redirect URIs are isolated from the product app (docs/content/web/projects.md). Same IdP, so ZITADEL SSO
# makes the sign-in seamless. Override ADMIN_ORIGIN for a deployed admin host.
ADMIN_ORIGIN="${ADMIN_ORIGIN:-http://localhost:3001}"
ADMIN_CLIENT_ID="$(ensure_app aedst-admin "$(jq -nc --arg o "$ADMIN_ORIGIN" '{
  name: "aedst-admin",
  redirectUris: [($o + "/api/auth/callback")],
  postLogoutRedirectUris: [$o],
  responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
  grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
  appType: "OIDC_APP_TYPE_NATIVE",
  authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
  version: "OIDC_VERSION_1_0",
  devMode: ($o | startswith("http://")),
  accessTokenType: "OIDC_TOKEN_TYPE_JWT",
  accessTokenRoleAssertion: true,
  idTokenRoleAssertion: true,
  idTokenUserinfoAssertion: true
}')")"

# Android phone app: private-use scheme = application id (RFC 8252 7.1). Custom schemes need no devMode.
ANDROID_CLIENT_ID="$(ensure_app aedst-android '{
  "name":"aedst-android",
  "redirectUris":["com.aedst.android:/oauth2redirect"],
  "postLogoutRedirectUris":["com.aedst.android:/oauth2redirect"],
  "responseTypes":["OIDC_RESPONSE_TYPE_CODE"],
  "grantTypes":["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN"],
  "appType":"OIDC_APP_TYPE_NATIVE",
  "authMethodType":"OIDC_AUTH_METHOD_TYPE_NONE",
  "version":"OIDC_VERSION_1_0",
  "devMode":false,
  "accessTokenType":"OIDC_TOKEN_TYPE_JWT",
  "accessTokenRoleAssertion":true,
  "idTokenRoleAssertion":true
}')"

# Android TV app: device authorization grant (RFC 8628) for the couch, authorization code kept for sideloaded/phone use.
ANDROID_TV_CLIENT_ID="$(ensure_app aedst-android-tv '{
  "name":"aedst-android-tv",
  "redirectUris":["com.aedst.android.tv:/oauth2redirect"],
  "postLogoutRedirectUris":["com.aedst.android.tv:/oauth2redirect"],
  "responseTypes":["OIDC_RESPONSE_TYPE_CODE"],
  "grantTypes":["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN","OIDC_GRANT_TYPE_DEVICE_CODE"],
  "appType":"OIDC_APP_TYPE_NATIVE",
  "authMethodType":"OIDC_AUTH_METHOD_TYPE_NONE",
  "version":"OIDC_VERSION_1_0",
  "devMode":false,
  "accessTokenType":"OIDC_TOKEN_TYPE_JWT",
  "accessTokenRoleAssertion":true,
  "idTokenRoleAssertion":true
}')"

# Apple app (iOS/iPadOS/macOS): ASWebAuthenticationSession + Authorization Code + PKCE, public client (no secret).
# Redirect URI = AEDST_OIDC_REDIRECT_SCHEME + ":/oauth2redirect" (apps/apple/Config/Base.xcconfig). Override with
# APPLE_REDIRECT_URIS (comma-separated). Post-logout URIs stay empty: the app ends its session locally.
# Custom (non-https) schemes on a NATIVE app need no devMode, as for the Android apps above; set APPLE_DEV_MODE=true
# only if your ZITADEL version rejects the URI without it (verified: v4.19.4 accepts
# com.aedst.apple:/oauth2redirect with devMode=false).
APPLE_REDIRECT_URIS="${APPLE_REDIRECT_URIS:-com.aedst.apple:/oauth2redirect}"
APPLE_DEV_MODE="${APPLE_DEV_MODE:-false}"
case "$APPLE_DEV_MODE" in true | false) ;; *) echo "APPLE_DEV_MODE must be true or false" >&2; exit 1 ;; esac
APPLE_APP_NAME="aedst-apple"
# Create body and update body (PUT .../oidc_config) share these fields; only the create body carries "name".
APPLE_OIDC_CONFIG="$(jq -n --arg uris "$APPLE_REDIRECT_URIS" --argjson dev "$APPLE_DEV_MODE" '{
  redirectUris: ($uris | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))),
  postLogoutRedirectUris: [],
  responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
  grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
  appType: "OIDC_APP_TYPE_NATIVE",
  authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
  devMode: $dev,
  accessTokenType: "OIDC_TOKEN_TYPE_JWT",
  accessTokenRoleAssertion: true,
  idTokenRoleAssertion: true,
  idTokenUserinfoAssertion: true
}')"
APPLE_APP_JSON="$(api POST "/management/v1/projects/$PROJECT_ID/apps/_search" \
  "{\"queries\":[{\"nameQuery\":{\"name\":\"$APPLE_APP_NAME\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" |
  jq -c '.result[0] // empty')"
if [ -z "$APPLE_APP_JSON" ]; then
  APPLE_CLIENT_ID="$(api POST "/management/v1/projects/$PROJECT_ID/apps/oidc" \
    "$(jq -c --arg n "$APPLE_APP_NAME" '. + {name: $n, version: "OIDC_VERSION_1_0"}' <<<"$APPLE_OIDC_CONFIG")" |
    jq -r .clientId)"
  echo "created app $APPLE_APP_NAME ($APPLE_CLIENT_ID)" >&2
else
  APPLE_CLIENT_ID="$(jq -r '.oidcConfig.clientId // empty' <<<"$APPLE_APP_JSON")"
  APPLE_APP_ID="$(jq -r '.id' <<<"$APPLE_APP_JSON")"
  # Idempotent repair: converge redirect URIs, grants and token settings to the values above.
  # ZITADEL answers an update that changes nothing with HTTP 400 "No changes" (COMMAND-1m88i): that is success here.
  APPLE_PUT_OUT="$(curl -sS -X PUT "$BASE_URL/management/v1/projects/$PROJECT_ID/apps/$APPLE_APP_ID/oidc_config"     -H "Authorization: Bearer $PAT" -H 'Content-Type: application/json' -d "$APPLE_OIDC_CONFIG" || true)"
  case "$APPLE_PUT_OUT" in
    *COMMAND-1m88i*) echo "app $APPLE_APP_NAME ($APPLE_CLIENT_ID) already up to date" >&2 ;;
    *'"code"'*) echo "warning: could not update $APPLE_APP_NAME: $APPLE_PUT_OUT" >&2 ;;
    *) echo "repaired app $APPLE_APP_NAME ($APPLE_CLIENT_ID)" >&2 ;;
  esac
fi
# xcconfig treats // as a comment start, so the issuer's scheme separator is written as :/$()/ .
APPLE_ISSUER_XCCONFIG="$(printf '%s' "$BASE_URL" | sed -e 's#://#:/$()/#')"

# --- service user (machine-to-machine) --------------------------------------
SERVICE_SECRET=""
SERVICE_ID="$(api POST /management/v1/users/_search \
  '{"queries":[{"userNameQuery":{"userName":"aedst-service","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' |
  jq -r '.result[0].id // empty')"
if [ -z "$SERVICE_ID" ]; then
  SERVICE_ID="$(api POST /management/v1/users/machine \
    '{"userName":"aedst-service","name":"AEDST service","accessTokenType":"ACCESS_TOKEN_TYPE_JWT"}' | jq -r .userId)"
  echo "created service user $SERVICE_ID"
  # Machine user credentials, printed once (re-running does not regenerate):
  # client_id = userName, client_secret below -> OAuth client_credentials grant.
  SERVICE_SECRET="$(api PUT "/management/v1/users/$SERVICE_ID/secret" '{}' | jq -r '.clientSecret // empty')"
fi
api POST "/management/v1/users/$SERVICE_ID/grants" \
  "{\"projectId\":\"$PROJECT_ID\",\"roleKeys\":[\"user\"]}" >/dev/null 2>&1 || true

# --- dev human with both roles ----------------------------------------------
DEV_ID="$(api POST /management/v1/users/_search \
  '{"queries":[{"userNameQuery":{"userName":"dev","method":"TEXT_QUERY_METHOD_EQUALS"}}]}' |
  jq -r '.result[0].id // empty')"
if [ -z "$DEV_ID" ]; then
  DEV_ID="$(api POST /v2/users/human "{
    \"username\":\"dev\",
    \"profile\":{\"givenName\":\"Dev\",\"familyName\":\"User\"},
    \"email\":{\"email\":\"dev@aedst.localhost\",\"isVerified\":true},
    \"password\":{\"password\":\"$DEV_PASSWORD\",\"changeRequired\":false}
  }" | jq -r .userId)"
  echo "created dev user $DEV_ID"
fi
api POST "/management/v1/users/$DEV_ID/grants" \
  "{\"projectId\":\"$PROJECT_ID\",\"roleKeys\":[\"admin\",\"user\"]}" >/dev/null 2>&1 || true

cat <<EOF

Done. Put this in apps/server/.env:

  AEDST_OIDC_ISSUER=$BASE_URL
  AEDST_OIDC_AUDIENCE=$PROJECT_ID
  # Per-project roles claim: present for humans AND machine users (the generic
  # urn:zitadel:iam:org:project:roles claim is not issued to machine users).
  AEDST_OIDC_ROLES_CLAIM=urn:zitadel:iam:org:project:$PROJECT_ID:roles
  # optional: roles are bound to an organisation; set to accept only that org's grants
  # AEDST_OIDC_ROLES_ORG=<organisation id, console > Organization>

Clients (Authorization Code + PKCE, no secret):
  web      client id $CLIENT_ID
  admin    client id $ADMIN_CLIENT_ID   (apps/web/admin: OIDC_CLIENT_ID, redirect $ADMIN_ORIGIN/api/auth/callback)
  android  client id $ANDROID_CLIENT_ID
  android-tv client id $ANDROID_TV_CLIENT_ID
Android build (apps/android/README.md, "Sign-in (OIDC)"; the emulator reaches this stack as http://10.0.2.2:8085):
  ./gradlew :app:assembleDebug -Paedst.oidc.clientId=$ANDROID_CLIENT_ID -Paedst.oidc.projectId=$PROJECT_ID
  (TV: -Paedst.oidc.clientId=$ANDROID_TV_CLIENT_ID; issuer defaults to http://10.0.2.2:8085 in debug builds)
Request scope: openid profile offline_access urn:zitadel:iam:org:project:id:$PROJECT_ID:aud
  (the :aud scope adds the project id to aud; without it the server answers 401)
Dev login: dev / $DEV_PASSWORD   (console: $BASE_URL/ui/console)

Apple app "$APPLE_APP_NAME" (client id is public; no secret exists). Paste into apps/apple/Config/Secrets.local.xcconfig
(gitignored; never commit). Issuer must be the https URL users reach in production; on a simulator http://localhost is
only accepted in Debug builds:
  AEDST_OIDC_ISSUER = $APPLE_ISSUER_XCCONFIG
  AEDST_OIDC_CLIENT_ID = $APPLE_CLIENT_ID
  AEDST_OIDC_AUDIENCE_SCOPE = urn:zitadel:iam:org:project:id:$PROJECT_ID:aud
  AEDST_OIDC_WEBCREDENTIALS_DOMAIN = <IdP host without scheme>
Redirect URI(s) registered: $APPLE_REDIRECT_URIS
Passkeys: bootstrap.sh does not manage the login policy; enable them in the console (deployments/zitadel/README.md).

Service-to-service (ZITADEL machine user "aedst-service", JWT access tokens):
  client_credentials:  curl -s $BASE_URL/oauth/v2/token -u 'aedst-service:<client secret>' \\
    -d grant_type=client_credentials \\
    -d 'scope=openid urn:zitadel:iam:org:project:id:$PROJECT_ID:aud urn:zitadel:iam:org:projects:roles'
  ${SERVICE_SECRET:+client secret (shown once): $SERVICE_SECRET}
  JWT profile (no shared secret): add a key (POST /management/v1/users/$SERVICE_ID/keys)
  and use grant urn:ietf:params:oauth:grant-type:jwt-bearer with a signed assertion.
EOF
