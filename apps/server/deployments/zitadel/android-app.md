# Android app: ZITADEL registration

The Android client (`apps/android`, module `feature/auth`) signs in with OIDC Authorization Code + PKCE (S256) in the
system browser, using AppAuth-Android. It is a **public client**: no client secret, the PKCE verifier protects the code.
This file lists what must exist in ZITADEL for that to work and why. Server side nothing changes (the server only
validates JWT access tokens, see `README.md` in this directory).

Status: written from ZITADEL's documentation (endpoint paths, native app rules, scopes and prompt values were read on
2026-10-08) and the AppAuth 0.11.1 sources. The bootstrap calls were run against ZITADEL v4.19.4 on 2026-10-08 (see README.md,
"Verification log"); the Android client itself (AppAuth on a device or emulator) was not. Console menu labels below
are UNVERIFIED and may differ slightly between ZITADEL versions.

## 1. Create the application

**Done by `bootstrap.sh`** for the local stack (idempotent): it registers `aedst-android` (redirect and post-logout
`com.aedst.android:/oauth2redirect`) and `aedst-android-tv` (`com.aedst.android.tv:/oauth2redirect`, plus the
`OIDC_GRANT_TYPE_DEVICE_CODE` grant), both Native, auth method NONE (PKCE), `AUTHORIZATION_CODE` + `REFRESH_TOKEN`, JWT
access tokens, role assertions, and prints their client ids with a ready `./gradlew` line. Grant type and enum names
were checked against `proto/zitadel/app.proto`; the script was run on 2026-10-08 against ZITADEL v4.19.4: both apps were created with the settings above
(read back through the API; `devMode` false is accepted for the private-use scheme). The
manual route below is the fallback for non-local instances.

In the project that `bootstrap.sh` created (`aedst-api`; its id is the token audience), add an application:

| Setting | Value | Why |
|---|---|---|
| Type | **Native** (OIDC application type `OIDC_APP_TYPE_NATIVE`) | Native apps support the code flow only, with PKCE; no secret is issued |
| Authentication method | **None / PKCE** (`OIDC_AUTH_METHOD_TYPE_NONE`) | Public client; also lets the app call the revocation endpoint with just `client_id` |
| Response type | `CODE` | |
| Grant types | `AUTHORIZATION_CODE` **and `REFRESH_TOKEN`** | Without the refresh grant ZITADEL issues no refresh token and the app refuses the sign-in |
| Redirect URIs | `com.aedst.android:/oauth2redirect` (phone app), `com.aedst.android.tv:/oauth2redirect` (TV app, if used) | RFC 8252 section 7.1: reverse-DNS private-use scheme = the Android application id, single slash |
| Post logout redirect URIs | none required today; `com.aedst.android:/oauth2redirect` if you add RP-initiated logout | The app does not call `end_session` yet |
| Token type | **JWT** (`accessTokenType: OIDC_TOKEN_TYPE_JWT`) | The server verifies tokens offline; an opaque token fails with `auth.ErrOpaqueToken` |
| Add user roles to access token | on (`accessTokenRoleAssertion`) | The app reads roles from the access token for UI gating only |
| Add user roles to ID token | on (`idTokenRoleAssertion`) | |
| Dev mode | off in production | Only needed to allow non-https redirect URIs (e.g. `http://localhost`). Custom schemes need no dev mode |

Copy the generated **client id** into the Android build: `-Paedst.oidc.clientId=<id>`, together with
`-Paedst.oidc.issuer=https://<your zitadel>` and `-Paedst.oidc.projectId=<project id>` (see
`apps/android/README.md`, "Sign-in (OIDC)").

Console path (UNVERIFIED labels): Projects > `aedst-api` > Applications > New > Native. The same via the management API
(the same call `bootstrap.sh` makes; add `"OIDC_GRANT_TYPE_DEVICE_CODE"` to `grantTypes` for the TV app):

