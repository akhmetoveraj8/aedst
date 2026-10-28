# ZITADEL (template identity provider)

ZITADEL is the template's default OIDC provider (ADR-0001). The server is
provider-agnostic; this directory only supports local development.

- Stack: `docker compose -f deployments/docker/docker-compose.yml --profile idp up -d --wait`
  (Traefik + ZITADEL API + Login UI v2 + a dedicated Postgres, pinned to
  ZITADEL `v4.20.0`, the latest release seen on 2026-10-28; override with
  `AEDST_ZITADEL_VERSION`).
- `bootstrap.sh`: creates the project (its id is the token audience), roles
  `admin`/`user`, the `aedst-web`, `aedst-admin` (apps/web/admin, own client), `aedst-android` and `aedst-android-tv` and `aedst-apple` PKCE apps (Android: see `android-app.md`; Apple: below), a service user and a `dev` user,
  then prints the `AEDST_OIDC_*` values. Needs `curl` and `jq`.
- `.local/` (git-ignored) receives the admin machine-user PAT written by ZITADEL.

Status: `bootstrap.sh` and `import-users.sh` were run on 2026-10-08 against ZITADEL
v4.19.4 (official Windows release binary + Postgres 17; see "Verification log").
**The compose stack itself (Traefik, the container images, Login UI v2) is still
UNVERIFIED**: Docker Desktop's Linux engine would not start on the authoring machine
(WSL distro stopped), so the `idp` profile was never brought up. Dev credentials (`zitadel-admin@zitadel.localhost` /
`Password1!`, masterkey, cookie secret) are throwaway: never reuse them.

Token shape the server expects: JWT access tokens (`accessTokenType` JWT on the
app), `aud` containing the project id, roles in
`urn:zitadel:iam:org:project:roles` as an object keyed by role name (role
assertion is enabled on the project/app). Subjects are numeric and are mapped
to a stable UUID by `ids.FromExternal`.

Production: do not use this compose file. Run ZITADEL per its production docs
(or ZITADEL Cloud), manage the same objects with the ZITADEL Terraform provider
or console, and set `AEDST_OIDC_ISSUER` (https) / `AEDST_OIDC_AUDIENCE`.

## Checklist the server relies on

1. **JWT access tokens.** `bootstrap.sh` sets `accessTokenType: OIDC_TOKEN_TYPE_JWT`
   on the `aedst-web` app and `ACCESS_TOKEN_TYPE_JWT` on the machine user. The
   server verifies tokens offline, so an opaque token is rejected with
   `auth.ErrOpaqueToken` and a (rate-limited) warn log that says to switch the IdP
   to JWT access tokens. Any app you create by hand needs the same setting.
2. **Audience.** `aud` must contain the project id (`AEDST_OIDC_AUDIENCE`).
   Clients request the scope `urn:zitadel:iam:org:project:id:<projectId>:aud`
   (printed by `bootstrap.sh`).
3. **Roles.** The claim `urn:zitadel:iam:org:project:roles` is
   `{role: {orgId: orgDomain}}`: roles are granted per organisation. The project
   needs `projectRoleAssertion` (set by `bootstrap.sh`, also repaired on re-run) so
   the claim is present without extra scopes. **Machine users do not get the generic
   claim** (verified): their tokens carry only the per-project claim
   `urn:zitadel:iam:org:project:<projectId>:roles`, and only when the scope
   `urn:zitadel:iam:org:projects:roles` is requested. Humans get both claims. Hence
   `bootstrap.sh` now prints `AEDST_OIDC_ROLES_CLAIM=urn:zitadel:iam:org:project:<projectId>:roles`,
   which works for humans and machine users alike (the generic claim leaves machine
   users with no roles). Set `AEDST_OIDC_ROLES_ORG` to an
   organisation id to count only roles granted in that organisation (empty = any).
4. **Machine users (service-to-service).** Use ZITADEL machine users, not
   provider-specific service accounts: `bootstrap.sh` creates `aedst-service`,
   grants it the `user` role and prints a client secret once. Obtain tokens with
   the `client_credentials` grant, or with a machine key and the JWT-bearer
   (JWT profile) grant, requesting the audience scope above. Grant extra roles to
   the machine user in the project for admin-only RPCs.
