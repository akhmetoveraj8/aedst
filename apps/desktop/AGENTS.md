# apps/desktop - AI agent instructions

The Desktop app (Rust + Slint). Frozen: Core (Server + Web) comes first ([rule](../../docs/agent/rules.md#core-first)). Read the root [AGENTS.md](../../AGENTS.md) and
[CONVENTIONS.md](../../CONVENTIONS.md) first. Why and the crate map: [ADR-0001](docs/adr/0001-rust-slint-desktop.md).
Approved crates: [library-first/desktop](../../docs/content/library-first/desktop.md). Decisions: [decisions/desktop](../../docs/content/decisions/desktop.md).

Verification status: built and tested on Windows only; never compiled on Linux; never run against a real server or
identity provider ([status](../../docs/content/status.md)). Do not claim Linux or a release build works.

## Pairs: when you do X, use Y

| When you add | Use |
|---|---|
| A crate | `crates/aedst-<name>`; `[lints] workspace = true`; dependencies as `{ workspace = true }` only |
| A dependency | `add-dependency` skill: registry-verified version in the root `Cargo.toml` `[workspace.dependencies]`, a line in `approved-crates.txt` and the Library-First page in the same change (`scripts/rust/check-approved-crates.sh` fails otherwise; a crate shared with `apps/gateway` keeps the same version there) |
| A screen state | A Slint `export enum` named after the feature (`TasksPhase`, `AdminTab`), never a string compared in `.slint`; the glue maps the presentation enum to it. Keys into text tables (error kinds, validation keys, status) stay strings: they are the cross-platform contract keys |
| A screen | A `.slint` view in the feature crate, stateless; logic in a presentation module exposed through Slint properties/callbacks. Components from `aedst-ui` first, never a raw `std-widgets` control in a feature (sole exception: `import { ListView }` for long lists, rule M1 of slint-rules) |
| An RPC call | The generated `aedst_contract::proto::aedst::<service>::v1::*ServiceClient` behind a trait in the feature's `domain`; implementation in `data`. A new RPC needs no hand-written entry (it follows the server proto). Retry only idempotent methods. Needs `buf` on PATH |
| A write that must survive offline | Try the call first with a fresh key; on a network failure `SqliteOutbox::enqueue(id, kind, payload)` with the SAME id and register an `OutboxHandler` for `kind` (return `Delivery::Retryable`/`Permanent`/`Blocked`). Delivery needs no call from the feature: the session scope (`aedst-desktop/src/session.rs`) runs `OutboxService::trigger_on_enqueue`, triggers when `Connectivity` turns online and on a 60 s safety tick; sign-out purges. The payload is sealed (AES-256-GCM) by `SqliteOutbox::sealed` |
| An RPC with a token | `aedst_api::call_authenticated(&session, \|options\| client.method_with_options(req.clone(), options))`; add `with_idempotency_key(options, key)` for queued writes |
| A screen or feature that is optional | `CapabilitiesService::is_enabled("<id>")`; never read the server response directly |
| Local data | `KvStore::sealed` (every value AES-256-GCM sealed with the data key from the OS keychain, `aedst-desktop/src/data_key.rs`; no keychain means a key for this run only, never plaintext); a new table is a NEW migration in `aedst-persistence` plus its hash in `FROZEN` (never edit a shipped one; `rusqlite_migration` is rejected, see Library-First) |
| Product analytics | `aedst_telemetry::AnalyticsSink` only; events go to the project's own server (not yet: no ingest RPC, the adapter is an in-memory `BufferedTransport`); never a third-party analytics SDK |
| A UI test | `crates/<crate>/tests/ui.rs` with `i-slint-backend-testing` (`init_no_event_loop()` in every test; find by `accessible-label`; `invoke_accessible_default_action`); the crate is pinned `=` to the slint version |
| A route | Add the name and helper to `aedst-navigation::route`, register it in a `NavGraph` (`register(name, view, link_prefixes)`); features navigate by name only |
| Sign-in or a token | OIDC Authorization Code + PKCE through the system browser is the ONLY sign-in (no email/password UI or use case exists or may be added). `aedst_oidc::OidcSession` (`restore`, `sign_in`, `access_token`, `refresh_after_rejection`, `sign_out`); configuration from `AEDST_OIDC_ISSUER`, `AEDST_OIDC_CLIENT_ID`, `AEDST_OIDC_PROJECT_ID` (`OidcConfig::from_env`); never log or store an access token |
| A secret | `keyring-core` with an explicitly built store (`aedst_oidc::store::KeychainStore`; windows-native / zbus-secret-service store crates; mock store in tests); never the `keyring` meta crate, never a plain file, never logged (`zeroize`) |
| A string | `@tr("<module>" => "text")` in `.slint`: the context is the module (`tasks`, `search`, `notifications`, `media`, `admin`, `desktop` for the shell), the `msgctxt` that `packages/i18n` writes into the generated `.po` files (change the shared JSON, then `node packages/i18n/build.mjs --write-desktop`). The shell merges every catalog into one; the context keeps two modules apart and a conflicting duplicate fails its build. `tests/catalogs.rs` fails on a missing, stale or empty entry. Text from Rust is never translated: pass a key and translate it in `.slint` |
| A colour, spacing, font | `AedstTokens.*` from `crates/aedst-ui/ui/aedst_tokens.slint` (generated: `pnpm --dir packages/design-tokens build`); no hex literals in `.slint` or Rust. Never branch on `AedstLayout.rtl` in a feature; add the mirroring to an `aedst-ui` component |
| A list, an image, a callback that does work, a renderer or Cargo feature change | [Slint and Rust rules](../../docs/content/desktop/slint-rules.md): nothing slow on the UI thread, `ListView` written directly around the `for` (a kit wrapper cannot virtualise) and `aedst_slint_model::apply_rows` in `ui_glue_body.rs` (never `ModelRc::new(VecModel::from(..))` per update), decode and downscale off-thread into `SharedPixelBuffer`, explicit renderer |
| A log line | `tracing` macros; no `println!`/`eprintln!` (clippy denies them) |
| A feature | Copy `crates/aedst-feature-tasks` (domain, data, presentation, `ui/*.slint`, `ui_glue.rs` + `ui_glue_body.rs`, the `standalone` Cargo feature, tests incl. `layers.rs` and `catalogs.rs`); depends on core crates only, never on another feature. In the shell: its id in `src/feature_ids.rs`, a row in `src/features.rs` (`FEATURES`: section, route, link prefixes, capability flag), its controllers in `src/session.rs`, a `feature_glue!` line in `main.rs`, its view and enums in `ui/shell.slint`. Mirroring for Arabic: spell out both orders with `if AedstLayout.rtl` in the feature view (Slint cannot reverse a layout) |

## Rules that bite

- `unsafe_code = "deny"` in the workspace (`forbid` breaks Slint-generated code); never add `#[allow(unsafe_code)]` by hand. A platform FFI need goes into one reviewed crate with a documented reason.
- `unwrap()` is denied by clippy; use `?` and typed errors (`thiserror` in libraries, `anyhow` only in the binary).
- Feature binding code lives in `src/ui_glue_body.rs`, included by the feature's `ui_glue.rs` and by the shell's `glue` module (`include!`, no source rewriting). It names its crate `feature`, never `crate::`, and holds no inner attributes or `//!` comments.
- Per-user state lives in a `SessionScope` (`aedst-desktop/src/session.rs`): a fresh scope is bound at start and after every sign-out, started at sign-in; never keep a user's data or a per-session task in the app-scope `Services`. A glue `bind` returns the `AbortHandle`s of every long-lived task it spawns (the scope aborts them); a new loop that is not returned leaks across accounts.
- Slint-generated code goes in `mod generated { slint::include_modules!(); }` with `#[allow(missing_docs, clippy::all, clippy::unwrap_used, clippy::expect_used)]` on that module only (copy `crates/aedst-ui/src/lib.rs`). Slint does not mirror layouts for Arabic: RTL handling lives in `aedst-ui`, not in features.
- Generated code (protobuf, tokens) is produced at build time and never committed or hand-edited.
- Files stay at or under 300 lines (over 500 fails `task check:file-size`).
- Rejected: PostHog or any third-party analytics SDK, `rusqlite_migration` (rusqlite pin), the `keyring` meta crate, any other language or UI toolkit (Rust + Slint only, no FFI UI bindings), Tauri/WebView for this app (owner chose Slint), a second async runtime, a hand-written Connect or OIDC client.

## Gates (run before saying done)

1. `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (or `cargo nextest run`), `cargo deny check` from `apps/desktop`.
2. `bash scripts/check-feature-boundaries.sh` (no cargo; also in `task check:boundaries`): crate boundaries D1-D6 (features use only `aedst-api`, `aedst-common`, `aedst-contract`, `aedst-outbox`; only `aedst-desktop` composes features; no `std-widgets` in a feature except `ListView`), the feature layout (a second capability means `src/<feature>/` + `ui/<feature>/`, never mixed with the flat shape) and the approved-crate list (`approved-crates.txt`, versions shared with `apps/gateway`). Rules: [desktop/boundaries](../../docs/content/desktop/boundaries.md).
3. `task check` from the repo root.
4. If step 1 did not run, say that nothing was compiled or tested; a pass of step 2 does not mean it compiles.
