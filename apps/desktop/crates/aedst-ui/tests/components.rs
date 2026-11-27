#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Behaviour of the form and display components added on 2026-11-21, on Slint's headless testing
//! backend: state changes, keyboard activation and accessible properties. The gallery pages
//! (`ui/gallery/*.slint`) host the components; `GalleryState` records what they report.
//!
//! WRITTEN WITHOUT A RUST TOOLCHAIN: these tests have never been compiled or run. Popups
//! (`PopupWindow` content) and focus that moves in a `changed` handler are not covered.

mod support;

use support::{
    AccessibleRole, DISPLAY, ElementHandle, FORMS, Key, element, gallery, near, press, state,
};

#[test]
fn switch_toggles_from_the_keyboard_and_reports_its_state() {
    let ui = gallery(FORMS, false);
    let switch = element(&ui, "Notifications");
    assert_eq!(switch.accessible_role(), Some(AccessibleRole::Switch));
    assert_eq!(switch.accessible_checked(), Some(false));

    ui.invoke_focus_control("switch".into());
    press(&ui, " ");
    assert!(state(&ui).get_switch_on(), "Space turns the switch on");
    assert_eq!(switch.accessible_checked(), Some(true));
    assert_eq!(state(&ui).get_last_event(), "switch:on");

    press(&ui, Key::Return);
    assert!(!state(&ui).get_switch_on(), "Enter turns it off again");
}

#[test]
fn a_screen_reader_action_flips_switch_and_toggle() {
    let ui = gallery(FORMS, false);
    element(&ui, "Notifications").invoke_accessible_default_action();
    assert!(state(&ui).get_switch_on());

    let bold = element(&ui, "Bold");
    assert_eq!(bold.accessible_role(), Some(AccessibleRole::Button));
    bold.invoke_accessible_default_action();
    assert!(state(&ui).get_toggle_on());
    assert_eq!(bold.accessible_checked(), Some(true));
}

#[test]
fn toggle_is_pressed_with_space() {
    let ui = gallery(FORMS, false);
    ui.invoke_focus_control("toggle".into());
    press(&ui, " ");
    assert_eq!(state(&ui).get_last_event(), "toggle:on");
    press(&ui, " ");
    assert_eq!(state(&ui).get_last_event(), "toggle:off");
}

#[test]
fn slider_follows_arrow_keys_and_clamps() {
    let ui = gallery(FORMS, false);
    let slider = element(&ui, "Volume");
    assert_eq!(slider.accessible_role(), Some(AccessibleRole::Slider));

    ui.invoke_focus_control("slider".into());
    press(&ui, Key::RightArrow);
    assert!(near(state(&ui).get_slider_value(), 50.0), "one step up");
    press(&ui, Key::End);
    assert!(near(state(&ui).get_slider_value(), 100.0));
    press(&ui, Key::RightArrow);
    assert!(near(state(&ui).get_slider_value(), 100.0), "clamped at the maximum");
    press(&ui, Key::Home);
    assert!(near(state(&ui).get_slider_value(), 0.0));

    slider.invoke_accessible_increment_action();
    assert!(near(state(&ui).get_slider_value(), 10.0));
    assert_eq!(slider.accessible_value().as_deref(), Some("10"));
}

#[test]
fn slider_arrows_are_mirrored_in_rtl() {
    let ui = gallery(FORMS, true);
    ui.invoke_focus_control("slider".into());
    press(&ui, Key::RightArrow);
    assert!(
        near(state(&ui).get_slider_value(), 30.0),
        "Right points to the reading start in RTL"
    );
    press(&ui, Key::LeftArrow);
    press(&ui, Key::LeftArrow);
    assert!(near(state(&ui).get_slider_value(), 50.0));
}

