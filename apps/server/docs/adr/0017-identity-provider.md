# ADR-0017: Identity provider and OIDC resource-server auth

- Status: Accepted (amended 2026-10-08: default IdP is ZITADEL; first-party auth is time-boxed).
  **2026-11-04: first-party auth was removed outright, see [ADR-0019](0019-remove-first-party-auth.md); decisions 2, 4 and 5 below are superseded and kept as history.**
- Date: 2026-09-29
- Scope: `apps/server` (clients are unchanged until they migrate; see "Client impact")

## Context

The server shipped with self-built authentication: an `auth` module that
stores password hashes, issues its own HS256 access/refresh JWTs and rotates
sessions. That code works, but **an identity system is the highest-liability
component a boilerplate can own**: password storage, account recovery, MFA,
passkeys, social login, email verification, brute-force defence, session
management, audit and compliance (GDPR/SOC 2) are a product in themselves, and
every project stamped out of this template would inherit the maintenance and
the risk.

The template is meant for *any* kind of project, so the decision must not
hard-wire a vendor into the server.

## Decision

1. **The server is a standards-based OIDC resource server.** It verifies
   access tokens from *any* OpenID Connect provider (`internal/platform/auth`,
   `OIDCVerifier`): discovery from `<issuer>/.well-known/openid-configuration`,
   JWKS fetched and refreshed in the background (`jwkfetch`, jwx v4), issuer and
   audience validated, asymmetric-only algorithm allow-list, one rate-limited
   forced refresh on an unknown `kid` (key rotation). Everything is
   configuration (`AEDST_OIDC_*`); there is no provider-specific code, so
   switching provider is an environment change.
2. **A `Verifier` interface is the only thing the request path knows.**
   `MultiVerifier` routes a token to first-party or OIDC verification by its
   `iss`; the chosen verifier still fully validates it.
3. **Template default IdP: ZITADEL** (dev compose profile `idp` and
   `deployments/zitadel/` included). Keycloak is the documented alternative.
   Ory Kratos+Hydra is not recommended for this template.
4. **First-party auth is a time-boxed migration path, not a second auth
   surface.** `AEDST_AUTH_FIRST_PARTY_ENABLED` defaults to **false**. Enabling it
   outside development requires `AEDST_AUTH_FIRST_PARTY_SUNSET` (RFC 3339 date):
   validation fails without it, every start logs a warning with the days
   remaining, and once the date has passed staging/production refuse to start
   (development logs an error). With the flag off the `AuthService` RPCs are not
   mounted. After the sunset the code path is deleted (see "Sunset" below and the
   runbook checklist in `docs/content/server/runbook.md`).
5. **Harden what remains** of first-party auth (argon2id, atomic refresh
   rotation with reuse detection, per-IP and per-account rate limits,
   timing-equalised login) only for as long as it exists.

## Options considered

Facts verified against the projects' repositories on 2026-09-29 (ZITADEL
release re-checked 2026-10-08: v4.19.4).

| | ZITADEL | Keycloak | Ory Kratos + Hydra |
|---|---|---|---|
| License | **AGPL-3.0** for core, console and hosted login since v3 (2025-03-31); v2 and earlier were Apache-2.0; proto definitions, SDKs, APIs, examples, docs, Helm chart stay Apache-2.0 | **Apache-2.0** (CNCF incubating) | **Apache-2.0** (both) |
| Latest release seen | v4.19.4 (2026-10-01) | 26.7.4 (2026-09-16) | n/a |
| Runtime | Single Go binary + a small Next.js login UI container; PostgreSQL only; light | JVM; ~0.5-1 GB RAM baseline; PostgreSQL | Two Go services (+ Oathkeeper/Keto for proxy/authz); PostgreSQL |
| What you build | Almost nothing; login UI v2 is a separate deployable | Almost nothing; theming via FreeMarker/Keycloakify | **Everything user-facing**: login, registration, recovery, consent UIs are yours |
| Standards | OIDC (certified), OAuth 2.x, SAML, passkeys/WebAuthn, multi-tenancy (organisations) natively | OIDC (certified), OAuth 2.x, SAML 2, LDAP/AD federation, fine-grained authz | OIDC/OAuth 2 (Hydra), identity/self-service flows (Kratos) |
| Ecosystem / hiring | Growing; smaller | Largest by far | Mid; high integration cost |
| Managed option | ZITADEL Cloud | Several vendors | Ory Network |

### Why ZITADEL is the template default

- **Operationally light and multi-tenant by design.** One Go binary plus a login
  container on PostgreSQL only (the stack the server already uses); organisations
  and projects with roles are native, which maps to `AEDST_ROLE_POLICY`.
- **API-first configuration.** Projects, roles, apps and users are manageable by
  API/Terraform, so a bootstrap is scriptable (`deployments/zitadel/bootstrap.sh`).
