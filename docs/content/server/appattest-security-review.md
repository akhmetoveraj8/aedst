---
title: "App Attest: internal security review"
description: "Adversarial internal review of the Apple App Attest verifier against Apple's checklist: findings, fixes, residual risks and the scope for an external audit."
---

# App Attest: internal security review

Module: `apps/server/internal/modules/appattest` (ADR-0016). Reviewed 2026-10-29 by the engineering agent that
maintains the repository, reading the code and the tests against Apple's "Validating apps that connect to your
server" checklist and the WebAuthn authenticator-data layout.

**This is NOT an external audit.** It was done by the same side that wrote the code, without a device, without
Apple's production service and without a human cryptographer. It lowers the chance of obvious defects; it does not
replace the audit scoped at the end of this page. Nothing here has run against a real iPhone: the only genuine Apple
object tested is the sample in Apple's guide (`infrastructure/apple/testdata`), checked against the real Apple root;
everything else uses a synthetic PKI (`appattesttest`). The module is off by default and enforces nothing today.

## Checklist coverage

| Apple requirement | Where | Verdict |
|---|---|---|
| Attestation is CBOR with `fmt = apple-appattest`; `attStmt.x5c`, `receipt`; `authData` | `verifier.go` `VerifyAttestation` | Pass. Strict decoder: no duplicate keys, no indefinite length, depth 8, 16 elements/pairs, trailing bytes rejected, tags now rejected (F2). |
| Chain `x5c` (credCert, intermediates) verifies to the pinned Apple App Attestation Root CA | `credCert.Verify` with only the embedded root as trust anchor | Pass. Root embedded with `go:embed`, SHA-256 pinned in code and checked in a test; 2 to 4 certificates accepted; validity judged at the injected clock (fail-closed on a wrong server clock); `ExtKeyUsageAny` because these are not TLS certificates. |
| `nonce = SHA256(authData || clientDataHash)` equals the credCert extension `1.2.840.113635.100.8.2` | `VerifyAttestation`, `nonceFromCertificate` | Pass. DER shape `SEQUENCE { [1] { OCTET STRING } }` parsed with every level consumed exactly (tests: trailing bytes, second element, wrong length, garbage, missing). Go rejects a certificate with duplicate extensions. Compared with `subtle.ConstantTimeCompare` (not secret, harmless). |
| `clientDataHash` = SHA-256 of the server challenge | `service.Enroll` | Pass. The challenge is the server's own 32 random bytes, not client-chosen. |
| `SHA256(public key X9.62 uncompressed) == keyId` | `domain.KeyIDOf`, key must be P-256 | Pass. Uses `ecdsa.PublicKey.Bytes` (validates the point). |
| `rpIdHash == SHA256(teamID.bundleID)` | `domain.JudgeAttestation`, `VerifyAssertion` | Pass. The App ID is built from the server-side policy; the bundle id must be in the allow-list. |
| Attestation counter is 0 | `JudgeAttestation` | Pass. |
| `aaguid` is `appattestdevelop` or `appattest` + 7 zero bytes | `EnvironmentOf` | Pass. Development accepted only when `AllowDevelopment`; configuration refuses it in staging and production. |
| `credentialId == keyId` | `JudgeAttestation` | Pass. |
| Receipt validation (fraud-risk metric) | not implemented | Accepted gap, see R3. |
| Assertion: `rpIdHash`, signature over `SHA256(authenticatorData || clientDataHash)` with the stored key | `VerifyAssertion` | Pass. ECDSA-SHA256 over the nonce (the Secure Enclave key signs the SHA-256 of the nonce, so the verifier hashes twice, as Apple documents and as the sample test confirms). |
| Assertion counter strictly greater than the stored one, stored atomically | `service.VerifyAssertion`, SQL `AdvanceCounter` | Pass. `UPDATE ... WHERE counter < new` is the decision; the Go comparison is only an early exit; a rejected assertion never moves the counter; concurrency tested (in memory and against Postgres). |
| Challenge: single use, short life, bound to the user | `ConsumeChallenge` SQL | Pass. One `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now AND user_id = ...`; 32 bytes from `crypto/rand`; TTL 5 minutes; spent before the attestation is examined, so no second guess per challenge. |
| Clock injection | `sharedtime.Clock` everywhere | Pass. No `time.Now()` in the module. |

