//! Opens the design-system gallery:
//! `cargo run -p aedst-ui --example gallery -- [--rtl] [--dark] [--page <0..7>]`
//! (0 basics, 1 forms, 2 display, 3 navigation, 4 overlays, 5 messages, 6 and 7 AI Elements).

use aedst_ui::gallery::Gallery;
use slint::ComponentHandle;

fn main() -> Result<(), slint::PlatformError> {
    let args: Vec<String> = std::env::args().collect();
    let page = args
        .iter()
        .position(|a| a == "--page")
        .and_then(|at| args.get(at + 1))
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0);
    let ui = Gallery::new()?;
    ui.set_rtl(args.iter().any(|a| a == "--rtl"));
    ui.set_dark(args.iter().any(|a| a == "--dark"));
    ui.set_page(page.clamp(0, 7));
    ui.run()
}
