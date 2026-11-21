#![allow(clippy::unwrap_used, clippy::expect_used, dead_code, unused_imports)]
//! Shared helpers of the component tests: the gallery on a page, key presses, lookup by
//! accessible label. Never compiled on the machine they were written on (no Rust toolchain).

pub use aedst_ui::gallery::{Gallery, GalleryState};
pub use i_slint_backend_testing::{AccessibleRole, ElementHandle};
pub use slint::platform::{Key, WindowEvent};
pub use slint::{ComponentHandle, SharedString};

pub const FORMS: i32 = 1;
pub const DISPLAY: i32 = 2;
pub const NAVIGATION: i32 = 3;
pub const OVERLAYS: i32 = 4;

pub fn gallery(page: i32, rtl: bool) -> Gallery {
    i_slint_backend_testing::init_no_event_loop();
    let ui = Gallery::new().unwrap();
    ui.set_rtl(rtl);
    ui.set_page(page);
    ui.show().unwrap();
    // Conditional elements are created when the window is laid out; changing the size forces that.
    let size = ui.window().size();
    ui.window()
        .set_size(slint::PhysicalSize::new(size.width + 1, size.height));
    ui.window().set_size(size);
    ui
}

pub fn state(ui: &Gallery) -> GalleryState<'_> {
    ui.global::<GalleryState>()
}

pub fn press(ui: &Gallery, key: impl Into<SharedString>) {
    let text = key.into();
    ui.window()
        .dispatch_event(WindowEvent::KeyPressed { text: text.clone() });
    ui.window()
        .dispatch_event(WindowEvent::KeyReleased { text });
}

pub fn element(ui: &Gallery, label: &str) -> ElementHandle {
    ElementHandle::find_by_accessible_label(ui, label)
        .next()
        .unwrap_or_else(|| panic!("no element labelled {label:?}"))
}

pub fn near(actual: f32, expected: f32) -> bool {
    (actual - expected).abs() < 0.001
}