- **Hosted option** (ZITADEL Cloud) for teams that do not want to run an IdP.

### The AGPL-3.0 caveat (recorded honestly)

ZITADEL's core is AGPL-3.0 since v3. Running it **unmodified as a separate
service** that the application talks to over OIDC/HTTP imposes no licence
obligations on the application code, which stays under its own licence. The
copyleft (including the network-use clause) applies to ZITADEL itself **if you
modify it and offer it to users**, in which case you must offer those
modifications' source. Consequences for projects derived from this template:

- Do not fork or patch ZITADEL in-tree; configure it, theme via supported means.
- A project or corporate policy that **bans AGPL** should use **Keycloak
  (Apache-2.0)** instead. Nothing in the server changes: set `AEDST_OIDC_ISSUER`,
  `AEDST_OIDC_AUDIENCE` and `AEDST_OIDC_ROLES_CLAIM=realm_access.roles` (Keycloak
  needs an audience mapper; its subjects are UUIDs). The configuration is
  provider-agnostic; only the dev compose profile and bootstrap script are
  ZITADEL-specific and would have to be replaced.
- This is not legal advice; have counsel confirm if the distinction matters.

### Why not Ory Kratos + Hydra

Excellent, permissive and light, but *headless*: the template would have to ship
and maintain login/registration/recovery/consent UIs for four client platforms.
That re-creates the liability this ADR exists to remove. Reasonable for a
project that needs a fully custom identity UX; not a good default.

### Why not "keep self-built auth as the default"

Owning credential storage plus session management is exactly the risk described
in Context. It survives only as a deadline-bound migration path (decision 4).

## Server design

- **Identity mapping.** Modules key data by `ids.ID` (UUID). A token subject that
  is a UUID (Keycloak, Cognito) is used as-is; any other subject (ZITADEL numeric
  ids, `auth0|...`) maps to a deterministic ID derived from
  `(issuer, subject)` (`ids.FromExternal`). No users table is needed to start; a
  project that needs profiles adds a table keyed by that ID.
- **ZITADEL token shape.** JWT access tokens (`accessTokenType` JWT on the app);
  `aud` contains the **project id** (`AEDST_OIDC_AUDIENCE`; clients may also
  request scope `urn:zitadel:iam:org:project:id:<projectId>:aud`); roles are in
  `urn:zitadel:iam:org:project:roles`, an object keyed by role name with the
  granting organisation below each role (`AEDST_OIDC_ROLES_CLAIM`). Role assertion
  must be enabled on the project/app (`projectRoleAssertion`, set and repaired by
  `bootstrap.sh`). Covered by `TestOIDCVerifier_ZitadelShapedToken`.
- **Opaque tokens.** The server verifies JWTs offline and does not introspect. A
  bearer token that is not a JWT yields `auth.ErrOpaqueToken` (both `OIDCVerifier`
  and `MultiVerifier`); the interceptor logs a warning at most once a minute telling
  the operator to switch the IdP to JWT access tokens (clients still only see
  `Unauthenticated`). Tested in `TestVerifiers_OpaqueTokenGivesActionableError`.
- **Roles are organisation-bound.** `{role: {orgId: domain}}`. The optional
  `AEDST_OIDC_ROLES_ORG` keeps only roles granted in that organisation (a role
  without organisation info is dropped: fail closed); empty = any organisation.
  It affects only object-shaped claims, so it stays provider-agnostic (arrays and
  strings carry no organisation). Tested in `TestOIDCVerifier_RolesOrgFilter`.
- **Machine users.** Service-to-service callers are ZITADEL machine users using
  the `client_credentials` grant or the JWT-profile (machine key) grant, with JWT
  access tokens and the project audience scope; they get roles through project
  grants like humans. No provider-specific service-account concept is assumed.
- **Database and deployment.** ZITADEL may share the CloudNativePG cluster only
  with a separate database and role (no shared schemas), connected directly and
  never through the app's transaction-mode Pooler (`deployments/k8s/postgres/base/cluster.yaml`,
  `docs/content/server/deployment.md`). The official Helm chart
  (`zitadel/zitadel`, https://charts.zitadel.com; latest stable seen 10.3.0 on
  2026-10-08) is an optional way to run it (`deployments/zitadel/helm-values.example.yaml`,
  UNVERIFIED: never rendered or installed).
