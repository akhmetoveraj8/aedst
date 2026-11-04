# Spec: appattest/appattest-verification

Type: Command
Module: appattest
Status: Implemented (verified with a synthetic PKI and one real Apple sample; not run on a device)

## Context

Apple apps obtain an attestation (once per key) and an assertion (for each signed
request) from `DCAppAttestService`. They mean something only after server-side verification following Apple's document
"Validating apps that connect to your server". Decision and rationale: `docs/content/decisions/0016-device-attestation.md`.

## Scenarios

**Happy path**

- Given an authenticated user
- When `CreateChallenge()` — Then 32 random bytes, TTL 5 minutes, a row in `appattest.challenges`
- When `Enroll(key_id, attestation_object, challenge, bundle_id)` — Then the challenge is consumed atomically (before verification),
  the `x5c` chain is verified up to the Apple App Attestation Root CA, nonce/keyId/RP ID/counter=0/aaguid/credentialId are checked,
  the key is written to `appattest.keys` (counter 0), the response is `verified = true` + `environment`
- When `VerifyAssertion(key_id, assertion, action, payload)` — Then the signature is verified with the user's key,
  the counter grows with a single `UPDATE ... WHERE counter < $new`, the response is `verified = true`

**Edge cases**

- Given the challenge is unknown, expired, already used or issued to another user — Then `CHALLENGE_INVALID`
- Given a failed Enroll — Then the challenge is still consumed (a new one is needed)
- Given a bundle not in `AEDST_APPATTEST_ALLOWED_BUNDLE_IDS` — Then `BUNDLE_NOT_ALLOWED`, without certificate verification
- Given a development key with `AEDST_APPATTEST_ALLOW_DEVELOPMENT=false` — Then `ENVIRONMENT_NOT_ALLOWED`
- Given the same key_id is already enrolled (by anyone) — Then `KEY_ALREADY_ENROLLED`
- Given an assertion with an unknown, revoked or foreign key — Then `KEY_UNKNOWN`
- Given a counter not greater than the stored one (replay, rollback, parallel duplicate) — Then `COUNTER_NOT_INCREASING`; exactly one winner
- Given any check fails — Then the counter does not move

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| Module disabled (`AEDST_APPATTEST_ENABLED=false`) | `FailedPrecondition` | `FAILED_PRECONDITION` |
| No access token | `Unauthorized` | `UNAUTHENTICATED` |
| Invalid field (protovalidate, key_id format, challenge length) | `Validation` | `INVALID_ARGUMENT` |
| Per-user limit exceeded | `RateLimited` | `RESOURCE_EXHAUSTED` |
| Database failure | `Unknown` (Wrap) | `INTERNAL` |

A verification refusal is NOT an error: `200` with `verified = false` and a `reason`.

## Events

None.

## Cross-module dependencies

None (only `internal/platform/*`: auth context, retention, valkey rate limiter).

## NFR

- Verification is local (embedded Apple root certificate, SHA-256 `1cb9823b...c932`), no external calls.
- `appattest.challenges` is cleaned by retention (one hour after expiry), `appattest.keys` by `last_used_at`
  (`AEDST_APPATTEST_KEY_RETENTION_DAYS`, 365).
- Not done: Apple receipt / fraud metric, mandatory verification in other RPCs, key revocation from the admin UI.
