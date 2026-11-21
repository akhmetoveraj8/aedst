---
title: "Desktop Architecture"
description: "apps/desktop: crates, layers, the Slint shell, sign-in, persistence, offline writes, telemetry, updates and how it is verified."
---

# Desktop Architecture

`apps/desktop` is one Cargo workspace of small `aedst-*` crates, the Desktop counterpart of `apps/android` and `apps/apple` (see [Android architecture](/android/architecture) and [Apple architecture](/apple/architecture)). It follows the same "boundaries first" rule as the server ([server architecture](/server/architecture)). Decision record and spike results: [ADR-0001](../../../apps/desktop/docs/adr/0001-rust-slint-replaces-qt.md).

> **Verification status.** Built, linted and tested on Windows (Rust 1.99.1). **Never compiled on Linux**, never run against a real server or identity provider. Not done: packaging (`vpk`, DEB/RPM/Flatpak), the Velopack install path at run time, the licence pipeline, a screen-reader pass, a connectivity monitor, native file picker and toasts. Items marked `UNVERIFIED` below were not exercised. The `connectrpc` conformance suite is a deferred follow-up.

## Crate map

| Server module / concern | Crate | Role |
|---|---|---|
| `tasks` (reference), `search`, `notifications`, `media`, `admin` | `aedst-feature-tasks`, `-search`, `-notifications`, `-media`, `-admin` | One vertical slice each: `domain`, `data`, `presentation`, `ui/*.slint`, `ui_glue.rs` |
| sign-in (OIDC only) | `aedst-oidc` | Authorization Code + PKCE, loopback redirect, refresh token in the OS keychain |
| wire contract | `aedst-contract` | `buf build` in `apps/server`, then `connectrpc-build`: clients and messages generated at build time, nothing committed |
| calling the server | `aedst-api` | `X-Aedst-Client`, transport policy, `call_authenticated` (one refresh, one replay), idempotency keys |
| `capabilities` | `aedst-capabilities` | Pure rules plus a service with a `kv` cache and last-known fallback |
| local data | `aedst-persistence` | SQLite on one dedicated thread, migrations frozen by hash, `kv` table |
| offline writes | `aedst-outbox` | FIFO queue, the item id is the `Idempotency-Key`, backoff, park on permanent failure |
| navigation | `aedst-navigation` | Routes, `NavGraph`, `Router`, link allow-list, `DeepLinkGate` |
| design system | `aedst-ui` | Tokens (generated), RTL handling, components, gallery |
| observability | `aedst-telemetry` | One PII scrubber, consent, redacted logs, Sentry, analytics port |
| updates | `aedst-update`, `aedst-release` | Signed manifest, Velopack installer; release signing tool |
| shared | `aedst-common` | The thirteen error kinds |
| composition root | `aedst-desktop` | Binary: services, window, flows |

## The boundary rule

A feature depends on core crates only, never on another feature. `tests/layers.rs` in each feature fails when `domain` imports data, UI or wire types, when `data` and `presentation` know each other, or when a feature depends on another feature. Cross-feature navigation goes through `aedst-navigation` route names. `aedst-desktop` is the only crate that knows every feature (manual DI in `services.rs`, like `AppDependencies.swift`).

## UI

Declarative `.slint` views are stateless; logic lives in `presentation` and reaches Slint through properties and callbacks in `ui_glue.rs` (the only Slint-aware Rust of a feature). Slint-generated code sits in a `mod generated { slint::include_modules!(); }` with lints relaxed on that module only (`unsafe_code` is `deny`, because `forbid` breaks generated code). The shell compiles the window and the five feature views in ONE Slint compilation; each feature's `ui_glue.rs` is compiled into the shell by `build.rs` with its `generated` module replaced, so no glue is copied.

Design tokens come from `packages/design-tokens` (Style Dictionary output `aedst/slint-globals`) into the generated `aedst_tokens.slint`. Components: the 60 entries of the kit manifest (`ui-kit.yaml`: 59 shadcn names plus `trace` and `code-block`), one `aedst_<name>.slint` file each exporting `Aedst<Name>` with its variant and size enums, plus the extension `AedstActionRow`. The list, the rules (tokens only, RTL in one place, accessibility, no `std-widgets` in features, every string a property because the kit has no catalogue) and the unverified spots are in the [kit README](../../../apps/desktop/crates/aedst-ui/README.md). Six components (`AedstLabel`, `AedstButton`, `AedstInput` (was `AedstTextField`), `AedstCheckbox`, `AedstBadge`, `AedstActionRow`) were built and tested on Windows before 2026-11-21; `AedstButton` and `AedstBadge` were then changed to variant and size enums, and the other 55 components were added the same day **without a Rust toolchain: written, not compiled, tests never run**.

