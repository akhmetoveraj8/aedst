#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Behaviour of the AI Elements of batch B (gallery page 7, `ui/gallery/gallery_ai_2.slint`) on
//! Slint's headless testing backend: prompt input (Enter sends, Shift+Enter does not, the send
//! button, attach and remove), suggestions, model selector trigger, confirmation, sources,
//! inline citation, message actions and the context trigger. Popup contents are not covered.
//!
//! WRITTEN WITHOUT A RUST TOOLCHAIN: these tests have never been compiled or run.

mod support;

use support::{AccessibleRole, Key, WindowEvent, element, gallery, press, state};

const AI_2: i32 = 7;

#[test]
fn enter_submits_the_prompt_and_clears_it() {
    let ui = gallery(AI_2, false);
    ui.invoke_focus_control("prompt".into());
    press(&ui, "H");
    press(&ui, "i");
    press(&ui, "\n");
    assert_eq!(state(&ui).get_last_event(), "prompt:Hi");
    let field = element(&ui, "Prompt message");
    assert_eq!(field.accessible_role(), Some(AccessibleRole::TextInput));
    assert_eq!(field.accessible_value().as_deref(), Some(""));
}

#[test]
fn shift_enter_adds_a_line_instead_of_sending() {
    let ui = gallery(AI_2, false);
    ui.invoke_focus_control("prompt".into());
    press(&ui, "a");
    let events = state(&ui).get_events();
    let shift: slint::SharedString = Key::Shift.into();
    ui.window()
        .dispatch_event(WindowEvent::KeyPressed { text: shift.clone() });
    press(&ui, "\n");
    ui.window()
        .dispatch_event(WindowEvent::KeyReleased { text: shift });
    assert_eq!(state(&ui).get_events(), events, "Shift+Enter must not send");
    let field = element(&ui, "Prompt message");
    assert_eq!(field.accessible_value().as_deref(), Some("a\n"));
}

#[test]
fn send_button_submits_and_attach_asks_the_rust_side() {
    let ui = gallery(AI_2, false);
    ui.invoke_focus_control("prompt".into());
    press(&ui, "x");
    element(&ui, "Send message").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "prompt:x");

    element(&ui, "Attach files").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "attach");

    element(&ui, "Remove report.pdf").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "remove:f1");
}

#[test]
fn empty_prompt_with_an_attachment_can_still_be_sent() {
    let ui = gallery(AI_2, false);
    let send = element(&ui, "Send message");
    assert_eq!(send.accessible_enabled(), Some(true));
}

#[test]
fn suggestion_hands_back_its_text() {
    let ui = gallery(AI_2, false);
    let group = element(&ui, "Suggested prompts");
    assert_eq!(group.accessible_role(), Some(AccessibleRole::Groupbox));
    element(&ui, "Draft a reply").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "suggestion:Draft a reply");
}

#[test]
fn confirmation_reports_the_answer_and_hides_its_buttons() {
    let ui = gallery(AI_2, false);
    element(&ui, "Approve deletion").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "confirm:yes");
    assert!(
        support::ElementHandle::find_by_accessible_label(&ui, "Approve deletion")
            .next()
            .is_none(),
        "the buttons are gone once answered"
    );
    assert!(
        support::ElementHandle::find_by_accessible_label(&ui, "Deletion approved")
            .next()
            .is_some()
    );
}

#[test]
fn sources_disclose_and_open_links() {
    let ui = gallery(AI_2, false);
    let line = element(&ui, "Used 2 sources");
    assert_eq!(line.accessible_role(), Some(AccessibleRole::Button));
    assert_eq!(line.accessible_expanded(), Some(false));
    line.invoke_accessible_default_action();
    assert_eq!(line.accessible_expanded(), Some(true));
    element(&ui, "Task guide (opens in your browser)").invoke_accessible_default_action();
    assert_eq!(
        state(&ui).get_last_event(),
        "source:https://www.example.com/tasks"
    );
}

#[test]
fn citation_trigger_names_the_first_host_and_the_rest() {
    let ui = gallery(AI_2, false);
    let trigger = element(&ui, "example.com and 1 more source");
    assert_eq!(trigger.accessible_role(), Some(AccessibleRole::Button));
}

#[test]
fn message_actions_report_their_id_and_toggle_state() {
    let ui = gallery(AI_2, false);
    element(&ui, "Copy answer").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "message:copy");

    let like = element(&ui, "Good response");
    assert_eq!(like.accessible_checked(), Some(false));
    like.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "message:like");
    assert_eq!(like.accessible_checked(), Some(true));
}

#[test]
fn model_selector_and_context_triggers_are_named() {
    let ui = gallery(AI_2, false);
    assert_eq!(
        element(&ui, "Model").accessible_role(),
        Some(AccessibleRole::Button)
    );
    assert_eq!(
        element(&ui, "Context used: 42%").accessible_role(),
        Some(AccessibleRole::Button)
    );
}

#[test]
fn rtl_keeps_every_control_reachable() {
    let ui = gallery(AI_2, true);
    element(&ui, "Deny deletion").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "confirm:no");
    element(&ui, "List open tasks").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "suggestion:List open tasks");
}
