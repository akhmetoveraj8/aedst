---
title: Stack
description: The complete Desktop stack with exact versions.
---

# Desktop stack

Rust and Slint (`apps/desktop`). All versions live once in the root `Cargo.toml` `[workspace.dependencies]`; they were checked against crates.io on **2026-11-04** and were already the latest stable. Approval rules and rejections: [Library-First](/library-first#desktop). A crate not listed there fails `cargo deny`.

| Area | Tool | Version |
|---|---|---|
| Language | Rust, edition 2024 | toolchain 1.100.0 (`rust-toolchain.toml`), MSRV 1.95 (Slint) |
| UI | Slint (`.slint`, native rendering, no WebView) | 1.19.0 |
| UI tests | `i-slint-backend-testing` (internal Slint crate, pinned with `=`) | =1.19.0 |
| Async / HTTP | tokio, reqwest (rustls) | 1.54.1, 0.13.5 |
| API | connectrpc + connectrpc-build + buffa (pinned exactly, pre-1.0) | =0.9.1, =0.9.0, 0.9.2 |
| Sign-in | openidconnect (Authorization Code + PKCE), webbrowser | 4.1.0, 1.2.6 |
| Secrets | keyring-core + windows-native-keyring-store (Windows) + zbus-secret-service-keyring-store (Linux) | 1.0.1, 1.1.0, 1.0.1 |
| Local DB | rusqlite (bundled SQLite), own migration list frozen by hash | 0.41.1 |
| Updates | velopack, ed25519-dalek, sha2 | 1.2.161, 3.0.0, 0.11.1 |
| TLS | rustls (`ring` provider), rustls-native-certs | 0.23.46, 0.8.5 |
| Logging / crashes | tracing, tracing-subscriber, tracing-appender; sentry (consent-gated) | 0.1.44, 0.3.23, 0.2.5; 0.49.5 |
| Analytics | own port in `aedst-telemetry`; events go to the project's server (ingest RPC is a follow-up) | none |
| Media / notifications | image, notify-rust (not wired) | 0.25.10, 4.18.2 |
| Tests | cargo test (nextest optional), proptest, insta, mockall, wiremock | 1.12.0, 1.49.0, 0.15.0, 0.6.5 |
| Analysis | clippy `-D warnings`, rustfmt, cargo-deny | 0.20.x |
| Packaging | Velopack `vpk` (Windows, AppImage); DEB, RPM, Flatpak not decided | 1.2.161 |

Held back on purpose: `rand_core` 0.6.4 (test-only, `rsa` 0.9 needs it; 0.10.1 exists); `rusqlite_migration` is not used because 2.6.0 requires `rusqlite ^0.40`.

Desktop targets **Windows 10 22H2+/11 and Linux** only.
