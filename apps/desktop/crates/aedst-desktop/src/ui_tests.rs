//! UI state tests for the sign-in screen on Slint's headless testing backend. The only way in is
//! the system browser (OIDC Authorization Code + PKCE): there is no field for a user name or a
//! password, and the tests pin that.

#![allow(clippy::expect_used)]

use std::{cell::Cell, rc::Rc};

use i_slint_backend_testing::{AccessibleRole, ElementHandle};
use slint::ComponentHandle;

use crate::generated::{AppWindow, ShellScreen, ShellState, SignInError};

fn login_window() -> AppWindow {
    i_slint_backend_testing::init_no_event_loop();
    let ui = AppWindow::new().expect("window");
    // The labels are looked up by their English text; the OS locale must not decide. The catalogs
    // are registered when the first window is created.
    slint::select_bundled_translation("en").expect("english catalog");
    ui.global::<ShellState>().set_screen(ShellScreen::Login);
    ui.global::<ShellState>().set_sign_in_available(true);
    ui.show().expect("show");
    ui
}

/// Conditional elements are created when the window is laid out; changing the size forces that.
fn settle(ui: &AppWindow) {
    let size = ui.window().size();
    let nudge = slint::PhysicalSize::new(size.width + 1, size.height);
    ui.window().set_size(nudge);
    ui.window().set_size(size);
}

fn with_label(ui: &AppWindow, label: &str) -> Vec<ElementHandle> {
    settle(ui);
    // One element per button: the label is also visible on the Text inside it.
    ElementHandle::find_by_accessible_label(ui, label)
        .filter(|e| e.type_name().is_some_and(|name| name == "AedstButton"))
        .collect()
}

fn text_inputs(ui: &AppWindow) -> usize {
    ElementHandle::find_by_element_type_name(ui, "TextInput")
        .filter(|e| e.accessible_role() == Some(AccessibleRole::TextInput))
        .count()
}

#[test]
fn login_offers_only_the_browser_flow() {
    let ui = login_window();
    let buttons = with_label(&ui, "Continue in browser");
    assert_eq!(buttons.len(), 1, "one way in: the system browser");
    assert_eq!(buttons[0].accessible_enabled(), Some(true));
    assert_eq!(text_inputs(&ui), 0, "no user name or password field");
    assert!(with_label(&ui, "Cancel").is_empty());
}

#[test]
fn pressing_the_button_requests_the_browser_sign_in() {
    let ui = login_window();
    let requested = Rc::new(Cell::new(0));
    let counter = Rc::clone(&requested);
    ui.global::<ShellState>()
        .on_sign_in(move || counter.set(counter.get() + 1));
    with_label(&ui, "Continue in browser")[0].invoke_accessible_default_action();
    assert_eq!(requested.get(), 1);
}

#[test]
fn an_unconfigured_build_disables_sign_in() {
    let ui = login_window();
    ui.global::<ShellState>()
        .set_sign_in_error(SignInError::Unconfigured);
    let buttons = with_label(&ui, "Continue in browser");
    assert_eq!(buttons.len(), 1);
    assert_eq!(buttons[0].accessible_enabled(), Some(false));
}

#[test]
fn waiting_for_the_browser_offers_cancel_instead() {
    let ui = login_window();
    ui.global::<ShellState>().set_busy(true);
    assert!(with_label(&ui, "Continue in browser").is_empty());
    let cancel = with_label(&ui, "Cancel");
    assert_eq!(cancel.len(), 1);
    let cancelled = Rc::new(Cell::new(false));
    let flag = Rc::clone(&cancelled);
    ui.global::<ShellState>()
        .on_cancel_sign_in(move || flag.set(true));
    cancel[0].invoke_accessible_default_action();
    assert!(cancelled.get());
}
