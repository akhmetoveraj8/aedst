#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Behaviour of the conversation components and the axes added on 2026-11-26 (gallery page 5,
//! `ui/gallery/gallery_messages.slint`) and of the drawer's drag-to-dismiss (page 4), on Slint's
//! headless testing backend.
//!
//! WRITTEN WITHOUT A RUST TOOLCHAIN: these tests have never been compiled or run. The message
//! scroller's stick-to-bottom logic runs in `changed` handlers and is not covered here.

mod support;

use slint::LogicalPosition;
use slint::platform::PointerEventButton;
use support::{
    AccessibleRole, ElementHandle, Key, MESSAGES, OVERLAYS, WindowEvent, element, gallery, near,
    press, state,
};

#[test]
fn checkbox_toggles_through_its_accessible_action() {
    let ui = gallery(MESSAGES, false);
    let terms = element(&ui, "Accept the terms");
    assert_eq!(terms.accessible_role(), Some(AccessibleRole::Checkbox));
    assert_eq!(terms.accessible_checked(), Some(false));
    terms.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "checkbox:on");
    assert_eq!(terms.accessible_checked(), Some(true));
}

#[test]
fn avatar_sizes_match_web() {
    let ui = gallery(MESSAGES, false);
    for (label, side) in [
        ("Grace Hopper small", 24.0),
        ("Grace Hopper default", 32.0),
        ("Grace Hopper large", 40.0),
    ] {
        let size = element(&ui, label).size();
        assert!(near(size.width, side), "{label} is {side}px wide");
        assert!(near(size.height, side), "{label} is {side}px high");
    }
}

#[test]
fn small_switch_is_24_by_14() {
    let ui = gallery(MESSAGES, false);
    let size = element(&ui, "Compact mode").size();
    assert!(near(size.width, 24.0) && near(size.height, 14.0));
}

#[test]
fn field_set_is_a_group_named_by_its_legend() {
    let ui = gallery(MESSAGES, false);
    let group = element(&ui, "Notification settings");
    assert_eq!(group.accessible_role(), Some(AccessibleRole::Groupbox));
}

#[test]
fn interactive_bubble_is_a_button() {
    let ui = gallery(MESSAGES, false);
    let retry = element(&ui, "Tap to retry");
    assert_eq!(retry.accessible_role(), Some(AccessibleRole::Button));
    retry.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "bubble:retry");

    let plain = element(&ui, "Muted note");
    assert_eq!(plain.accessible_role(), Some(AccessibleRole::Text));
}

#[test]
fn attachment_opens_and_removes() {
    let ui = gallery(MESSAGES, false);
    let file = element(&ui, "report.pdf");
    assert_eq!(file.accessible_role(), Some(AccessibleRole::Button));
    file.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "attachment:open");

    element(&ui, "Remove report.pdf").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "attachment:removed");
}

#[test]
fn questionnaire_choices_follow_the_keyboard() {
    let ui = gallery(MESSAGES, false);
    let daily = element(&ui, "Each day");
    assert_eq!(daily.accessible_role(), Some(AccessibleRole::RadioButton));
    assert_eq!(daily.accessible_checked(), Some(true));

    ui.invoke_focus_control("questionnaire".into());
    press(&ui, Key::DownArrow);
    assert_eq!(state(&ui).get_last_event(), "questionnaire:weekly");
    assert_eq!(element(&ui, "Each week").accessible_checked(), Some(true));
    assert_eq!(daily.accessible_checked(), Some(false));

    press(&ui, "3");
    assert_eq!(state(&ui).get_last_event(), "questionnaire:never");

    press(&ui, Key::Return);
    assert_eq!(state(&ui).get_last_event(), "questionnaire:next");
}

#[test]
fn questionnaire_progress_is_exposed() {
    let ui = gallery(MESSAGES, false);
    let progress = element(&ui, "Survey progress");
    assert_eq!(
        progress.accessible_role(),
        Some(AccessibleRole::ProgressIndicator)
    );
    assert_eq!(progress.accessible_value().as_deref(), Some("Question 1 of 2"));
}

fn drag_handle(ui: &support::Gallery, handle: &ElementHandle, distance: f32) {
    let origin = handle.absolute_position();
    let size = handle.size();
    let start = LogicalPosition::new(origin.x + size.width / 2.0, origin.y + size.height / 2.0);
    let end = LogicalPosition::new(start.x, start.y + distance);
    let window = ui.window();
    window.dispatch_event(WindowEvent::PointerPressed {
        position: start,
        button: PointerEventButton::Left,
    });
    window.dispatch_event(WindowEvent::PointerMoved { position: end });
    window.dispatch_event(WindowEvent::PointerReleased {
        position: end,
        button: PointerEventButton::Left,
    });
}

#[test]
fn drawer_closes_when_dragged_down_far_enough() {
    let ui = gallery(OVERLAYS, false);
    state(&ui).set_drawer_open(true);
    let handle = element(&ui, "Drag down to close share");

    drag_handle(&ui, &handle, 10.0);
    assert!(state(&ui).get_drawer_open(), "a short drag snaps back");

    drag_handle(&ui, &handle, 200.0);
    assert!(!state(&ui).get_drawer_open(), "a long drag closes the drawer");
    assert_eq!(state(&ui).get_last_event(), "drawer:closed");
}

#[test]
fn drawer_handle_action_closes_it() {
    let ui = gallery(OVERLAYS, false);
    state(&ui).set_drawer_open(true);
    element(&ui, "Drag down to close share").invoke_accessible_default_action();
    assert!(!state(&ui).get_drawer_open());
}