- **Verified against a live ZITADEL (2026-10-08, v4.19.4, release binary, no Docker).**
  `bootstrap.sh` creates everything and converges on re-run; JWT access tokens carry
  the project id in `aud`; `projectRoleAssertion` puts the roles in both
  `urn:zitadel:iam:org:project:roles` and `urn:zitadel:iam:org:project:<projectId>:roles`
  (`{role: {orgId: domain}}`); **machine users get only the per-project claim**, and
  only with the scope `urn:zitadel:iam:org:projects:roles`, so use
  `AEDST_OIDC_ROLES_CLAIM=urn:zitadel:iam:org:project:<projectId>:roles` (works for both;
  `bootstrap.sh` prints it). `OIDCVerifier` verified real human and machine tokens, rejected a
  wrong audience and applied `AEDST_OIDC_ROLES_ORG`. The refresh grant returns a new
  `id_token` (with `email` when the app has `idTokenUserinfoAssertion`) and a rotated
  refresh token; a replayed spent token is rejected and does not revoke the newer one.
  `prompt=create` is accepted by `/oauth/v2/authorize` (auth request carries
  `PROMPT_CREATE`); the Login UI v2 registration page itself was not run (UNVERIFIED).
  `end_session_endpoint` is advertised; with `id_token_hint` and a registered
  `post_logout_redirect_uri` it ends the session and redirects (state echoed), an unregistered
  URI is a 400. Evidence table: `deployments/zitadel/README.md`, "Verification log". Still
  UNVERIFIED: the compose `idp` profile (Docker unavailable), the Helm chart, Login UI v2, machine
  keys (JWT profile) and any client app.
- **Roles.** `AEDST_OIDC_ROLES_CLAIM` accepts a claim name or a dotted path
  (`realm_access.roles` for Keycloak); arrays, role-keyed objects and
  space-separated strings are understood. Create ZITADEL roles named as in
  `AEDST_ROLE_POLICY` (`admin`, `user`).
- **Fail closed.** If discovery or the JWKS is unreachable the request is
  rejected (401) and retried with a 5-second back-off; the server still boots
  and first-party tokens (when enabled) keep working.
- **Config validation** refuses an issuer without an audience, plain `http`
  issuers outside development, and any `HS*`/`none` algorithm for external
  issuers (algorithm-confusion guard).
- **Not done here (intentionally).** Token revocation/introspection (RFC 7662)
  and the browser/mobile login flows are the IdP's job; clients that adopt the
  IdP use its Authorization Code + PKCE flow directly.

## Client impact

Web, Android, Apple and Desktop currently call `AuthService`
(register/login/refresh/logout). They keep working while first-party auth is
enabled, and must move to Authorization Code + PKCE against the IdP **before the
sunset date**. Apple status: the app implements Authorization Code + PKCE (S256)
with `ASWebAuthenticationSession`, redirect `com.aedst.apple:/oauth2redirect`,
behind `AEDST_OIDC_ISSUER` (empty keeps the first-party email/password path until
the sunset). The ZITADEL application must be a Native app with auth method
None/PKCE, grants Authorization Code + Refresh Token, that exact redirect URI,
access token type JWT, role assertion, the audience scope (`AEDST_OIDC_AUDIENCE_SCOPE`),
`offline_access` allowed and passkeys enabled in the login policy (passkeys run in
the hosted login; the app does not call the platform passkey API). The app uses the
refresh grant without retries (rotation/reuse detection) and revokes on logout
(RFC 7009); not compiled or run yet. Roles-claim settings in the clients (`AEDST_ROLES_CLAIM`,
`AUTH_ROLES_CLAIM`) accept the ZITADEL claim name as-is. For existing users in
the meantime:

- Existing bcrypt password hashes keep working and are **upgraded to argon2id
  transparently on the next successful login** (only until the sunset).
- Access/refresh tokens issued before deploy remain valid.
- A client that refreshes concurrently with the *same* refresh token from two
  places will have its session revoked by reuse detection; clients must
  serialise refreshes.

## First-party auth hardening (what changed)

| Gap found | Fix |
|---|---|
| bcrypt default cost, silent 72-byte truncation | argon2id (RFC 9106 second recommendation: t=3, m=64 MiB, p=4), max password 128 bytes, bounded concurrency (8); bcrypt verified and upgraded on login |
| Login timing revealed which emails exist | Unknown accounts burn an equivalent dummy hash |
| Refresh rotation was read-then-write | Atomic compare-and-swap on the stored hash; loser revokes the session |
| Refresh tokens issued in the same second were byte-identical | `jti` + `nbf` claims on every token |
| No throttling | Per-IP limit on register/login/refresh RPCs and per-account limit on login (Valkey, cluster-wide, fail-open) |
| Emails case-sensitive | Normalised to lower case |
| Proto validation annotations were never enforced | `connectrpc.com/validate` interceptor; length caps added |
| Dev signing key accepted anywhere; no minimum length | Config rejects keys < 32 bytes, and the dev placeholder in staging/production |

## Sunset of first-party auth

Two parallel auth surfaces double the attack surface and the review burden, so
the module is on a clock.

