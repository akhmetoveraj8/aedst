# Spec: integrity/verify-integrity-token

Type: Command
Module: integrity
Status: Implemented (verified only against a fake Google; the real Google API was never called)

## Context

The Android client (`core/security/PlayIntegrityFacade`) obtains a Play Integrity **standard API** token. The token
is opaque: it means something only after it is decoded at Google and the verdict is checked on the server. Decision and
rationale: `docs/adr/0018-play-integrity-verification.md`.

## Scenarios

**Happy path**

- Given an authenticated user and a token issued with `requestHash = RequestHash(action, payload)`
- When `VerifyIntegrityToken(integrity_token, action, payload, request_hash, package_name)`
- Then the server recomputes the hash, Google decodes the token, the policy passes, the token is written to
  `integrity.verified_tokens`, the response is `verified = true` + verdicts

**Edge cases**

- Given the same token is presented again (including in parallel) — Then exactly one `verified = true`,
  the rest get `reason = TOKEN_REPLAYED` (a PRIMARY KEY, not a cache)
- Given the client's `request_hash` does not equal the hash of `action + payload` — Then `REQUEST_HASH_MISMATCH` without calling Google
- Given the hash inside Google's signed verdict differs — Then `TOKEN_NOT_BOUND`
- Given a package not in `AEDST_INTEGRITY_ALLOWED_PACKAGES` — Then `PACKAGE_MISMATCH` without calling Google
- Given a token older than `AEDST_INTEGRITY_MAX_TOKEN_AGE_SECONDS` or from the future beyond the skew — Then `TOKEN_EXPIRED` / `TOKEN_FROM_FUTURE`
- Given a device below `AEDST_INTEGRITY_MIN_DEVICE_LEVEL` (an emulator does not count) — Then `DEVICE_NOT_TRUSTED`
- Given the app is not `PLAY_RECOGNIZED` with `REQUIRE_PLAY_RECOGNIZED=true` — Then `APP_NOT_RECOGNIZED`
- Given Google answered 400 — Then `TOKEN_UNDECODABLE`
- Given the policy fails — Then the token is NOT consumed (it is recorded only after all checks)

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| Module disabled (`AEDST_INTEGRITY_ENABLED=false`) | `FailedPrecondition` | `FAILED_PRECONDITION` |
| No access token | `Unauthorized` | `UNAUTHENTICATED` |
| Invalid field (protovalidate / action) | `Validation` | `INVALID_ARGUMENT` |
| Per-user limit exceeded | `RateLimited` | `RESOURCE_EXHAUSTED` |
| Google failure (403/429/5xx, network), database failure | `Unknown` (Wrap) | `INTERNAL` (cause only in the log, without the token) |

A policy refusal is NOT an error: `200` with `verified = false` and a `reason`.

## API

```proto
rpc VerifyIntegrityToken(VerifyIntegrityTokenRequest) returns (VerifyIntegrityTokenResponse);
```

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `integrity_token` | string (<= 32768) | yes | Token from `StandardIntegrityToken.token()`; not logged |
| `action` | string `^[a-z][a-z0-9._-]*$` (<= 64) | yes | What the token authorizes; part of the hash |
| `payload` | bytes (<= 4096) | no | Bytes the token is bound to (request digest + a fresh nonce) |
| `request_hash` | string, 43 base64url characters | yes | `base64url_nopad(SHA-256("aedst.integrity.v1\n" + action + "\n" + payload))` |
| `package_name` | string | no | applicationId; empty = the only allowed one |

## Events

None.

## Cross-module dependencies

None (only `internal/platform/*`: auth context, retention, valkey rate limiter).

## NFR

- Google's `decodeIntegrityToken` quota is 10,000/day per project by default; the limit is `AEDST_INTEGRITY_RATE_LIMIT_PER_MINUTE` (10) per user.
- Timeout of the Google call: `AEDST_INTEGRITY_TIMEOUT_SECONDS` (10).
- The table `integrity.verified_tokens` is cleaned by a retention policy (`max age + skew + 10 min`).