## Findings and fixes

| ID | Severity | Finding | Status |
|---|---|---|---|
| F1 | Medium | **Environment policy was not applied to keys enrolled earlier.** Enrollment checked `AllowDevelopment`, assertion did not: after switching it off, previously enrolled development keys (weaker: obtainable by anyone running a debug build) kept verifying, unlike the bundle allow-list which was re-checked. Deployed environments (staging, production) refuse `AllowDevelopment=true` at startup, so the exposure is a development or test environment whose data or keys are later reused, or a flag flipped during an incident. | **Fixed** (`service.go`: assertion returns `environment_not_allowed`, counter untouched). Test `TestVerifyAssertion_EnvironmentPolicyAppliesToEnrolledKeys`; fails when the check is removed. |
| F2 | Low (hardening) | CBOR tags were accepted by the decoder though Apple's objects contain none (a self-described tag 55799 wrapper parsed). Extra decoder surface for no benefit. | **Fixed** (`TagsMd: TagsForbidden`). Test `TestVerifyAttestation_CBORTagsAreRejected`; the Apple guide sample still verifies. |
| F3 | Low (hardening) | Key id was decoded with permissive base64: a last character with non-zero padding bits is a second spelling of the same 32 bytes. Harmless today (everything uses the decoded bytes) but undesirable in logs, caches or future string-keyed code. | **Fixed** (`StdEncoding.Strict()`). Test in `TestKeyID_RoundTrip`. |
| F4 | Low | The rate limiter fails open (by design) but did so silently, so a DragonflyDB outage removed the only brake on the CPU-bound attestation path without a trace. | **Fixed**: a warning is logged on limiter error; behaviour unchanged. |
| F5 | Info | Added tests for the nonce extension: trailing bytes after the sequence, a second element inside it, wrong nonce length. They passed unchanged (the parser was already strict). | Tests added. |

No defect was found in the certificate chain, nonce, key id, rpIdHash, counter or aaguid logic.

## Attack-by-attack notes

| Attack | Result |
|---|---|
| Replay a captured attestation | Fails: the nonce binds a one-time challenge that is bound to the user and already spent. |
| Enroll another device's key under my account | Needs that device to attest my challenge; not possible without it. The first valid enroller owns a key id (`ON CONFLICT DO NOTHING`); a second user gets `key_already_enrolled`. |
| Forge a chain | Only the pinned root is trusted; extra certificates in `x5c` only add intermediates and the result must still end at Apple's root. |
| Replay an assertion | Fails once the counter has moved past it (atomic compare-and-set across replicas). See R1 for the delayed-replay caveat. |
| Race two replicas on one counter | One winner; the other gets `counter_not_increasing`. |
| Use my key for another user | `GetKey` is scoped by `(key_id, user_id)`; unknown, revoked and foreign keys give the same answer. |
| Oversized or hostile CBOR | Request body limited to 64 KiB, decoder limits as above, chain at most 4 certificates; fuzz-style cases (empty, truncated, deep nesting, trailing data, garbage certificates) have tests. A Go fuzz target does not exist (see audit scope). |
| Timing | Comparisons are on public values or constant time. Signature verification is the stdlib's. No secret-dependent branch exists in the module. |
| Error oracle | The caller learns a coarse `FailureReason` for its own submission. The order of checks reveals which stage failed to the authenticated key owner only. No stack, no certificate content and no challenge are logged or returned; logs carry the reason and, on success, the environment. `key_already_enrolled` reveals that a key id exists, but a caller must already hold a valid attestation for it. |
| ECDSA signature malleability | `(r, s)` and `(r, n-s)` both verify; irrelevant because signatures are not used as identifiers and replay is stopped by the counter. |
| Clock skew | A wrong server clock rejects valid attestations (certificate validity), never accepts invalid ones. |

## Residual risks (accepted or open)

