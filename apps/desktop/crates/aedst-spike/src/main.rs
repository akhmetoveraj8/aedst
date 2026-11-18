//! Throw-away spike for ADR-0001 phase 2.

/// Slint-generated code. It uses `unwrap()` and undocumented items, so the workspace lints
/// are relaxed for this module only; hand-written code stays outside it.
#[allow(
    missing_docs,
    clippy::all,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::pedantic
)]
mod generated {
    slint::include_modules!();
}

use generated::Spike;
use slint::ComponentHandle;

fn main() -> Result<(), slint::PlatformError> {
    let ui = Spike::new()?;
    ui.set_rtl(true);
    ui.run()
}
