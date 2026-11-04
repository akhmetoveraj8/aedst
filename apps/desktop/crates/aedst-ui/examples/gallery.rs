//! Opens the design-system gallery: `cargo run -p aedst-ui --example gallery -- [--rtl] [--dark]`.

use aedst_ui::gallery::Gallery;
use slint::ComponentHandle;

fn main() -> Result<(), slint::PlatformError> {
    let args: Vec<String> = std::env::args().collect();
    let ui = Gallery::new()?;
    ui.set_rtl(args.iter().any(|a| a == "--rtl"));
    ui.set_dark(args.iter().any(|a| a == "--dark"));
    ui.run()
}