| ID | Risk | Mitigation / owner decision |
|---|---|---|
| R1 | **An assertion carries no server challenge.** The counter stops exact replay, but an assertion captured and withheld can be replayed later while its counter is still above the stored one. Callers must put a fresh server nonce or request-specific data in `payload` (the client-data convention supports it) and keep assertions on TLS. | Document at every call site that enforces something; consider a server challenge in the assertion convention before enforcing sensitive RPCs. |
| R2 | A rooted or jailbroken device with a genuine key can sign anything the app asks the key to sign; App Attest proves a genuine app instance on genuine hardware at enrollment, not that the app is uncompromised later. | Inherent to App Attest; treat as one signal, not as authorisation. |
| R3 | The attestation **receipt** (risk metric via Apple's server API) and the optional authData extensions are not evaluated. | Accepted; would need Apple credentials and a new outbound dependency. |
| R4 | No per-user key cap and no revoke RPC: a user can enroll about 10 keys a minute (rate limit) until the retention purge; revocation exists only as the `revoked_at` column. | Add a cap and an admin revoke before enforcing. |
| R5 | Without DragonflyDB the rate limiter falls back to per-replica limits (logged), so the effective limit is the configured one times the replica count; attestation CPU stays bounded by that, the authentication requirement and the 64 KiB body. | Accepted; alert on the new warning. |
| R6 | Apple's root CA is embedded (valid to 2045). Rotation needs a release. | Re-verify the fingerprint against Apple's published root when the dependency is touched. |
| R7 | The Postgres integration tests (`postgres_integration_test.go`) need a database and were **not run** in this review. | Run `task test:integration` where Docker exists. |
| R8 | No test with a real device or Apple's production service, and only one genuine Apple sample. | The first real device test is the acceptance test. |

## Scope and checklist for an external audit

A human reviewer (a cryptographer or mobile-security firm with App Attest experience) should be engaged before any
RPC enforces attestation. Suggested scope:

1. **Protocol conformance**: re-derive every step of Apple's checklist from Apple's current documentation, including
   anything added since 2026-10-29; confirm the double SHA-256 on assertions and the credential-certificate profile.
2. **Real-world corpus**: run the verifier against attestations and assertions from real devices (iOS, iPadOS,
   macOS, Mac Catalyst, development and production), several OS versions, including edge cases (key regenerated,
   app reinstalled, restore from backup, clock skew).
3. **Parsers**: review the CBOR, DER and authenticator-data handling; run Go fuzzing (`go test -fuzz`) on
   `VerifyAttestation`, `VerifyAssertion`, `ParseAttestationAuthData` and `nonceFromCertificate` for at least several
   CPU-hours; check allocation and CPU per request at the 64 KiB limit.
4. **State machine**: threat-model challenge issue, spend, key insert and counter advance under concurrency, failure
   after a spent challenge, replica failover (Postgres synchronous replica), clock differences between replicas.
5. **Policy**: App ID composition, bundle allow-list changes, development versus production keys, revocation and
   retention (key purge versus counter reuse), the assertion client-data convention (R1) and how each future caller
   binds user, action and freshness.
6. **Operational**: root-CA rotation process, logging and PII, rate limits and their failure mode, configuration
   validation, alerting, incident response if Apple changes the format.
7. **Supply chain**: `fxamacker/cbor` version and settings, Go standard-library `crypto/x509` behaviour on malformed
   certificates, the embedded root's provenance.
8. **Client side** (separate review): key generation and storage, attest-once behaviour, error handling, and
   whether the app can be tricked into signing attacker-chosen payloads.

Deliverable: a written report with findings mapped to the IDs above, and a re-test after fixes. Until then every
claim about App Attest in this repository is "implemented and unit-tested against a synthetic PKI and one Apple
sample", nothing more.

## Verification of this review

Run on the maintainer's Windows machine on 2026-10-29: `CGO_ENABLED=0 go build ./...`, `go vet ./...`,
`CGO_ENABLED=0 go test ./...`, the `architecturetest` package, and `golangci-lint run ./...` (0 issues). The three new
regression tests were also run against the unfixed code (fixes temporarily reverted) and failed as expected.