5. **Database.** In Kubernetes ZITADEL uses the same CloudNativePG cluster with a
   separate database and role, connected directly, never through the app Pooler
   (`../k8s/postgres/base/cluster.yaml`, `docs/content/server/deployment.md`).

## Kubernetes: official Helm chart (optional)

`helm-values.example.yaml` is a starting point for the official chart
(`zitadel/zitadel` from https://charts.zitadel.com, source
github.com/zitadel/zitadel-charts). Latest stable seen on 2026-10-08: chart
**10.3.0** (GitHub release of 2026-10-02); newer pre-releases exist and are not
used. UNVERIFIED: the example was never rendered or installed.

## Apple app (iOS, iPadOS, macOS)

`bootstrap.sh` also creates (or, when it exists, repairs with `PUT .../oidc_config`) the native OIDC app
`aedst-apple`: type NATIVE, auth method NONE (PKCE, no secret), response type CODE, grants
AUTHORIZATION_CODE + REFRESH_TOKEN, JWT access tokens, role assertion on, redirect URI
`com.aedst.apple:/oauth2redirect` (override: `APPLE_REDIRECT_URIS`, comma-separated), no post-logout URIs.
`devMode` defaults to `false`, as for the Android apps (private-use schemes on NATIVE apps); set
`APPLE_DEV_MODE=true` only if the redirect URI is rejected. Verified on v4.19.4: `com.aedst.apple:/oauth2redirect`
is accepted with `devMode` false, and a re-run repairs the app (PUT `.../oidc_config`; an unchanged update
returns HTTP 400 "No changes" `COMMAND-1m88i`, which the script treats as up to date). The Apple client itself
(ASWebAuthenticationSession) is not verified.

After a run it prints the three lines for `apps/apple/Config/Secrets.local.xcconfig` (gitignored):
`AEDST_OIDC_ISSUER` (written `https:/$()/host`, because `//` starts a comment in xcconfig),
`AEDST_OIDC_CLIENT_ID` (public) and `AEDST_OIDC_AUDIENCE_SCOPE`
(`urn:zitadel:iam:org:project:id:<projectId>:aud`). Set `AEDST_OIDC_WEBCREDENTIALS_DOMAIN` to the IdP host by hand.

**Production IdP.** Run the script against it by pointing `ZITADEL_URL` at the instance and
`ZITADEL_ADMIN_PAT_FILE` at a file holding a PAT of a service user with org/project owner rights that you created
in the console yourself; do not run the dev parts (`dev` user, `aedst-service`) there: they create users with throwaway
passwords. Create the app by hand in the console if in doubt (Applications > New > Native > PKCE).

**Passkeys (manual, console).** `bootstrap.sh` does not manage the login policy, and no API call is invented here.
In the console: Settings > Login Behavior and Security > enable "Passwordless / passkeys" (the exact label depends on
the console version, UNVERIFIED), and allow `offline_access` on the app (it is a standard scope; refresh tokens need
the REFRESH_TOKEN grant, set by the script). Passkeys run inside the hosted login in the browser session
(ASWebAuthenticationSession); the app calls no platform passkey API (decisions.md).

## Migrating first-party users

`import-users.sh` imports `auth.credentials` rows with their existing UUID and
password hash (argon2id PHC or bcrypt). See the "Password hash import (ZITADEL)"
section of `docs/content/server/runbook.md`. Verified end to end on v4.19.4, with one
prerequisite: ZITADEL must run with `ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_VERIFIERS=argon2,bcrypt`
(set in the compose `idp` profile and in `helm-values.example.yaml`); by default argon2id hashes are rejected.

## Verification log

Run on 2026-10-08 against **ZITADEL v4.19.4** (official `zitadel-windows-amd64.tar.gz` release, SHA-256
checked against the release `checksums.txt`) with Postgres 17.5 (embedded-postgres), `start-from-init`,
ExternalDomain `localhost:8085`, plain http, the admin machine-user PAT written by ZITADEL. Docker was not
available, so Traefik and Login UI v2 were **not** part of the run (the Login UI v2 release tarball does not
unpack on Windows: pnpm symlinks). Everything below was done with curl against the real API.

