# Brief: building a feature crate in `apps/desktop`

Read first: `apps/desktop/AGENTS.md`, `apps/desktop/docs/adr/0001-rust-slint-desktop.md` (crate map and Slint specifics), and the reference slice `crates/aedst-feature-tasks` (copy its structure and style; do not reinvent it).

## Layout of a feature crate `crates/aedst-feature-<name>`

```
Cargo.toml        (copy tasks' manifest; deps only from [workspace.dependencies], `{ workspace = true }`)
build.rs          (copy tasks' build.rs: aedst-ui library path + bundled translations; change the .slint file name)
i18n/<lang>/LC_MESSAGES/aedst-feature-<name>.po   for en ru tg uz ar
ui/<name>.slint   a `TasksStore`-style exported global (`<Name>Store`), an exported `<Name>Texts` global for translated helpers, an exported `<Name>ListView` component, an exported `<Name>DemoWindow`
src/lib.rs, src/domain/*, src/data/*, src/presentation/*, src/ui_glue.rs
examples/demo.rs  in-memory repository, `--lang`, `--dark`, `--offline`, `--empty`, `--snapshot <png>` (copy tasks' demo)
tests/            support/mod.rs (fakes), controller tests, catalogs.rs, layers.rs (copy both from tasks and adapt names)
```

Layers: `domain` is pure (depends only on `aedst-common`, `futures` BoxFuture): model, validation, ports (traits), use cases. `data` implements the ports with the generated Connect client from `aedst-contract` through `aedst_api::call_authenticated` (token + one refresh + one replay) and maps wire <-> domain in one `mapping.rs`. `presentation` is a view model that publishes a plain `ListView`-like struct on a `tokio::sync::watch`. `ui_glue.rs` is the ONLY Slint-aware Rust. A feature depends on core crates only, never on another feature (`tests/layers.rs` enforces this).

## Rules and lessons learned (they cost real time)

- Toolchain: ALWAYS `export RUSTUP_TOOLCHAIN=stable` (the pinned toolchain directory on this machine is corrupted). Never run `rustup`. Run cargo only with `-p aedst-feature-<name>` (other agents work in parallel in other crates; the target dir lock may make you wait, that is fine).
- Gates before you report done, from `apps/desktop`: `cargo fmt -p aedst-feature-<name>`, `cargo clippy -p aedst-feature-<name> --all-targets -- -D warnings`, `cargo test -p aedst-feature-<name>`. The workspace denies `unwrap()`; `expect()` is a warning that becomes an error. Test files and test support need `#![allow(clippy::unwrap_used, clippy::expect_used)]` at the top. Examples must not use `unwrap`/`print_*` (use `?`).
- Generated Slint code lives in `mod generated { slint::include_modules!(); }` with the allow list used in tasks' `ui_glue.rs`.
- Slint pitfalls: no top-level functions (put helpers in an `export global <Name>Texts`, `public pure function`); `@tr("" => "text")` with an EMPTY context, otherwise translations are looked up by `msgctxt` = component name and nothing translates; do not name a property `row`, `text` collides with `accessible-role: text` (write `AccessibleRole.text`); Slint cannot reverse a layout, so right-to-left order is spelled out with `if AedstLayout.rtl: ... / if !AedstLayout.rtl: ...`; use only `aedst-ui` components (`import { ... } from "@aedst-ui";`: AedstTokens, AedstLayout and the components listed in `crates/aedst-ui/README.md`, for example AedstLabel, AedstButton with `variant: AedstButtonVariant.secondary`, AedstInput, AedstBadge with `variant: AedstBadgeVariant.success`, AedstCheckbox, AedstActionRow; write enum values qualified; the kit has no strings, pass every text as `@tr` from your catalogue); if you need another component, define it locally inside your own `.slint` file and DO NOT edit `crates/aedst-ui` or any other crate. `Flickable` uses `content-height` (not `viewport-height`). Give the window `min-width`/`min-height` (the snapshot uses the minimum size). Buttons have a fixed height per `size` (32px by default).
- Strings: every user-visible string is `@tr("" => "...")` in the `.slint` file, present in all five catalogs (en is the source text, same msgid); placeholders `{}` must be kept; copy `tests/catalogs.rs` (it fails on missing, stale, empty or placeholder-changed entries). Write the ru, tg (Tajik, Cyrillic), uz (Latin) and ar translations yourself; mark the catalogs "machine-assisted". A script like the one that generated tasks' catalogs is fine, but keep it outside the repo (use your scratchpad). Arabic `Plural-Forms` header as in tasks' catalogs. Error text is chosen by `aedst_common::ErrorKind` (translate the KIND in `.slint`, never a raw server message; `Cancelled` shows nothing).
- Behaviour parity: unknown enum values map to `Unknown` and are never offered in pickers; a stale response from an older load is dropped (epoch); `total_count`/page tokens are echoed back exactly; no free text in analytics; `Idempotency-Key` (`aedst_api::with_idempotency_key`) on writes; retryable failures of writes go to the outbox only if the spec of the feature says writes are offline (none of the four features below queue writes except where stated).
- Visual check: render with the demo example (`--snapshot`) in en (light), ar (RTL) and one more locale in dark mode, LOOK at the PNGs (Read tool) and fix layout bugs. Also run it with `--empty` and `--offline`.
- Do NOT: commit, stash, switch branches, delete directories (recursive deletes are denied), edit `Cargo.toml` at the workspace root (unless your task says so), edit docs or `AGENTS.md` (the lead updates docs), touch crates outside your task, or edit another feature's crate.
- Final report (short): files created, what the screen supports, what is NOT done, test counts per gate, anything surprising, and any new dependency you needed (with the reason). Do not claim anything you did not run.
