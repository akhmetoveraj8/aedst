# Naming: Desktop (Rust + Slint in `apps/desktop-rs`)

Part of [CONVENTIONS.md](../../../CONVENTIONS.md). Levels: **Must** = enforced (linter/CI), **Should** = needs a one-line PR justification to deviate, **Could** = preference.

## Rust + Slint (`apps/desktop-rs`)

Rust follows the standard API guidelines; `rustfmt` and `clippy -D warnings` enforce them (`task desktop-rs:lint`).

| What | Rule | Example | Level |
|---|---|---|---|
| Crate (directory and package) | `aedst-<name>`, kebab-case; features `aedst-feature-<name>` | `aedst-feature-tasks` | Must (by convention, reviewed) |
| Rust file / module | `snake_case.rs` | `task_repository.rs` | Must (`scripts/check-naming.sh`) |
| Slint file | `snake_case.slint` | `task_list_view.slint` | Must (`scripts/check-naming.sh`) |
| Types, traits, enum variants | `PascalCase` | `TaskRepository`, `TaskStatus::Done` | Must (rustc lint) |
| Functions, variables, modules | `snake_case` | `load_tasks`, `retry_count` | Must (rustc lint) |
| Constants and statics | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT` | Must (rustc lint) |
| Slint components | `PascalCase`, `Aedst` prefix for design-system components | `AedstButton` | Should |
| Slint properties and callbacks | `kebab-case` (Slint convention) | `is-checked`, `clicked` | Should |
| Tests | unit tests in a `#[cfg(test)] mod tests` beside the code; integration tests in `tests/<subject>.rs` | `tests/outbox_replay.rs` | Should |

## Enforcement gates (apps/desktop-rs)

`cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo deny check` (see `task verify:desktop-rs`), plus `scripts/check-naming.sh` for file names. The desktop-rs CI workflow is experimental and non-blocking until its first green run.

## Cross-platform vocabulary (same concept, same name on every client)

Use the concept names the other clients use (repository, outbox handler, capability check, forced upgrade). Replay tests that load `docs/contract/behavior/*.json` are named `<subject>_replay.rs` (or `behavior_replay.rs`) under the crate's `tests/`; the `features.yaml` evidence paths point at them. Analytics event names come from `docs/contract/analytics-events.json`.