- **Mechanism.** `AEDST_AUTH_FIRST_PARTY_ENABLED=false` by default;
  `AEDST_AUTH_FIRST_PARTY_SUNSET` required when enabled outside development;
  start-up warning with `days_remaining`; staging/production refuse to start
  after the date (`internal/platform/config`, `cmd/server/auth_sunset.go`).
- **Plan.** (1) Stand up the IdP and bootstrap project/roles/app. (2) Ship client
  releases that use the IdP and raise `AEDST_MIN_CLIENT_VERSIONS`. (3) Migrate or
  invite users (password import where supported, else reset). (4) Observe zero
  first-party traffic for one refresh-token TTL. (5) Set the flag to false.
  (6) Delete: the `auth` module, first-party `TokenService`/`MultiVerifier`
  branch, the auth proto service, `AEDST_JWT_*` settings, the `argon2id`
  package and the `github.com/alexedwards/argon2id` dependency.
  The full checklist is the "Sunset runbook" in `docs/content/server/runbook.md`.
- **Early deletion via hash import.** ZITADEL can create users with a pre-hashed
  password (v2 user API `hashedPassword`, Modular Crypt Format, optional `userId`).
  Read in ZITADEL source on 2026-10-08: argon2 (i/id) and bcrypt verifiers exist
  with cost bounds our hashes satisfy. **Verified end to end on 2026-10-08 against
  ZITADEL v4.19.4** (release binary + Postgres 17): an argon2id hash exactly as this
  server writes it (m=65536,t=3,p=4) and a bcrypt `$2a$` hash import with the old
  UUID as `userId`, `POST /v2/sessions` accepts the old password (wrong one rejected),
  and the migrated user completes code+PKCE with `sub` = the old UUID. **Prerequisite
  found by the run:** ZITADEL accepts only the active hasher (bcrypt) unless started
  with `ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_VERIFIERS=argon2,bcrypt`; otherwise an
  argon2id import fails with `CRYPT-r8Qm2` "passwap: not a bcrypt version" (the compose
  `idp` profile and the Helm example set it). `deployments/zitadel/import-users.sh`
  imports users keeping their UUID (so `ids.FromExternal` returns the same id and
  no data is re-keyed); procedure and fallback in the Sunset runbook.
- **Decision on removal (2026-10-08).** The project has no production clients,
  users or running deployments (owner confirmed), so no user migration is needed
  and the first-party code **can be deleted at any time**; the placeholder sunset
  date was dropped from `.env.example` and the flag is off there. It is still in
  the tree only because web, Android, Apple and Desktop call `AuthService`.
  Deleting it requires the clients to switch to the IdP Authorization Code + PKCE
  flow first; then follow the deletion list in the runbook (steps 4 of the plan
  above and the hash import are moot without users). Until then local dev, the
  end-to-end tests, k6 and Bruno opt in with `AEDST_AUTH_FIRST_PARTY_ENABLED=true`
  (no sunset date is required in development; the integration tests that run as
  `AEDST_ENV=test` set a far-future one).
- **Extending the date** is a deliberate config change reviewed like any other;
  do not extend it silently.

## Consequences

- New projects: run ZITADEL (or Keycloak), set `AEDST_OIDC_*`, leave
  `AEDST_AUTH_FIRST_PARTY_ENABLED=false`, delete the `auth` module when ready.
- The dev compose profile `idp` provides ZITADEL (Traefik, API, Login UI v2,
  dedicated Postgres) on `http://localhost:8085` with throwaway credentials;
  `deployments/zitadel/bootstrap.sh` creates the `aedst-api` project (audience),
  roles `admin`/`user`, a PKCE app `aedst-web`, a service user and a dev user.
  **Neither the compose profile nor the bootstrap has been run in the authoring
  environment (no Docker): the first real run is their acceptance test.**
- Revisit when: ZITADEL's licence changes again, a project forbids AGPL (switch
  to Keycloak), or the built-in module is deleted (then remove `TokenService`,
  the auth module, and `AEDST_JWT_*`).

## Verifying against a real provider

```bash
task up PROFILES="--profile idp"          # ZITADEL on http://localhost:8085
deployments/zitadel/bootstrap.sh          # prints AEDST_OIDC_AUDIENCE (project id)
export AEDST_OIDC_ISSUER=http://localhost:8085
export AEDST_OIDC_AUDIENCE=<project id>
export AEDST_OIDC_ROLES_CLAIM=urn:zitadel:iam:org:project:<project id>:roles   # bootstrap.sh prints it
# optional: export AEDST_OIDC_ROLES_ORG=<organisation id>
# Obtain a JWT access token via Authorization Code + PKCE (client id printed by
# the script; scope: openid profile urn:zitadel:iam:org:project:id:<id>:aud), then:
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' \
  http://localhost:8080/aedst.tasks.v1.TasksService/ListTasks
```