```sh
curl -fsS -X POST "$ZITADEL_URL/management/v1/projects/$PROJECT_ID/apps/oidc" \
  -H "Authorization: Bearer $PAT" -H 'Content-Type: application/json' -d '{
    "name": "aedst-android",
    "redirectUris": ["com.aedst.android:/oauth2redirect"],
    "postLogoutRedirectUris": [],
    "responseTypes": ["OIDC_RESPONSE_TYPE_CODE"],
    "grantTypes": ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
    "appType": "OIDC_APP_TYPE_NATIVE",
    "authMethodType": "OIDC_AUTH_METHOD_TYPE_NONE",
    "version": "OIDC_VERSION_1_0",
    "devMode": false,
    "accessTokenType": "OIDC_TOKEN_TYPE_JWT",
    "accessTokenRoleAssertion": true,
    "idTokenRoleAssertion": true
  }'
```

For the local stack (`--profile idp`, `http://localhost:8085`) set `"devMode": true` only if you also register an http
redirect; the Android debug build reaches the stack as `http://10.0.2.2:8085`, which additionally needs
`ExternalDomain`/host handling for that name in the compose file. The debug-only cleartext exception exists in
`app/src/debug/res/xml/network_security_config.xml` and `app-tv/src/debug/...` (10.0.2.2 and localhost; release configs
stay HTTPS-only, enforced by `apps/android/scripts/check-policies.sh`). Treat that dev loop as UNVERIFIED.

## 2. Scopes the app requests

`openid profile email offline_access urn:zitadel:iam:org:project:id:<projectId>:aud urn:zitadel:iam:org:project:roles`

- `offline_access` is what makes ZITADEL return a refresh token (code flow only).
- `...:id:<projectId>:aud` adds the project id to the access token `aud`; without it the server answers 401.
- `urn:zitadel:iam:org:project:roles` asserts the roles claim (also asserted by `projectRoleAssertion` on the project).

The app sends `prompt=select_account` (ZITADEL supports `select_account`, `login`, `create`, `none`): a sign-out in the app
does not end the IdP's browser session, so without a prompt the next sign-in would silently reuse it.

## 3. Endpoints used (from discovery)

`/.well-known/openid-configuration` (discovery; the app checks that its `issuer` equals the configured issuer),
`/oauth/v2/authorize`, `/oauth/v2/token` (code exchange and `refresh_token` grant),
`/oauth/v2/revoke` (RFC 7009 on sign-out; ZITADEL cascades: revoking the refresh token revokes its access token).
`/oidc/v1/end_session` is not used yet.

## 4. Token lifetimes and refresh behaviour

ZITADEL **rotates refresh tokens**: each refresh returns a new one and the app stores it (single-flight, so two parallel
401s never spend the same token). A refresh token that expired, was revoked or was already used yields `invalid_grant`,
which signs the user out in the app; offline and 5xx keep the session. Lifetimes (access token, ID token, refresh token
idle and absolute expiry) are instance/organisation settings in ZITADEL (Console > Settings; UNVERIFIED label and
defaults, check your version). Suggested starting point for a mobile client: access token 15-60 minutes, refresh token
idle expiry 30 days. Short access tokens limit what a stolen token is worth; the refresh token never leaves the
Tink-encrypted store.

## 5. Why no native credential UI (passkeys, MFA, social login, recovery)

All of these are ZITADEL features exposed through its hosted login in the Custom Tab, and the project rule is not to
build identity features (decisions.md, ADR-0001). Chrome handles passkeys in that tab through the platform credential
manager, so users get passkeys without the app depending on `androidx.credentials`. A native credential prompt would mean
building a custom login UI on ZITADEL's Session API, plus WebAuthn relying-party binding through Digital Asset Links
(`assetlinks.json` for the RP id) and owning the MFA/recovery/error states.

**Revisit trigger:** adopt native Credential Manager only if a custom login UI over the Session API becomes a product
requirement (for example a branded in-app login that must not leave the app). Until then adding `androidx.credentials`
would be unused weight.

## 6. Hardening option: Android App Links

The private-use scheme can be claimed by any installed app; PKCE makes an intercepted authorization code useless, but the
OS-verified alternative is an `https://<your domain>/oauth2redirect` redirect with an `assetlinks.json` entry for the
app's package and signing certificate fingerprint, registered as the redirect URI. It requires owning and serving that
domain; the change in the app is the redirect URI plus the manifest intent filter AppAuth contributes.
