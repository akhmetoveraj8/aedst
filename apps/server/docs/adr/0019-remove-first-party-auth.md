# ADR-0019: Remove first-party authentication; the server is a pure OIDC resource server

- Status: Accepted (2026-11-04). Supersedes the first-party parts of [ADR-0017](0017-identity-provider.md)
  (decisions 2, 4 and 5 and the "time-boxed" amendment); the rest of ADR-0017 (OIDC resource
  server, ZITADEL default, AGPL caveat, identity mapping, token shape) stands.
- Scope: `apps/server`. Clients are being changed to OIDC-only (Authorization Code + PKCE) in the same effort.

## Context

ADR-0017 kept the self-built authentication (email + password, argon2id/bcrypt, HS256 access and
refresh tokens, session rotation) as a time-boxed migration path behind
`AEDST_AUTH_FIRST_PARTY_ENABLED`, off by default, with a mandatory sunset date. The project has no
production users, the deadline mechanism itself (sunset validation, startup warnings, a
`MultiVerifier` routing by `iss`) was more code than the feature, and every day it stays is a
second authentication surface and a credential store to defend. The owner decided to remove it
now instead of waiting for the clients.

## Decision

1. **Remove first-party authentication completely.** Deleted: the `auth` module
   (`internal/modules/auth`: register, login, refresh with reuse detection, logout, credential and
   session repositories, login limiter, argon2id hasher, operator user directory), `TokenService`
   and `MultiVerifier` in `internal/platform/auth`, the `AEDST_AUTH_FIRST_PARTY_ENABLED`,
   `AEDST_AUTH_FIRST_PARTY_SUNSET`, `AEDST_JWT_SIGNING_KEY`, `AEDST_JWT_PREVIOUS_SIGNING_KEY`,
   `AEDST_ACCESS_TOKEN_TTL_MINUTES`, `AEDST_REFRESH_TOKEN_TTL_HOURS`,
   `AEDST_LOGIN_RATE_LIMIT_PER_MINUTE` and `AEDST_RETENTION_SESSION_HOURS` settings (and their Helm
   values, schema entries, secret key and docs), the `auth.first_party` capability, the `auth.sessions`
   retention policy, and the `github.com/alexedwards/argon2id` dependency (`golang.org/x/crypto` is
   now only an indirect dependency; no bcrypt remains). `architecturetest` now forbids password
   hashing libraries.
2. **`platformauth.Verifier` has one implementation, `OIDCVerifier`.** `AEDST_OIDC_ISSUER` and
   `AEDST_OIDC_AUDIENCE` are required; startup fails without them in every environment.
3. **Nothing identity-related is kept in the server.** There was no profile or device sign-in
   data in the `auth` module (only credentials and sessions), so no other table is touched. Data
   keyed by a user id keeps resolving: a UUID subject is used as-is by `ids.FromExternal`, and the
   ZITADEL import script preserves the old UUID as the user id.
4. **Schema.** Existing migrations are untouched. New migration `migrations/auth/00004_drop_first_party_auth.sql`
   drops `auth.sessions`, `auth.credentials` and the schema (`IF EXISTS`; the destructive statements carry
   `squawk-ignore ban-drop-table`; the Down recreates the empty structure only). The `auth` migration
   directory stays so the drop still runs on existing databases; it is listed in `retiredSchemas` of
   `architecturetest` (no sqlc entry). Operators must run `deployments/zitadel/import-users.sh` **before**
   the migration (runbook: "Removing first-party auth").
5. **Contract (breaking).** See below. Generated code is not committed, so only `api/proto` changes.
   `buf.yaml` exempts exactly these removals from `buf breaking` (`ignore` / `ignore_only`) until the
   comparison branch contains them.

## Breaking contract change (clients)

Removed from `api/proto/aedst/auth/v1/auth.proto` (the whole file and package `aedst.auth.v1`):

- service `AuthService` with RPCs `Register`, `Login`, `RefreshToken`, `Logout`, `GetCurrentUser`;
- messages `User`, `RegisterRequest`, `RegisterResponse`, `LoginRequest`, `LoginResponse`,
  `RefreshTokenRequest`, `RefreshTokenResponse`, `LogoutRequest`, `LogoutResponse`,
  `GetCurrentUserRequest`, `GetCurrentUserResponse`, `TokenPair`.

Removed from `api/proto/aedst/admin/v1/admin.proto`: RPC `AdminService.ListUsers`, messages `AdminUser`,
`ListUsersRequest`, `ListUsersResponse`, and field `GetOverviewResponse.users_total` (number 1 and
the name are `reserved`). The user directory was only the first-party credential table; with an IdP
the directory is the IdP's admin console.

Behaviour: the capabilities feature `auth.first_party` no longer exists (`auth.oidc` remains and is
true whenever the server runs). Clients obtain tokens from the IdP, send them as `Authorization: Bearer`,
and read the profile (email, name) from the ID token or the IdP's userinfo endpoint. There is no
server-side "current user" RPC.

## Consequences

- The password-handling liability (storage, rehash, brute force, recovery) is gone from this repository;
  the load tests, Bruno collection and integration tests authenticate with IdP-issued tokens
  (`internal/platform/auth/authtest` is an in-process OIDC provider for Go integration tests).
- Admin lists users no longer; admin can still list tasks, delete tasks, broadcast and read the audit log.
- Dev and CI need an OIDC provider for manual runs (compose profile `idp`); unit tests need none.
- A deployment that kept real first-party users must follow the runbook order or those users must reset
  their passwords at the IdP; the migration is not reversible for data.

## Revisit when

A product genuinely needs credentials the IdP cannot hold (it should then add an IdP-side extension or
a separate service, not revive this module in the resource server).
