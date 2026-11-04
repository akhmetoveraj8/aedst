# apps/desktop - AI agent instructions

The Desktop app (Rust + Slint; the Qt 6 / C++23 tree was deleted). Read the root [AGENTS.md](../../AGENTS.md) and
[CONVENTIONS.md](../../CONVENTIONS.md) first. Why and the module mapping: [ADR-0001](docs/adr/0001-rust-slint-replaces-qt.md).
Approved crates: [library-first/desktop](../../docs/content/library-first/desktop.md). Decisions: [decisions/desktop](../../docs/content/decisions/desktop.md).

Verification status: built and tested on Windows only; never compiled on Linux; never run against a real server or
identity provider ([status](../../docs/content/status.md)). Do not claim Linux or a release build works.

## Pairs: when you do X, use Y

| When you add | Use |
|---|---|
| A crate | `crates/aedst-<name>`; `[lints] workspace = true`; dependencies as `{ workspace = true }` only |
| A dependency | `add-dependency` skill: registry-verified version in the root `Cargo.toml` `[workspace.dependencies]` and the Library-First page in the same change |
| A screen | A `.slint` view in the feature crate, stateless; logic in a presentation module exposed through Slint properties/callbacks. Components from `aedst-ui` first, never a raw `std-widgets` control in a feature |
| An RPC call | The generated `aedst_contract::proto::aedst::<service>::v1::*ServiceClient` behind a trait in the feature's `domain`; implementation in `data`. A new RPC needs no hand-written entry (it follows the server proto). Retry only idempotent methods. Needs `buf` on PATH |
| A write that must survive offline | Try the call first with a fresh key; on a network failure `SqliteOutbox::enqueue(id, kind, payload)` with the SAME id and register an `OutboxHandler` for `kind` (return `Delivery::Retryable`/`Permanent`/`Blocked`); `OutboxService::trigger()` after enqueue, at session start and when the network returns; sign-out calls `purge()` |
| An RPC with a token | `aedst_api::call_authenticated(&session, \|options\| client.method_with_options(req.clone(), options))`; add `with_idempotency_key(options, key)` for queued writes |
| A screen or feature that is optional | `CapabilitiesService::is_enabled("<id>")`; never read the server response directly |
| Local data | `KvStore` for non-secret blobs; a new table is a NEW migration in `aedst-persistence` plus its hash in `FROZEN` (never edit a shipped one; `rusqlite_migration` is rejected, see Library-First) |
| Product analytics | `aedst_telemetry::AnalyticsSink` only; events go to the project's own server (not yet: no ingest RPC, the adapter is an in-memory `BufferedTransport`); never a third-party analytics SDK |
| A UI test | `crates/<crate>/tests/ui.rs` with `i-slint-backend-testing` (`init_no_event_loop()` in every test; find by `accessible-label`; `invoke_accessible_default_action`); the crate is pinned `=` to the slint version |
| A route | Add the name and helper to `aedst-navigation::route`, register it in a `NavGraph` (`register(name, view, link_prefixes)`); features navigate by name only |
| Sign-in or a token | OIDC Authorization Code + PKCE through the system browser is the ONLY sign-in (no email/password UI or use case exists or may be added). `aedst_oidc::OidcSession` (`restore`, `sign_in`, `access_token`, `refresh_after_rejection`, `sign_out`); configuration from `AEDST_OIDC_ISSUER`, `AEDST_OIDC_CLIENT_ID`, `AEDST_OIDC_PROJECT_ID` (`OidcConfig::from_env`); never log or store an access token |
| A secret | `keyring-core` with an explicitly built store (`aedst_oidc::store::KeychainStore`; windows-native / zbus-secret-service store crates; mock store in tests); never the `keyring` meta crate, never a plain file, never logged (`zeroize`) |
| A string | `@tr("" => "text")` in `.slint` (EMPTY context: Slint otherwise looks up `msgctxt` = component name) and the same msgid in all five `i18n/<lang>/LC_MESSAGES/<crate>.po`; `tests/catalogs.rs` fails on a missing, stale or empty entry. Text from Rust is never translated: pass a key and translate it in `.slint` |
| A colour, spacing, font | `AedstTokens.*` from `crates/aedst-ui/ui/aedst_tokens.slint` (generated: `pnpm --dir packages/design-tokens build`); no hex literals in `.slint` or Rust. Never branch on `AedstLayout.rtl` in a feature; add the mirroring to an `aedst-ui` component |
| A log line | `tracing` macros; no `println!`/`eprintln!` (clippy denies them) |
| A feature | Copy `crates/aedst-feature-tasks` (domain, data, presentation, `ui/*.slint`, `ui_glue.rs`, tests incl. `layers.rs` and `catalogs.rs`); depends on core crates only, never on another feature. Mirroring for Arabic: spell out both orders with `if AedstLayout.rtl` in the feature view (Slint cannot reverse a layout) |

## Rules that bite

- `unsafe_code = "deny"` in the workspace (`forbid` breaks Slint-generated code); never add `#[allow(unsafe_code)]` by hand. A platform FFI need goes into one reviewed crate with a documented reason.
- `unwrap()` is denied by clippy; use `?` and typed errors (`thiserror` in libraries, `anyhow` only in the binary).
- Slint-generated code goes in `mod generated { slint::include_modules!(); }` with `#[allow(missing_docs, clippy::all, clippy::unwrap_used, clippy::expect_used)]` on that module only (copy `crates/aedst-ui/src/lib.rs`). Slint does not mirror layouts for Arabic: RTL handling lives in `aedst-ui`, not in features.
- Generated code (protobuf, tokens) is produced at build time and never committed or hand-edited.
- Files stay at or under 300 lines (over 500 fails `task check:file-size`).
- Rejected: PostHog or any third-party analytics SDK, `rusqlite_migration` (rusqlite pin), the `keyring` meta crate, Qt via cxx-qt, Tauri/WebView for this app (owner chose Slint), a second async runtime, a hand-written Connect or OIDC client.

## Gates (run before saying done)

1. `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (or `cargo nextest run`), `cargo deny check` from `apps/desktop`.
2. `task check` from the repo root.
3. If step 1 did not run, say that nothing was compiled or tested.
