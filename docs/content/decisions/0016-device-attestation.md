---
title: "ADR-0016: Device attestation (Apple App Attest, Android Play Integrity)"
description: "Accepted (owner requirement). Both server verifiers exist; nothing is enforced. The Apple client enrolls and can assert (observe-only); the Android client..."
---

# ADR-0016: Device attestation (Apple App Attest, Android Play Integrity)

## Status
Accepted (owner requirement). Both server verifiers exist; **nothing is enforced.** The Apple client enrolls and can
assert (observe-only); the Android client is not wired.

- **Apple client:** `DeviceAttestation.swift`, `AttestationClientData.swift`, `AppAttestRemote.swift`,
  `ConnectAppAttestRemote.swift`, `AttestationCoordinator.swift` in `apps/apple/Core/AedstNetwork`, composed in
  `AppDependencies` (see "Differences the Apple client must absorb", now implemented). Statically reviewed only;
  **not compiled, not run, not tested on a device**. No user flow calls `assert` yet; sign-in only triggers a
  best-effort enrollment.
- **Android client:** `core/security` `PlayIntegrityFacade` exists and is not used by any request.
- **Server, Play Integrity:** `apps/server/internal/modules/integrity` (`aedst.integrity.v1`, ADR
  `apps/server/docs/adr/0018-play-integrity-verification.md`). Written by a separate change that was still
  untracked/in progress when this ADR was updated; this document does not describe its details.
