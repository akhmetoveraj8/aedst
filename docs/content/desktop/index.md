---
description: "apps/desktop: Rust and Slint, one Cargo workspace, Windows and Linux. Status: built and tested on Windows only."
title: Desktop
---

# Desktop

`apps/desktop`: Rust (edition 2024) and Slint, one Cargo workspace of `aedst-*` crates, packaged with Velopack. Targets are Windows and Linux (macOS is `apps/apple`). Why Rust + Slint, the crate map and the known costs (RTL mirroring, accessibility, licence) are in [ADR-0001](../../../apps/desktop/docs/adr/0001-rust-slint-desktop.md).

**Status.** `cargo build`, `clippy`, `fmt` and `cargo test` ran on Windows. It has **never been compiled on Linux**, never run against a real server or identity provider, and the Velopack install path, packaging and a screen-reader pass are not done. See [Platform status](/status).

| Page | What it covers |
|---|---|
| [Architecture](/desktop/architecture) | Crates, layers, shell, sign-in, persistence, offline writes, telemetry, updates, build and verification |
| [Stack](/desktop/stack) | Every tool and pinned version |
| [i18n](/desktop/i18n) | Slint `@tr` and gettext `.po` catalogs |
| [Custom code register](/desktop/custom-code-register) | Hand-written, security-relevant code and when to replace it |

Related: [UI kit](/ui-kit), [Library-First: Desktop](/library-first#desktop), [Decisions: Desktop](/decisions/desktop).
