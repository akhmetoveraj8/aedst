---
title: "ADR-0013: Android offline writes, session lifecycle and client-side data protection"
description: "Accepted. Client-side counterpart of ADR-0011 (transactional outbox) and ADR-0009 (client identification)."
---

# ADR-0013: Android offline writes, session lifecycle and client-side data protection

## Status

Accepted. Client-side counterpart of [ADR-0011](/decisions/0011-outbox-relay-and-in-process-bus) (transactional outbox) and [ADR-0009](/decisions/0009-api-compatibility-and-client-versioning) (client identification).

## Context

The Android template could sign in but not stay signed in (no refresh, no 401 handling), had no way to perform a write while offline, exposed raw server text to users, shipped with backup enabled and no TLS policy, and generated a new device id on every ViewModel instance.

## Decision

**Session lifecycle.** `feature/auth` owns tokens. An expired access token is handled *reactively*: an OkHttp `Authenticator` (`TokenRefreshAuthenticator`, `core/network`) refreshes once on 401 and replays the request; `AuthTokenRefresher` (`feature/auth`) performs the OIDC `refresh_token` grant at the IdP token endpoint through AppAuth (the app signs in with Authorization Code + PKCE in the system browser; there is no first-party login RPC) and serializes refreshes behind a mutex so a rotating refresh token is redeemed once; the refresh token stays in the Tink-encrypted store. A definitively rejected refresh token (`invalid_grant`) clears the session; a transient failure keeps it. `SessionState` (`core/common`) is the single signal `app/` routes on, so a background sign-out reaches the login screen from anywhere. There is no client-generated device id: sign-in uses the IdP, and push registration identifies the device by its FCM token (`PushRegistrar`). (An earlier draft described a persisted `DeviceIdStore`; it was never built.)

**Offline writes.** Local-first outbox: `core/database` holds an `outbox` table, `core/outbox` delivers it with WorkManager (`CONNECTED` constraint, exponential backoff, ordered, at-least-once). The outbox row id is the `Idempotency-Key`, so a retry after a lost response is de-duplicated by the server. Handlers are contributed per feature with Hilt `@IntoSet`. `NetworkMonitor` (`core/network`) drives the offline banner. No custom scheduler, no polling, no wake locks.

- *The write path is real.* `feature/tasks` registers `task.create`, `task.complete` and `task.update` handlers (`TaskOutboxHandler`); the payload is the request message in protobuf wire format (Base64 in the text column), so the handler sends exactly what the user's action built. `CreateTaskUseCase` and `CompleteTaskUseCase` are *online-first*, like the web client: with a connection the call is sent at once under a fresh operation id; with none, or after a retryable failure (`Offline`, `Unavailable`, `Timeout`, `RateLimited`), the **same** operation id is queued, so a request that reached the server but lost its response is applied once. Reopen and delete stay online-only. Nothing edits a task yet, so `task.update` has a handler but no producer.
- *Direct writes carry a key too.* OkHttp's `retryOnConnectionFailure(true)` silently re-sends a POST whose connection broke, so every direct write (`ConnectTaskRepository` create / complete / reopen / delete, `ConnectMediaRepository.createUpload`) sends a fresh UUID per call as `Idempotency-Key` (`idempotencyHeaders()` in `core/network`).
- *The queue belongs to the session.* `OutboxSignOutHook` cancels the sync work and empties the table when the session ends: on an explicit sign-out and when the IdP rejects the refresh token (`SignOutHook.onSessionEnded`), so the next user never sends the previous user's writes. The same hook point empties Coil's caches and cancels uploads (`core/media`) and zeroes the unread badge (`feature/notifications`).
- *Failed items are visible.* Items parked as `FAILED` raise an alert under the offline banner (`OutboxFailedAlert` in `app/`) with retry (requeue with a fresh attempt budget) and discard; parked items older than 30 days are deleted at the end of a drained sync run.

**Errors.** `AedstError.message` is a diagnostic string for logs. UI shows a localized string chosen by the error *kind* (`AedstError.userMessageRes()`), never the message; analytics record the kind, never the message.

**Client-side data protection.**
- `allowBackup=false`: tokens and the device id are device-bound and useless (or harmful) when restored elsewhere.
- Room is **not encrypted**. Rule: only non-sensitive, re-fetchable data goes in Room; secrets go through `core/security` (Keystore + Tink). This was chosen over SQLCipher to avoid a native dependency, a licence review and a key-management surface for data that should not be there in the first place. `OutboxEntity.payload` must not hold secrets or PII.
- `network_security_config`: HTTPS only, system CAs only; a debug-only overlay allows cleartext to the emulator host and user CAs (debugging proxy).
- TLS pinning from `-Paedst.certPins` (per-environment SPKI hashes, live + backup), applied to the API host with OkHttp `CertificatePinner`. `app:preReleaseBuild` depends on `:core:network:verifyReleaseCertPins`, so a release without pins fails unless `-Paedst.allowUnpinnedRelease=true` is passed deliberately.

**Observability.** Every request carries `X-Aedst-Client: android/<semver>` (ADR-0009) and a W3C `traceparent`, so a client-side failure can be found in the server's OpenTelemetry traces. Debug builds enable StrictMode.

## Consequences

- Features that need offline writes implement one `OutboxHandler` and call `OutboxRepository.enqueue`; they never schedule work themselves.
- Adding a pin rotation is a build-property change, not a code change; the backup pin is mandatory practice.
- Forced upgrade (ADR-0009): `ClientUpgradeInterceptor` (a connect-kotlin interceptor in `core/network`) latches `ClientUpgradeState` (`core/common`, same pattern as `SessionState`) when any RPC fails with `failed_precondition` and the `google.rpc.ErrorInfo` reason `CLIENT_UPGRADE_REQUIRED`; `app/` then shows only `UpgradeRequiredScreen` (`core/ui`, 5 locales, Play Store link). The error maps to `AedstError.UpgradeRequired` (not retryable, server text dropped). The TV app (`app-tv`) shows `TvUpgradeRequiredScreen` from the same latch.
- A transient refresh failure (offline, 5xx) makes `TokenRefresher.refresh` throw `IOException`, so the call fails as a retryable network error (an outbox item is retried, not parked as unauthenticated), as `docs/contract/behavior/session-refresh.json` requires. `invalid_grant` still returns `null` after clearing the session.
- An outbox item parked as `FAILED` keeps `attempts` at the number of recorded retries (`offline-outbox.json`: parked on the 8th failure shows 7).

## Revisit when

- Room must hold sensitive data (then SQLCipher, or move that data to the encrypted store).
- A feature needs server push/sync beyond queued writes (add a read-side sync strategy; keep the outbox for writes).
- Pinning causes an outage during a CA change (move to a pin-set with a longer overlap, or pin the intermediate).
