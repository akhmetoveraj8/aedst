---
title: Custom code register
description: Every hand-written security-relevant piece of the Desktop client, its risk, tests and the trigger to replace it with a library.
---

# Desktop custom code register

Library-First says: write custom code only for a documented reason. This page lists the **hand-written, security-relevant** parts of `apps/desktop`, because that is where a mistake costs the most. Libraries do the rest (`connectrpc`, `openidconnect`, `keyring-core`, `velopack`, `ed25519-dalek`).

**Honesty.** Tests passed on Windows (see the status in [Architecture](/desktop/architecture)). Nothing ran on Linux or against a real server or identity provider. "Covered by" names tests; the first real run and an external review are the acceptance tests.

## 1. OIDC loopback receiver and session (`aedst-oidc`: `loopback.rs`, `callback.rs`, `session.rs`)

| | |
|---|---|
| Why custom | No library offers a native-app loopback receiver. PKCE, state and nonce generation, code exchange, ID-token checks and refresh are library code (`openidconnect`). |
| Risk | Login CSRF (a forged redirect injects an attacker's code), DNS rebinding against the localhost port, a rotated refresh token replayed and the grant revoked, a token in a log. |
| Mitigations | `127.0.0.1`/`[::1]` with an OS-chosen port; exact path and `Host`; 8 KiB head; 5 s read deadline; at most 8 connections; the first callback request closes the listener; constant-time `state` compare (`subtle`); single-flight refresh with an epoch fence; only `{refresh_token, subject}` stored, in the OS keychain, no file fallback; tokens in `Zeroizing` wrappers and redacted in `Debug`. |
| Covered by | Unit tests, 7 integration tests against a wiremock identity provider (key generated at run time), the `KeychainStore` tests on a `keyring-core` mock store, an `--ignored` round trip through the real Windows Credential Manager. |
| Known gaps | Not run against a real ZITADEL; revocation over https untested (the library refuses http); Linux Secret Service untested; `SystemBrowser` never launched in tests; TLS roots for the IdP are bundled Mozilla roots. |
| Replace when | A maintained crate provides a reviewed native-app loopback receiver. |

## 2. Update manifest policy (`aedst-update`, `aedst-release`)

| | |
|---|---|
| Why custom | Signature, rotation, replay, expiry, channel and rollback rules are project policy on top of `ed25519-dalek`; Velopack only downloads and installs, and its feed is not trusted. |
| Risk | The worst class: a bad channel installs attacker code on every user (unsigned or downgraded manifest, hash mismatch, off-host URL, wrong embedded keys). |
| Mitigations | `verify_strict`; fail closed without trusted keys; unknown key ids ignored; signature checked before parsing; version, SHA-256 and size bound to the manifest and the package re-hashed before install; https-only URL policy; crash-loop safe mode; the release tool signs with the app's own verifier. |
| Covered by | Tests in `aedst-update` (tamper, wrong key, rotation, replay, expiry, channel, rollback, hash and size binding) and `aedst-release`. |
| Known gaps | The Velopack install path never ran; TOCTOU between the re-hash and the hand-over; no fuzzing of the manifest parser. |
| Replace when | Velopack (or a TUF client) verifies a signed manifest with rotation and rollback protection itself. |

## 3. Outbox and API call policy (`aedst-outbox`, `aedst-api`)

Project-specific domain logic: the item id is the `Idempotency-Key`; a retryable failure falls back to the queue under the SAME key; one refresh and one replay after `unauthenticated`; retries only for idempotent methods; https required, plain http only for loopback in debug. Risk: a double-applied write or a token sent over plain http. Covered by the shared behaviour fixtures and the crates' own tests. Replace when `connectrpc` gains client interceptors (then the bearer logic moves there).

## 4. PII scrubber (`aedst-telemetry::scrub`)

Hand-written because no `regex` crate is approved. Risk: personal data leaves the device in a log, a breadcrumb or an event. Covered by `tests/scrub.rs`, `tests/logging.rs` and the Sentry wire tests. Replace when a vetted scrubbing library exists.

## 5. Migrations frozen by hash (`aedst-persistence`)

About 40 lines. `rusqlite_migration` 2.6.0 requires `rusqlite ^0.40` and has no hash freeze. Risk: editing a shipped migration silently forks the schema. Covered by `schema_history_is_frozen`, `every_old_version_upgrades_to_the_latest`, `a_newer_database_is_refused`. Replace when `rusqlite_migration` supports the workspace `rusqlite`.

## How this register is kept honest

A new hand-written security-relevant piece gets a row here in the same change. A "replace when" trigger firing opens a decision in [decisions/desktop](/decisions/desktop) before anything is replaced. Keep "Covered by" to tests that exist.