### RTL and accessibility findings (spike, 2026-11-01)

- Arabic shaping and bidi work. **Layouts and alignment are not mirrored**: a `HorizontalLayout` keeps source order and `start`/`end` are physical. Mirroring is done in `aedst-ui` (`AedstLayout.rtl`, RTL-aware alignment, both orders spelled out); features spell out both orders with `if AedstLayout.rtl`.
- Accessibility on Windows (UI Automation): `Text`, `Edit` and `Button` appear with names from `accessible-label`. `accessible-description` did not surface as `HelpText` on buttons. Linux (AT-SPI) and a real screen reader (Narrator, NVDA) were **not** tested (`UNVERIFIED`). Verdict: conditional go.

## Sign-in

OIDC Authorization Code + PKCE (S256) through the system browser is the **only** way in; there is no email or password screen, use case or string. `openidconnect` does PKCE, the code exchange, ID-token verification (including the signature) and refresh. Custom code is the loopback receiver and callback judge and a single-flight refresh. Only `{refresh_token, subject}` is stored, in the OS keychain through `keyring-core` and an explicitly built store (Windows Credential Manager, Linux Secret Service); no file fallback. Not run against a real ZITADEL (`UNVERIFIED`).

## Networking

`aedst-contract` generates `*ServiceClient`s from the server protos (messages by `buffa`). `connectrpc` has no client interceptors, so `aedst-api::call_authenticated` adds the bearer token through `CallOptions`, refreshes once after `unauthenticated` and replays once. Retries only for idempotent methods. The API client trusts the OS certificate store (rustls with the `ring` provider passed explicitly).

## Persistence, offline writes, capabilities

SQLite (`rusqlite`, bundled) on one dedicated `std::thread`, WAL, `secure_delete`. Schema version is `PRAGMA user_version`; migrations are one list, each frozen by SHA-256 (the `schema_history` test); a newer database is refused. No SQLCipher while only an already-encrypted session and outbox payloads are stored. Writes that fail with a retryable kind are queued under the same `Idempotency-Key` as the direct call; sign-out purges the queue. Behaviour is pinned by `docs/contract/behavior/` fixtures (`offline-outbox`, `capabilities`, `session-refresh`, `error-kinds`) replayed in tests. A feature is shown only if the build contains it AND the server enables it.

## Telemetry

Crash reports (Sentry, no minidump, so native crashes are not captured) and product analytics are separate opt-ins, default OFF, stored in the `kv` table. One scrubber covers logs, breadcrumbs and events. Analytics follow the project rule of one consent point: events are checked against `docs/contract/analytics-events.json` and handed to an `EventTransport`. No third-party analytics SDK is used. The server has no analytics ingest RPC yet, so the adapter is an in-memory bounded queue and the Privacy switch is disabled (see [Decisions](/decisions/desktop)).

## Updates

Signed manifest (Ed25519, key rotation, replay, expiry, channel and rollback rules) is the authority; the Velopack feed is not trusted (version, SHA-256 and size are bound to the manifest). Crash-loop safe mode after three unhealthy starts. Wiring into the shell exists; the Velopack path never ran (`UNVERIFIED`).

## Build and verify

```bash
cd apps/desktop
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
```

`buf` must be on PATH (contract generation). From the repo root: `task verify:desktop`, `task desktop:{fmt,lint,test,build,deny}` (they print `SKIPPED` without cargo). UI tests use `i-slint-backend-testing` (headless): keyboard activation, action-row order in LTR and RTL and a gallery smoke test in `aedst-ui` (`tests/ui.rs`; `tests/components.rs` and `tests/navigation.rs` for the components added on 2026-11-21 were written without a toolchain and have never run), and the sign-in screen states in `aedst-desktop`. Debug builds accept `AEDST_PREVIEW=<section>` to skip sign-in for window captures. Packaging with Velopack `vpk`: [aedst-release README](../../../apps/desktop/crates/aedst-release/README.md); DEB, RPM and Flatpak are not decided. Code signing needs a certificate decision (pending).
