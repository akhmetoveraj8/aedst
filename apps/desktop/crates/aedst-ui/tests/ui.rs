#![allow(clippy::unwrap_used, clippy::expect_used)]
//! First automated UI tests, on Slint's headless testing backend (`i-slint-backend-testing`):
//! keyboard activation of `AedstButton`, the `AedstActionRow` order in LTR and RTL, and a gallery
//! smoke test. No window is opened. Each test runs on its own thread, so each initialises its own
//! backend.

use aedst_ui::gallery::Gallery;
use i_slint_backend_testing::{AccessibleRole, ElementHandle};
use slint::platform::{Key, WindowEvent};
use slint::{ComponentHandle, SharedString};

fn gallery(rtl: bool, dark: bool) -> Gallery {
    i_slint_backend_testing::init_no_event_loop();
    let ui = Gallery::new().unwrap();
    ui.set_rtl(rtl);
    ui.set_dark(dark);
    ui.show().unwrap();
    ui
}

fn press(ui: &Gallery, key: impl Into<SharedString>) {
    let text = key.into();
    ui.window()
        .dispatch_event(WindowEvent::KeyPressed { text: text.clone() });
    ui.window()
        .dispatch_event(WindowEvent::KeyReleased { text });
}

fn element(ui: &Gallery, label: &str) -> ElementHandle {
    ElementHandle::find_by_accessible_label(ui, label)
        .next()
        .unwrap_or_else(|| panic!("no element labelled {label:?}"))
}

fn smoke(rtl: bool, dark: bool) {
    let ui = gallery(rtl, dark);
    let size = ui.window().size();
    assert!(size.width > 0 && size.height > 0, "rtl={rtl} dark={dark}");
    let (save, cancel) = if rtl {
        ("حفظ", "إلغاء")
    } else {
        ("Save", "Cancel")
    };
    assert_eq!(
        element(&ui, save).accessible_role(),
        Some(AccessibleRole::Button)
    );
    assert_eq!(
        element(&ui, cancel).accessible_role(),
        Some(AccessibleRole::Button)
    );
    assert_eq!(
        element(&ui, "Task title").accessible_role(),
        Some(AccessibleRole::TextInput)
    );
    assert_eq!(element(&ui, "Done").accessible_checked(), Some(true));
}

#[test]
fn gallery_smoke_ltr_light() {
    smoke(false, false);
}

#[test]
fn gallery_smoke_rtl_light() {
    smoke(true, false);
}

#[test]
fn gallery_smoke_ltr_dark() {
    smoke(false, true);
}

#[test]
fn gallery_smoke_rtl_dark() {
    smoke(true, true);
}

#[test]
fn buttons_activate_from_the_keyboard() {
    let ui = gallery(false, false);
    // Tab walks the focus order: text field, checkbox, then the buttons in reading order.
    let mut guard = 0;
    while ui.get_secondary_count() == 0 {
        press(&ui, Key::Tab);
        press(&ui, " ");
        guard += 1;
        assert!(guard < 8, "Cancel was never reached by the keyboard");
    }
    assert_eq!((ui.get_secondary_count(), ui.get_primary_count()), (1, 0));

    press(&ui, Key::Tab);
    press(&ui, " ");
    assert_eq!(ui.get_primary_count(), 1, "Space activates Save");
    press(&ui, Key::Return);
    assert_eq!(
        ui.get_primary_count(),
        2,
        "Enter activates the focused button"
    );
    assert_eq!(ui.get_secondary_count(), 1);
}

#[test]
fn a_screen_reader_action_activates_a_button() {
    let ui = gallery(false, false);
    element(&ui, "Save").invoke_accessible_default_action();
    assert_eq!(ui.get_primary_count(), 1);
    assert_eq!(ui.get_secondary_count(), 0);
}

#[test]
fn action_row_puts_the_primary_action_at_the_reading_end_in_ltr() {
    let ui = gallery(false, false);
    let (save, cancel) = (element(&ui, "Save"), element(&ui, "Cancel"));
    assert!(cancel.absolute_position().x < save.absolute_position().x);
    let width = ui.window().size().width as f32;
    let save_right = save.absolute_position().x + save.size().width;
    assert!(
        save_right > width - 48.0,
        "Save sits at the right edge: {save_right} of {width}"
    );
}

#[test]
fn action_row_mirrors_in_rtl() {
    let ui = gallery(true, false);
    let (save, cancel) = (element(&ui, "حفظ"), element(&ui, "إلغاء"));
    assert!(save.absolute_position().x < cancel.absolute_position().x);
    assert!(
        save.absolute_position().x < 48.0,
        "Save sits at the left edge in RTL"
    );
}

#[test]
fn keyboard_order_follows_the_visual_order_in_rtl() {
    let ui = gallery(true, false);
    // In RTL the primary action is first in both the visual and the focus order.
    let mut guard = 0;
    while ui.get_primary_count() == 0 && ui.get_secondary_count() == 0 {
        press(&ui, Key::Tab);
        press(&ui, " ");
        guard += 1;
        assert!(guard < 8, "no button was reached by the keyboard");
    }
    assert_eq!((ui.get_primary_count(), ui.get_secondary_count()), (1, 0));
}
