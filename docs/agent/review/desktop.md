# AI review prompt: apps/desktop

Review the pull request diff under `apps/desktop/` (Rust + Slint). Report findings only; do not push fixes. Desktop is frozen: flag any new feature work that is not a bug fix or part of a recorded desktop task.

## Read first

1. `apps/desktop/AGENTS.md` (situational rules)
2. `docs/content/library-first/desktop.md` (approved stack, explicit rejections)
3. `docs/content/decisions/desktop.md` and `apps/desktop/docs/adr/` (recorded decisions; do not accept a contradicting change)
4. `docs/agent/conventions/desktop.md` (naming)

## Also check

- Rust stays warning-free: `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings`; no `unwrap()` and no `unsafe` (clippy.toml and workspace lints).
- Dependencies: workspace dependencies only; a new crate is in `apps/desktop/Cargo.toml`, passes `cargo deny check` (`deny.toml`) and is listed in `docs/content/library-first/desktop.md`; license impact is considered.
- Banned: cxx-qt, Tauri/WebView, a hand-written Connect or OIDC client, hand-mirrored DTOs, committed generated code. RPC types come from `aedst-contract`.
- Naming holds (`scripts/check-naming.sh`: snake_case `.rs` and `.slint` files); feature crates are `aedst-feature-<id>` with `src/{data,domain,presentation}`, `ui/<id>.slint`, `i18n/<locale>/LC_MESSAGES/*.po` and `tests/`.
- Secrets go through `keyring`, never plain settings or config files.
- Generated tokens (`aedst_tokens.slint`) are not hand-edited; change `packages/design-tokens` and regenerate.
- Engineering standard (`docs/agent/quality-bar.md`; full pages in `docs/content/engineering/`): Rust edition 2024 idioms within MSRV 1.92 (`docs/content/engineering/modern-language.md`: let chains, `LazyLock`, `#[expect]` over `#[allow]`), plus the security and performance pages.

Post findings as a PR review. If nothing applies, approve with no comments.