- **Server, App Attest:** `apps/server/internal/modules/appattest` (`aedst.appattest.v1`), described below. Verified
  with unit tests on a synthetic Apple-like PKI, Postgres integration tests, and one genuine Apple attestation object
  (the sample from Apple's validation guide, checked against the real Apple root). **Never run against a real device.**
- Both server modules are **off by default** (`AEDST_INTEGRITY_ENABLED`, `AEDST_APPATTEST_ENABLED`).

## Context
- Android has a `PlayIntegrityFacade` (standard API); its token is opaque to the app and only the backend can decode it.
- Apple has App Attest (`DCAppAttestService`, framework `DeviceCheck`, iOS 14+/macOS 11+; our floors are higher).
  It is unsupported on simulators and on some Macs and Mac Catalyst setups.
- Desktop (Qt) and Web have no equivalent; nothing is planned for them.
- Any check done only on the device is worthless: a modified client can simply skip it.

## Decision
- Apple uses App Attest, Android uses Play Integrity. Both clients only **produce evidence**; the backend verifies.
- Policy is **fail-open at first**: a request without evidence (unsupported device, offline, Apple unavailable, any
  error) is sent normally and the server decides. The app must never hard-fail or show an error to an offline or
  unsupported user because of attestation. Enforcement is switched on per sensitive RPC (sign-up, token
  issuance, payments, bulk actions) only after the verifier has run in observe-only mode and its false-positive
  rate is known. **Today no RPC enforces anything**: verification is a separate, explicit call whose answer is
  `verified` plus a `reason`, and a failed verification is a normal response, not an RPC error.
- Apple client: no new dependency (platform framework). The live type is an `actor` (`AppAttestService`) so concurrent
  callers share one key generation; the system call is behind the `AttestServiceBackend` protocol so the logic is
  unit-testable. `NoopDeviceAttestation` is used on simulators, unsupported platforms and tests.

## Server: App Attest (`internal/modules/appattest`)

### Wire contract
Proto: `apps/server/api/proto/aedst/appattest/v1/appattest.proto`, service `AppAttestService`. Authenticated callers
only (the normal bearer token; not in the public procedure list). While `AEDST_APPATTEST_ENABLED=false` every RPC
answers `FAILED_PRECONDITION`. RPC errors mean the request is wrong (`INVALID_ARGUMENT` from protovalidate or format
checks, `UNAUTHENTICATED`), the caller is rate limited (`RESOURCE_EXHAUSTED`) or the server failed (`INTERNAL`).
Everything about the evidence itself is `verified=false` + a `FailureReason` enum.

1. `CreateChallenge()` returns `{challenge: 32 random bytes, expires_at}`. Single use, TTL 5 minutes, bound to the
   calling user, stored in Postgres (`appattest.challenges`), rate limited per user.
2. `Enroll({key_id, attestation_object, challenge, bundle_id})` returns `{verified, reason, environment}`.
   `key_id` is the standard base64 (44 characters) string `generateKey()` returned. The client calls
   `attestKey(keyId, clientDataHash = SHA-256(challenge))`. The server:
   1. resolves `bundle_id` against `AEDST_APPATTEST_ALLOWED_BUNDLE_IDS` (empty means "the only allowed one");
   2. **spends the challenge first** (one `UPDATE ... WHERE user_id = $1 AND challenge = $2 AND consumed_at IS NULL AND expires_at > $now`):
      a challenge is never usable for a second guess, so a failed enrollment needs a new challenge;
   3. CBOR-decodes the object (`fmt` must be `apple-appattest`) and verifies the `x5c` chain
      credCert -> intermediate -> Apple App Attestation Root CA at the server clock (default key-usage policy of
      `crypto/x509` is relaxed to any usage: these are attestation credentials, not TLS certificates);
   4. checks that the credCert extension `1.2.840.113635.100.8.2` (`SEQUENCE { [1] { OCTET STRING } }`, every level
      consumed exactly) equals `SHA-256(authData || SHA-256(challenge))`;
   5. checks `SHA-256(uncompressed X9.62 public key of credCert)` equals `key_id` and the P-256 curve;
   6. checks `rpIdHash == SHA-256("<AEDST_APPATTEST_TEAM_ID>.<bundle id>")`, attested-credential flag, `counter == 0`,
      `aaguid` (`appattest` + 7 zero bytes = production, `appattestdevelop` = development; nothing else, in
      particular not the `appattestsandbox` value some libraries accept), `credentialId == key id`;
   7. rejects development keys unless `AEDST_APPATTEST_ALLOW_DEVELOPMENT=true`;
   8. stores the key (`INSERT ... ON CONFLICT DO NOTHING`: a key id is enrolled once, by one user; a second enrollment
      is `KEY_ALREADY_ENROLLED`).
3. `VerifyAssertion({key_id, assertion, action, payload})` returns `{verified, reason, action}`.
   `clientData = "aedst.appattest.v1" LF action LF payload` (LF = 0x0A; `action` matches
   `^[a-z][a-z0-9._-]{0,63}$`), `clientDataHash = SHA-256(clientData)`, which the client passes to
   `generateAssertion`. The server loads the key for **this** user (an unknown, revoked or foreign key all answer
   `KEY_UNKNOWN`), checks `rpIdHash`, computes `nonce = SHA-256(authenticatorData || clientDataHash)` and verifies the
   ECDSA-ASN.1 signature over **`SHA-256(nonce)`** (Apple: "valid for `nonce`"; the Secure Enclave signs with
   ECDSA-SHA256, so the verified digest is the hash of the nonce; confirmed against two independent libraries and
   covered by a test that a signature over the bare nonce fails). Only then does it move the counter, with one
   statement: `UPDATE ... SET counter = $new WHERE key_id = $1 AND user_id = $2 AND revoked_at IS NULL AND counter < $new`.
   No row updated means `COUNTER_NOT_INCREASING`, so a replayed assertion can never verify twice and two parallel
   requests with the same counter have exactly one winner. A failed check never moves the counter.

There is deliberately **no server challenge in the assertion** (Apple's step 6 is satisfied by the strictly increasing
counter plus whatever nonce the client puts in `payload`). A caller that needs a statement unique to one request puts
a fresh random nonce or a request digest in `payload`.

### Storage
- `appattest.challenges(id, user_id, challenge unique, expires_at, consumed_at)`; retention policy
  `appattest.challenges` purges rows one hour after expiry.
- `appattest.keys(key_id bytea pk, user_id, bundle_id, public_key PKIX DER, counter bigint, environment, created_at,
  last_used_at, revoked_at)`; retention policy `appattest.keys` purges keys unused for
  `AEDST_APPATTEST_KEY_RETENTION_DAYS` (the app simply re-enrolls). `revoked_at` is honoured by every query; nothing
  sets it yet.
- No user data is stored: the key id is opaque and per install. Logs carry the failure reason and environment only,
  never attestation objects, assertions, challenges, payloads or keys.

### Configuration (all `AEDST_APPATTEST_*`, see `apps/server/.env.example`)
| Variable | Default | Meaning |
|---|---|---|
| `ENABLED` | `false` | Off: `FAILED_PRECONDITION` |
| `TEAM_ID` | empty | 10 upper-case letters/digits; required when enabled |
| `ALLOWED_BUNDLE_IDS` | empty | Comma separated; at least one when enabled |
| `ALLOW_DEVELOPMENT` | `false` | Accept Xcode-run keys; startup refuses `true` in staging/production |
| `RATE_LIMIT_PER_MINUTE` | `10` | Per user, `CreateChallenge` + `Enroll` |
| `ASSERTION_RATE_LIMIT_PER_MINUTE` | `120` | Per user, `VerifyAssertion` |
| `KEY_RETENTION_DAYS` | `365` | Idle keys are purged |

The rate limiter is Valkey and fails open by design; correctness (single-use challenge, counter) never depends on it.

### Library decision (library-first)
- **CBOR:** `github.com/fxamacker/cbor/v2` v2.9.6 (MIT, version verified with `go list -m -versions`; actively
  maintained, widely used, decoder limits for nesting/elements/duplicate keys/indefinite lengths). The standard library
  has no CBOR. Its import is confined to `internal/modules/appattest` by the `cbor-only-in-appattest` depguard rule,
  and it has a row in `docs/content/library-first.md`.
- **App Attest libraries evaluated and not adopted:** `github.com/splitsecure/go-app-attest` v0.4.1 (20 stars; roots
  injectable, but the chain is checked by hand-rolled code without clock injection, no counter handling, extra
  dependencies `ldclabs/cose`, `pkg/errors`) and `github.com/takimoto3/app-attest` v1.3.1 (6 stars; no clock injection,
  its own CBOR decoder, pulls `smallstep/pkcs7`, `appleapi-core`, `testtime`, needs Go 1.25+; it does include the
  receipt/fraud-metric client we do not need). Both are MIT and active, but neither lets us inject the clock, and a
  security verifier that cannot be tested at a fixed time or against a synthetic CA is worse than 250 reviewed lines.
  `go-webauthn/webauthn` has an `apple` attestation format, but that is WebAuthn *Apple Anonymous Attestation* (a
  different statement format, bound to a full WebAuthn ceremony), not `apple-appattest`.
- The verifier is therefore **project-specific security logic** (`infrastructure/apple`, about 250 lines over
  `crypto/x509`, `crypto/ecdsa`, `encoding/asn1`), with the Apple root CA and the clock injected.
- **Apple root CA:** embedded with `go:embed` from
  `https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem`: `CN=Apple App Attestation Root CA,
  O=Apple Inc., ST=California`, ECDSA P-384, valid 2020-03-18 to 2045-03-15, SHA-256 fingerprint
  `1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932`. The fingerprint is a constant checked at startup
  and again in a test. When Apple rotates the root, ship the new PEM in a release.

### Testing
Unit tests build a synthetic root -> intermediate -> credCert PKI with the nonce extension and cover: production and
development happy paths, wrong challenge, wrong nonce, other team/bundle (RP ID), counter not zero, bad aaguid
(including `appattestsandbox`), credential id and key id mismatches, a chain to another root, a missing
intermediate, wrong `fmt`, expired and not-yet-valid certificates, a malformed nonce extension, malformed/truncated/
trailing/deeply nested/duplicate-key CBOR, signature and counter tampering, a signature over the bare nonce, and wrong
action/payload. Service tests cover expired, replayed, foreign and unknown challenges, a failed enrollment burning the
challenge, policy, rate limits, counter replay/decrease, a foreign user's key and a concurrent counter race.
Postgres integration tests run the whole stack (real repositories, real verifier) including concurrent challenge
consumption, concurrent counter advancement and retention. `TestVerifyAttestation_AppleGuideSample` verifies the
genuine attestation object from Apple's guide against the real embedded root with the clock pinned inside the sample
certificates' validity window.

### Differences the Apple client must absorb
The Swift facade was written before the server and differed from the implemented contract. **Now implemented** (not
compiled or run):
- The old `AssertionClientData` (tag `aedst-attest-v1`, length-prefixed fields) and the `X-Aedst-Attest-*` headers are
  removed. `AttestationClientData.make(action:payload:)` builds `"aedst.appattest.v1" LF action LF payload`;
  `generateAssertion` receives `SHA-256(clientData)`. The client calls `CreateChallenge`, `Enroll` and `VerifyAssertion`
  directly (`AttestationCoordinator` over `AppAttestRemote`); a header/interceptor variant stays part of the (not done)
  per-RPC enforcement work.
- `attestKey` is given `SHA-256(challenge)` of the 32 raw bytes `CreateChallenge` returned; every enrollment attempt
  fetches a new challenge, and at most one attempt is made per launch / sign-in (a rejection is never retried in a loop).
- `invalidKey` (device) / `KEY_UNKNOWN` (assertion) / `KEY_ALREADY_ENROLLED` and `KEY_ID_MISMATCH` (enroll) discard the
  stored key id; `KEY_UNKNOWN` also allows one new enrollment.
- The key is bound to the user server-side, so the client discards it on sign-out and on session expiry
  (`AppDependencies.didSignOut` -> `AttestationCoordinator.reset()`); the next user enrolls a fresh key. The old key
  stays on the server until retention purges it.
- Only iOS/iPadOS uses `DCAppAttestBackend` (the server validates iOS App IDs, no macOS `aclBlob`); macOS, simulators and
  unsupported devices use `NoopDeviceAttestation` and make no attestation network calls.

## Consequences
- Wiring on Apple (done): `needsEnrollment()` -> `CreateChallenge` -> `attestKeyIfNeeded`
  -> `Enroll` -> `confirmEnrollment()`; later `generateAssertion(keyId, SHA-256(clientData))` -> `VerifyAssertion`.
  Any error is ignored by the app (fail-open).
- Attestation gives no protection until a sensitive RPC requires a verified assertion. Observe the verdict rates first.

## Not done
- **Apple receipt validation** (the `receipt` in the attestation is ignored) and therefore the fraud-risk metric
  (number of attested keys per device).
- The optional authenticator-data extensions (`apple_bundle_version_01`, `apple_validation_category_01`) are not
  evaluated; macOS `aclBlob` handling does not exist (the server targets iOS/iPadOS App IDs).
- **Per-RPC enforcement interceptor** (header transport, "require a recent verified assertion for RPC X") and
  monitoring dashboards/alerts for verdict rates (none exist for either module).
- **Key revocation tooling** (admin UI / RPC); `revoked_at` exists and is honoured but nothing writes it.
- Calling `AttestationCoordinator.assert` from a sensitive user flow (nothing does yet); wiring `PlayIntegrityFacade` on Android.
- Desktop and Web attestation.
- Running anything against a real Apple device or the real Google API.

## Revisit when
- The Apple client is wired and has run in observe-only mode long enough to choose which RPCs to enforce.
- Abuse is seen on Desktop or Web (then consider a different mechanism there, such as proof-of-work or WebAuthn).
- Apple changes App Attest (receipt/risk-metric API, root rotation) or the false-positive rate on supported devices is too high.
- A maintained Go App Attest library appears that injects the clock and root pool (then reconsider the custom verifier).
