---
title: Crate boundaries and the feature level
description: "What a Desktop feature crate may depend on, how a crate holds more than one capability, and the gates that check both without cargo."
---

# Desktop: crate boundaries and the feature level

Cross-platform shape: [module, then feature](/architecture/modules-and-features). This page is the Desktop translation and the description of its gates.

> **Verification status:** the gates below are scripts (bash + node). They read `Cargo.toml` files and `.rs` / `.slint` sources and pass on the tree of 2026-11-21. They do not compile anything: Desktop was last built on Windows before the pins moved, and nothing was compiled on the machine that wrote the gates.

## Who may depend on whom

| Crate | May depend on (our crates) |
|---|---|
| `aedst-feature-<module>` (production code) | `aedst-api`, `aedst-common`, `aedst-contract`, `aedst-outbox` |
| `aedst-feature-<module>` (tests, examples) | the same plus `aedst-persistence` |
| `aedst-feature-<module>` (Slint) | its own `ui/` files and the `@aedst-ui` library (`build.rs` passes `../aedst-ui/ui/lib.slint`) |
| Core crates (everything else except the binary) | other core crates; never a feature |
| `aedst-desktop` (the binary) | everything; it is the only crate that composes features |

The feature allowlist was derived from the dependency graph of 2026-11-21, not designed: today no feature needs `aedst-navigation`, `aedst-capabilities` or `aedst-telemetry` (the shell wires routes and capability checks through ports in each feature's `domain`). Extending the list is a decision: change `FEATURE_MAY_USE` in `apps/desktop/scripts/check-feature-boundaries.mjs` and this table in the same change.

## Rules checked by `apps/desktop/scripts/check-feature-boundaries.sh`

| Rule | What fails |
|---|---|
| D1 | A feature crate depends on another feature crate (any dependency kind) or names `aedst_feature_<other>` in Rust code |
| D2 | A feature has a path dependency outside the allowlist, or `aedst-persistence` as a normal dependency |
| D3 | The same at source level: `aedst_<crate>::` in a feature's code, or a `../aedst-<crate>` path in its `build.rs` |
| D4 | A crate other than `aedst-desktop` names a feature in `Cargo.toml`, Rust code, a Slint import or `build.rs` |
| D5 | A feature `.slint` imports `std-widgets.slint`, an unknown `@library`, or a file outside its own `ui/` |
| D6 | The layout rule of the next section |

Comments are ignored (a doc comment may name `aedst_navigation::Router`). Crates listed under `exclude` in the workspace `Cargo.toml` are not checked (`aedst-spike`). Layer rules inside a crate (`domain` is pure, `data` and `presentation` do not know each other) stay in each crate's `tests/layers.rs`, which needs cargo.

## The feature level inside a crate (rule D6)

A module is one crate. A crate with **one capability stays flat**:

```text
crates/aedst-feature-search/
  src/{domain,data,presentation}/   lib.rs   ui_glue.rs
  ui/search.slint
```

When the second capability arrives, the crate is **split in the same change**; the two shapes are never mixed:

```text
crates/aedst-feature-wallet/
  src/lib.rs                 the public contract: re-exports, the only place that names every feature
  src/ui_glue.rs             bindings for the shell
  src/shared/                code two features use (entities, ports); imports no feature
  src/transfer/{domain,data,presentation}/
  src/history/{domain,data,presentation}/
  ui/shared/                 views two features use; imports no feature view
  ui/transfer/*.slint
  ui/history/*.slint
  i18n/<lang>/LC_MESSAGES/aedst-feature-wallet.po    one catalogue per crate, not per feature
```

D6 fails when: `src/` holds both layer folders and other folders; `src/<feature>/` holds a folder that is not a layer; `ui/<name>/` has no `src/<name>/`; a flat crate has a folder under `ui/`; `src/<a>/` uses `crate::<b>`; `src/shared` uses a feature; a view under `ui/<a>/` imports from `ui/<b>/`.

**State today:** all five feature crates are flat and pass. No crate was restructured: moving Rust modules without a compiler is not a mechanical change here (`ui_glue.rs` is compiled a second time inside the shell, and the `tests/layers.rs` paths would move). Candidates for the split after the first green CI run, because their descriptions already name several capabilities: `aedst-feature-notifications` (inbox, unread badge, preferences), `aedst-feature-admin` (overview, users, tasks, audit, broadcast), `aedst-feature-media` (library, upload, viewer).

## Approved crates and shared versions (`check-approved-crates.sh`)

`apps/desktop/scripts/check-approved-crates.sh` covers both Rust projects, `apps/desktop` and `apps/gateway`, without cargo:

| Rule | What fails |
|---|---|
| A1 | A desktop crate declares an external dependency that is not `{ workspace = true }`, or one the workspace does not declare |
| A2 | A declared dependency is missing from `approved-crates.txt` (next to that project's `deny.toml`) |
| A3 | A line of `approved-crates.txt` is not named on the Library-First page (backticks or bold), or is no longer declared |
| A4 | A declared dependency is banned in `deny.toml` (`[bans] deny`) |
| V1 | A crate both projects declare has different version requirements |
| L1 | A rustc or clippy lint level differs between the two, except the two documented differences below |
| T1 | The two `rust-toolchain.toml` files pin different channels |

Why a script and not cargo-deny: in cargo-deny 0.20.2 `[bans] allow` denies every crate that is not listed, transitive ones included, so it cannot hold a list of direct dependencies. `deny.toml` keeps licences, advisories, sources and the ban list; `[bans.workspace-dependencies]` repeats A1 on the resolved graph (written without cargo, never evaluated).

The two workspaces stay separate (the gateway is a service with its own lock file and release profile). Documented lint differences: `unsafe_code` is `deny` on Desktop and `forbid` on the gateway (Slint-generated code carries `#[allow(unsafe_code)]`, which `forbid` overrules); `clippy::panic` is denied on the gateway only. On Desktop a search of 2026-11-21 found no `panic!`, `unreachable!` or `todo!` in production code, but nine `panic!` calls in integration-test helpers (outside `#[test]` functions, so `allow-panic-in-tests` does not cover them; two are in `aedst-ui`) and Slint-generated code is unchecked, so the lint is applied with a compiler, together with an `#![allow(clippy::panic)]` in those test files. Not aligned and not checked: `rust-version` is `1.95` on Desktop and `1.100` on the gateway while both toolchains are `1.100.0`.

## Where the gates run

| Where | Command |
|---|---|
| Locally and in `policies-ci.yml` (every PR) | `task check:boundaries` (`scripts/check-boundaries.sh desktop`) |
| `desktop-ci.yml`, job `boundaries` | `bash scripts/check-feature-boundaries.sh` |
| `gateway-ci.yml`, job `dependency-policy` | `bash apps/desktop/scripts/check-approved-crates.sh` |
| Pre-commit (`lefthook.yml`, `rust-gates`) | the same entry point with `--no-self-test` |

Each gate has a negative self-test (`--self-test`): fixtures written to a temporary directory, one seeded violation per rule, and a good tree that must pass. The default run executes the real check and both self-tests.
