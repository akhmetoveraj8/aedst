#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Behaviour of the AI Elements of batch A (gallery page 6, `ui/gallery/gallery_ai.slint`) on
//! Slint's headless testing backend: the disclosure lines (chain of thought, reasoning, tool,
//! test suites), the plan action, tool approval, queue actions, checkpoint restore, file tree
//! selection and folders, stack frames and the terminal's clear button. Tooltips are not covered.
//!
//! WRITTEN WITHOUT A RUST TOOLCHAIN: these tests have never been compiled or run.

mod support;

use support::{AccessibleRole, element, gallery, state};

const AI: i32 = 6;

#[test]
fn chain_of_thought_header_is_a_disclosure_button() {
    let ui = gallery(AI, false);
    let line = element(&ui, "Searched the docs, Done");
    assert_eq!(line.accessible_role(), Some(AccessibleRole::Button));
    assert_eq!(line.accessible_expanded(), Some(false));
    line.invoke_accessible_default_action();
    assert_eq!(line.accessible_expanded(), Some(true));
    assert_eq!(state(&ui).get_last_event(), "cot:open");
}

#[test]
fn steps_carry_their_status_in_words() {
    let ui = gallery(AI, false);
    let step = element(&ui, "Compare the web stories, Running");
    assert_eq!(step.accessible_role(), Some(AccessibleRole::ListItem));
}

#[test]
fn reasoning_opens_while_thinking_and_closes_when_done() {
    let ui = gallery(AI, false);
    assert_eq!(element(&ui, "Thinking").accessible_expanded(), Some(true));
    element(&ui, "Finish thinking").invoke_accessible_default_action();
    assert_eq!(element(&ui, "Thought for 3 s").accessible_expanded(), Some(false));
}

#[test]
fn reasoning_keeps_the_users_choice() {
    let ui = gallery(AI, false);
    element(&ui, "Thinking").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "reasoning:closed");
    element(&ui, "Finish thinking").invoke_accessible_default_action();
    element(&ui, "Think again").invoke_accessible_default_action();
    // The user closed it while it was thinking: streaming again does not reopen it.
    assert_eq!(element(&ui, "Thinking").accessible_expanded(), Some(false));
}

#[test]
fn plan_action_and_footer_report() {
    let ui = gallery(AI, false);
    assert_eq!(element(&ui, "Migrate to Base UI").accessible_expanded(), Some(true));
    element(&ui, "Edit plan").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "plan:edit");
    element(&ui, "Build it").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "plan:build");
}

#[test]
fn failed_tool_shows_the_error_status() {
    let ui = gallery(AI, false);
    let line = element(&ui, "Failed to read config, Failed");
    assert_eq!(line.accessible_expanded(), Some(false));
    line.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "tool:open");
}

#[test]
fn tool_approval_reports_both_answers() {
    let ui = gallery(AI, false);
    element(&ui, "Skip the command").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "tool:deny");
    element(&ui, "Run the command").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "tool:approve");
}

#[test]
fn queue_action_names_the_todo() {
    let ui = gallery(AI, false);
    element(&ui, "Remove todo").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "queue:q1:remove", "the first todo's action ran");
}

#[test]
fn checkpoint_restores() {
    let ui = gallery(AI, false);
    let restore = element(&ui, "Restore to Button renamed");
    assert_eq!(restore.accessible_role(), Some(AccessibleRole::Button));
    restore.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "checkpoint:restore");
}

#[test]
fn file_tree_selects_files_and_toggles_folders() {
    let ui = gallery(AI, false);
    let folder = element(&ui, "src");
    assert_eq!(folder.accessible_expanded(), Some(true));
    folder.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "folder:src:closed");
    assert_eq!(folder.accessible_expanded(), Some(false));
    element(&ui, "app.rs").invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "file:src/app.rs");
}

#[test]
fn linked_stack_frame_is_a_button() {
    let ui = gallery(AI, false);
    let frame = element(&ui, "renderRow src/table.tsx:42");
    assert_eq!(frame.accessible_role(), Some(AccessibleRole::Button));
    frame.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "frame:0");
    let plain = element(&ui, "src/app.tsx:7");
    assert_eq!(plain.accessible_role(), Some(AccessibleRole::ListItem));
}

#[test]
fn terminal_clear_empties_the_output() {
    let ui = gallery(AI, false);
    let clear = element(&ui, "Clear output");
    assert_eq!(clear.accessible_enabled(), Some(true));
    clear.invoke_accessible_default_action();
    assert_eq!(state(&ui).get_last_event(), "terminal:clear");
    assert_eq!(clear.accessible_enabled(), Some(false));
}

#[test]
fn failed_suite_starts_open_and_passed_suite_closed() {
    let ui = gallery(AI, false);
    let failed = element(&ui, "payment.test.ts, 2 tests, 1 failed, Failed");
    assert_eq!(failed.accessible_expanded(), Some(true));
    let passed = element(&ui, "format.test.ts, 1 test");
    assert_eq!(passed.accessible_expanded(), Some(false));
}

#[test]
fn right_to_left_keeps_every_line_reachable() {
    let ui = gallery(AI, true);
    let line = element(&ui, "Searched the docs, Done");
    line.invoke_accessible_default_action();
    assert_eq!(line.accessible_expanded(), Some(true));
}