#[test]
fn radio_group_moves_the_selection_with_arrows() {
    let ui = gallery(FORMS, false);
    assert_eq!(element(&ui, "Free").accessible_checked(), Some(true));

    ui.invoke_focus_control("radio".into());
    press(&ui, Key::DownArrow);
    assert_eq!(state(&ui).get_radio_index(), 1);
    assert_eq!(element(&ui, "Team").accessible_checked(), Some(true));
    assert_eq!(element(&ui, "Free").accessible_checked(), Some(false));
    press(&ui, Key::End);
    assert_eq!(state(&ui).get_radio_index(), 2);
    press(&ui, Key::DownArrow);
    assert_eq!(state(&ui).get_radio_index(), 2, "stops at the last item");
    assert_eq!(state(&ui).get_last_event(), "radio:2");
}

#[test]
fn otp_collects_digits_and_reports_completion() {
    let ui = gallery(FORMS, false);
    ui.invoke_focus_control("otp".into());
    for digit in ["1", "x", "2", "3"] {
        press(&ui, digit);
    }
    let code = element(&ui, "Verification code");
    assert_eq!(
        code.accessible_value().as_deref(),
        Some("123"),
        "letters are ignored"
    );
    press(&ui, Key::Backspace);
    assert_eq!(code.accessible_value().as_deref(), Some("12"));
    press(&ui, "7");
    press(&ui, "8");
    assert_eq!(state(&ui).get_last_event(), "otp:1278");
}

#[test]
fn select_and_date_picker_are_comboboxes_with_a_value() {
    let ui = gallery(FORMS, false);
    let fruit = element(&ui, "Fruit");
    assert_eq!(fruit.accessible_role(), Some(AccessibleRole::Combobox));
    assert_eq!(fruit.accessible_value().as_deref(), Some(""));
    state(&ui).set_select_index(1);
    assert_eq!(fruit.accessible_value().as_deref(), Some("Pear"));
    assert!(
        ElementHandle::find_by_accessible_label(&ui, "Start date")
            .any(|e| e.accessible_role() == Some(AccessibleRole::Combobox)),
        "the date picker carries the field label"
    );
}

#[test]
fn calendar_selects_with_the_keyboard_and_by_action() {
    let ui = gallery(FORMS, false);
    ui.invoke_focus_control("calendar".into());
    press(&ui, Key::RightArrow);
    press(&ui, Key::DownArrow);
    press(&ui, Key::Return);
    assert_eq!(state(&ui).get_last_event(), "calendar:2026-11-9");

    element(&ui, "15 November 2026").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "calendar:2026-11-15");
    assert_eq!(
        element(&ui, "15 November 2026").accessible_checked(),
        Some(true)
    );
}

#[test]
fn progress_and_buttons_expose_role_and_value() {
    let ui = gallery(DISPLAY, false);
    let progress = element(&ui, "Upload progress");
    assert_eq!(
        progress.accessible_role(),
        Some(AccessibleRole::ProgressIndicator)
    );
    assert_eq!(progress.accessible_value().as_deref(), Some("40"));
    assert_eq!(
        element(&ui, "Add item").accessible_role(),
        Some(AccessibleRole::Button),
        "an icon button is named by `label`"
    );
}

#[test]
fn data_table_sorts_and_selects_by_action() {
    let ui = gallery(DISPLAY, false);
    element(&ui, "Amount").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "sort:1");
    // The row is named by every cell with its column header, not by the first cell alone.
    let row = element(&ui, "Number: INV-2. Amount: 80.");
    assert_eq!(row.accessible_role(), Some(AccessibleRole::ListItem));
    row.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_table_row(), 1);
}

#[test]
fn trace_step_opens_and_item_activates() {
    let ui = gallery(DISPLAY, false);
    element(&ui, "Plan: Succeeded").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "trace:open:plan");
    element(&ui, "Photos").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "item:photos");
}

#[test]
fn carousel_arrows_follow_the_reading_direction() {
    let ltr = gallery(DISPLAY, false);
    ltr.invoke_focus_control("carousel".into());
    press(&ltr, Key::RightArrow);
    assert_eq!(state(&ltr).get_carousel_index(), 1);
    press(&ltr, Key::RightArrow);
    assert_eq!(state(&ltr).get_carousel_index(), 1, "stops at the last slide");
}
