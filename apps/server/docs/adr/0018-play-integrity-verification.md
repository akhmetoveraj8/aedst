# ADR-0018: Google Play Integrity verification (STANDARD API)

- Status: Accepted (server implemented and unit/integration tested against a fake Google; never run against the real Google API)
- Date: 2026-10-08
- Scope: `apps/server` (`internal/modules/integrity`, `aedst.integrity.v1`); Android client `core/security/PlayIntegrityFacade`

## Context

The Android app produces Play Integrity **standard** tokens
(`StandardIntegrityManager`, `requestHash` per request). A token is opaque to
the app and means nothing until a backend decodes it with Google and judges
the verdict. Until now the server had no endpoint, so the client facade was
unused (decisions.md, "Play Integrity").

## Decision

1. **A new `integrity` module** with one unary RPC,
   `aedst.integrity.v1.IntegrityService/VerifyIntegrityToken`, layered like
   every other module (domain policy, application service + ports,
   infrastructure `google` and `postgres`, transport).
2. **Decoding is Google's official generated client**,
   `google.golang.org/api/playintegrity/v1` (`V1.DecodeIntegrityToken`, i.e.
   `POST playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken`,
   the same endpoint decodes classic and standard tokens). No new module was
   added: `google.golang.org/api` is already a direct dependency (FCM via
   `option`). Auth (service-account key or Application Default Credentials),
   token refresh and the wire format are the client's. We never decode the
   token locally (decryption keys are Google-managed for standard requests) and
   never hand-write the REST call.
3. **Verdict policy lives in `domain`** (pure Go): package allow-list, request
   binding, freshness window (`MaxAge` and a small future skew), minimum device
   level (`basic`/`device`/`strong`; emulators never count),
   `PLAY_RECOGNIZED` (switchable for sideload/dev), optional `LICENSED`, and
   Play Console "testing responses" rejected unless explicitly allowed.
4. **Request binding convention.** The client computes
   `request_hash = base64url_nopad(SHA-256("aedst.integrity.v1\n" + action + "\n" + payload))`
   (43 chars, far below Play's 500-byte limit), passes it to
   `setRequestHash`, and sends `action` + `payload` + `request_hash` to the
   RPC. The server recomputes the hash itself and requires BOTH the client's
   `request_hash` and the hash inside Google's signed verdict to equal it. A
   mismatch with the client value is rejected before any Google call (no quota
   spent).
5. **Replay protection is Postgres**, table `integrity.verified_tokens`
   (`token_hash` = SHA-256 of the token, the token itself is never stored) with
   the primary key as the arbiter, so concurrent presentations on any replica
   have exactly one winner. A token is claimed last, only after it passed every
   other check. Rows are purged by a `retention.Policy` (leader-elected River
   periodic job) after `max age + skew + 10 min`: an older token is rejected as
   expired anyway. Valkey is not involved (AGENTS.md: never correctness in
   Valkey).
6. **Authenticated callers only.** The RPC is not in `publicProcedures`, so
   `AuthInterceptor` requires a valid token; the caller's user id is recorded
   with the claim. An unauthenticated variant (e.g. attest before sign-up) is a
   Google-quota DoS vector and is deliberately out of scope; add it only with a
   per-IP limit and a separate decision.
7. **Rate limit.** Beyond the global per-user limit, `AEDST_INTEGRITY_RATE_LIMIT_PER_MINUTE`
   (default 10/user, Valkey `RateLimiter`, fails open) protects Google's decode
   quota, which is shared by all users (10,000 calls/day by default).
8. **Disabled by default.** `AEDST_INTEGRITY_ENABLED=false`: no Google client
   is built, no credential is read, startup never fails because of it, and the
   RPC answers `FAILED_PRECONDITION` ("not configured"). When enabled,
   `AEDST_INTEGRITY_ALLOWED_PACKAGES` is mandatory (config validation) and a
   credential/construction failure fails startup (explicit opt-in).
9. **A rejected token is a normal response** (`verified=false`, `reason`), not
   an RPC error, so clients can degrade instead of treating it as a crash.
   Operational failures (Google 5xx/429/403, DB outage, bad credentials)
   return `INTERNAL` with the real cause only in the server log/span (the
   token is never in any log or error). Google's `400` means "token rejected"
   and maps to `reason=token_undecodable`.

## Consequences

- Enforcement is the caller's decision: the RPC only reports the verdict. A
  sensitive RPC that must be gated needs its own follow-up (e.g. a short-lived
  "attested" claim); none exists yet.
- `google.golang.org/api` stays at the version already in `go.mod`
  (v0.279.0); a bump is a separate change.
- Apple App Attest (ADR-0016) is a different mechanism and still has no server
  verifier; the module's ports are not shaped for it yet.

## Revisit when

- Quota (10k/day) is exceeded: request a quota increase or cache nothing
  (a verdict is bound to a single request and must not be cached).
- A second attestation provider (App Attest, Play Integrity classic) is added:
  extract an `attestation` port.
- Enforcement per RPC is decided (session-level attested claim, role-policy
  style gating).