| Item | Result | Evidence |
|---|---|---|
| `bootstrap.sh` first run | PASS | project, roles `admin`/`user`, apps `aedst-web`/`-android`/`-android-tv`/`-apple`, machine user (secret printed), `dev` human created; read back: JWT access tokens, role assertions on, `aedst-web` and `aedst-apple` have `idTokenUserinfoAssertion`, grants `dev` = admin+user, `aedst-service` = user |
| `bootstrap.sh` re-run | PASS after fix | converges. The Apple repair printed a false warning because ZITADEL answers an unchanged PUT with 400 `COMMAND-1m88i` "No changes"; fixed. Project `projectRoleAssertion` repair verified (set false, re-run, true) |
| Hash import, argon2id | PASS with config | `$argon2id$v=19$m=65536,t=3,p=4$...` (alexedwards/argon2id, the server's params) imported with `userId` kept; `POST /v2/sessions` with the right password 201, wrong password 400. **Without** `SystemDefaults.PasswordHasher.Verifiers` the import fails: 400 `CRYPT-r8Qm2`, log "passwap: not a bcrypt version". m=8192..131072, t=1..3, p=1..4 all accepted |
| Hash import, bcrypt | PASS | `$2a$12$...` imported, session check 201 / wrong password 400, even with the default config |
| `import-users.sh` | PASS after fix | `--dry-run` listed 2 new, 1 existing; real run imported 2 (+ `user` grant); re-run skipped all 3. Bug fixed: `curl -o /dev/stdout` fails on Git Bash for Windows (exit 23). Needs `psql` on PATH (a small stand-in was used; the SQL is plain) |
| Migrated user, full login | PASS | code+PKCE for the imported user: token `sub` = the old UUID, `ids.FromExternal` returns the same UUID, roles `[user]` |
| `prompt=create` | PASS (API level) | `/oauth/v2/authorize` returns 302 to `/ui/v2/login/login?authRequest=V2_...`; the auth request read back via `GET /v2/oidc/auth_requests/{id}` has `prompt: [PROMPT_CREATE]`. Discovery has `prompt_values_supported: null`. UNVERIFIED: that Login UI v2 then shows the registration page (UI not run) |
| `end_session` | PASS | discovery advertises `end_session_endpoint` (`/oidc/v1/end_session`). With `id_token_hint` + registered `post_logout_redirect_uri`: 302 to that URI with `state`, and the session (`sid`) is gone (404). Unregistered URI: 400 `post_logout_redirect_uri invalid`. Without a hint: 302 to the Login UI logout page |
| Code + PKCE (headless) | PASS | authorize, then `POST /v2/sessions` (user + password), then `POST /v2/oidc/auth_requests/{id}` to finalize (needs the login-client PAT; the admin PAT gets `AUTH-AWfge`), then the token endpoint |
| Refresh token grant | PASS | response contains a **new id_token** (with `email`), a new access token and a **rotated refresh token**; the old one is rejected (400 `Errors.OIDCSession.RefreshTokenInvalid`). Replaying a spent token does **not** revoke the newer one (the newer token still refreshed afterwards) |
| Access token shape | PASS | JWT (RS256, `kid`), `aud` = all project app client ids **and** the project id (with the `:aud` scope), roles in both `urn:zitadel:iam:org:project:roles` and `urn:zitadel:iam:org:project:<id>:roles`, shape `{role: {orgId: domain}}`; `expires_in` 43199 s |
| Email in id_token | PASS | `aedst-web` (idTokenUserinfoAssertion true) puts `email`, `email_verified` and names in the id_token; `aedst-android`/`-tv` do not set that flag (the server does not need it) |
| Server `OIDCVerifier` | PASS | real access tokens verified (discovery + JWKS over http://localhost:8085): human roles `[admin user]`, imported user `[user]`; wrong audience rejected; `RolesOrg` of another org gives no roles, the real org id gives all. Machine-user (client_credentials) token verifies, but roles only via the per-project claim (Checklist 3) |
| Full `apps/server` process against ZITADEL | not done | only the verifier was exercised (a throwaway test, not kept) |

Not verified: the `idp` compose profile (Traefik, container images, Login UI v2), the Helm chart, the JWT-profile
(machine key) grant, the device code grant, passkeys, and any client app (web, Android, Apple, Desktop) against ZITADEL.
