#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Behaviour of the navigation and overlay components added on 2026-11-21 (tabs, collapsible,
//! accordion, pagination, sidebar, breadcrumb, dialog, alert dialog, sheet, drawer, toasts).
//!
//! WRITTEN WITHOUT A RUST TOOLCHAIN: these tests have never been compiled or run. Popups
//! (`PopupWindow` content) and focus that moves in a `changed` handler are not covered.

mod support;

use support::{AccessibleRole, Key, NAVIGATION, OVERLAYS, element, gallery, press, state};

#[test]
fn tabs_move_with_arrows_and_expose_the_tab_role() {
    let ltr = gallery(NAVIGATION, false);
    ltr.invoke_focus_control("tabs".into());
    press(&ltr, Key::RightArrow);
    assert_eq!(state(&ltr).get_tab_index(), 1);
    assert_eq!(state(&ltr).get_last_event(), "tabs:1");
    press(&ltr, Key::End);
    assert_eq!(state(&ltr).get_tab_index(), 2);
    assert_eq!(
        element(&ltr, "Settings").accessible_role(),
        Some(AccessibleRole::Tab)
    );
}

#[test]
fn tabs_arrows_are_mirrored_in_rtl() {
    // One gallery per test: the testing backend is initialised once per test thread.
    let rtl = gallery(NAVIGATION, true);
    rtl.invoke_focus_control("tabs".into());
    press(&rtl, Key::LeftArrow);
    assert_eq!(
        state(&rtl).get_tab_index(),
        1,
        "Left points to the reading end in RTL"
    );
}

#[test]
fn collapsible_accordion_and_pagination_change_state() {
    let ui = gallery(NAVIGATION, false);
    ui.invoke_focus_control("collapsible".into());
    press(&ui, Key::Return);
    assert!(state(&ui).get_collapsible_open());
    press(&ui, " ");
    assert!(!state(&ui).get_collapsible_open());

    element(&ui, "Returns").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_accordion_index(), 1);
    element(&ui, "Returns").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_accordion_index(), -1, "the open section closes");

    element(&ui, "Page 3").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_page_number(), 3);
    element(&ui, "Next").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "page:4");
}

#[test]
fn sidebar_and_breadcrumb_report_the_destination() {
    let ui = gallery(NAVIGATION, false);
    element(&ui, "Media").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "sidebar:media");
    element(&ui, "Projects").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "breadcrumb:0");
}

#[test]
fn dialogs_open_close_and_report_the_choice() {
    let ui = gallery(OVERLAYS, false);
    element(&ui, "Open dialog").invoke_accessible_default_action();
    assert!(state(&ui).get_dialog_open());
    element(&ui, "Close dialog").invoke_accessible_default_action();
    assert!(!state(&ui).get_dialog_open());
    assert_eq!(state(&ui).get_last_event(), "dialog:closed");

    element(&ui, "Delete project").invoke_accessible_default_action();
    assert!(state(&ui).get_alert_open());
    element(&ui, "Keep project").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "alert:cancelled");
    assert!(!state(&ui).get_alert_open());

    state(&ui).set_alert_open(true);
    element(&ui, "Delete forever").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "alert:confirmed");
}

#[test]
fn sheet_drawer_and_toast_close_from_their_buttons() {
    let ui = gallery(OVERLAYS, false);
    state(&ui).set_sheet_open(true);
    element(&ui, "Close filters").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "sheet:closed");

    state(&ui).set_drawer_open(true);
    element(&ui, "Close share").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "drawer:closed");

    element(&ui, "Dismiss notification").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "toast-dismissed:saved");
}
