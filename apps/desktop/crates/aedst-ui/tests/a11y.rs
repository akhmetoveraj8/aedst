#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The accessibility work of 2026-11-28 on Slint's headless testing backend (gallery page 8,
//! `ui/gallery/gallery_a11y.slint`): the dialog's focus trap, toast keys and group, tree keys,
//! roving groups (toggle group, pagination, accordion), the masked one-time code, the 24px
//! checkbox, the mirrored carousel and the reduced-motion switch.
//!
//! WRITTEN WITHOUT A RUST TOOLCHAIN: these tests have never been compiled or run. Focus that
//! moves in a `changed` handler (focus on open, `restore-focus`) is not covered: the tests move
//! the focus with `focus-control`, as the other test files do.

mod support;

use aedst_ui::a11y::{A11yPreferences, apply};
use aedst_ui::gallery::AedstA11y;
use slint::ComponentHandle;
use support::{A11Y, AccessibleRole, ElementHandle, Key, element, gallery, near, press, state};

fn last(ui: &aedst_ui::gallery::Gallery) -> String {
    state(ui).get_last_event().to_string()
}

#[test]
fn file_tree_is_a_tree_with_arrow_keys() {
    let ui = gallery(A11Y, false);
    assert_eq!(
        element(&ui, "Tree files").accessible_role(),
        Some(AccessibleRole::Tree)
    );
    ui.invoke_focus_control("a11y-tree".into());
    // Right opens the closed first folder, Down moves to the open one, Left closes it.
    press(&ui, Key::RightArrow);
    assert_eq!(last(&ui), "tree:lib:open");
    assert_eq!(element(&ui, "lib").accessible_expanded(), Some(true));
    press(&ui, Key::DownArrow);
    press(&ui, Key::LeftArrow);
    assert_eq!(last(&ui), "tree:manuals:closed");
    // End goes to the last row, Enter selects the file.
    press(&ui, Key::End);
    press(&ui, Key::Return);
    assert_eq!(last(&ui), "tree:file:Notes.txt");
}

#[test]
fn file_tree_back_key_moves_to_the_parent_folder() {
    let ui = gallery(A11Y, false);
    ui.invoke_focus_control("a11y-tree".into());
    press(&ui, Key::DownArrow);
    press(&ui, Key::DownArrow);
    press(&ui, Key::LeftArrow);
    // From the file inside "manuals" Left goes to its folder; Enter then toggles that folder.
    press(&ui, Key::Return);
    assert_eq!(last(&ui), "tree:manuals:closed");
}

#[test]
fn file_tree_arrows_are_mirrored_in_rtl() {
    let ui = gallery(A11Y, true);
    ui.invoke_focus_control("a11y-tree".into());
    press(&ui, Key::LeftArrow);
    assert_eq!(last(&ui), "tree:lib:open", "Left is forward in RTL");
    press(&ui, Key::RightArrow);
    assert_eq!(last(&ui), "tree:lib:closed", "Right is back in RTL");
}

#[test]
fn toggle_group_is_one_tab_stop_with_roving_arrows() {
    let ui = gallery(A11Y, false);
    ui.invoke_focus_control("a11y-align".into());
    press(&ui, Key::RightArrow);
    press(&ui, Key::RightArrow);
    press(&ui, " ");
    assert_eq!(last(&ui), "align:2");
    assert_eq!(state(&ui).get_align_index(), 2);
    press(&ui, Key::Home);
    press(&ui, Key::Return);
    assert_eq!(state(&ui).get_align_index(), 0);
}

#[test]
fn toggle_group_arrows_are_mirrored_in_rtl() {
    let ui = gallery(A11Y, true);
    ui.invoke_focus_control("a11y-align".into());
    press(&ui, Key::LeftArrow);
    press(&ui, " ");
    assert_eq!(last(&ui), "align:1", "Left moves forward in RTL");
}

#[test]
fn pagination_moves_between_buttons_and_pages_with_keys() {
    let ui = gallery(A11Y, false);
    ui.invoke_focus_control("a11y-pages".into());
    press(&ui, Key::RightArrow);
    press(&ui, " ");
    assert_eq!(last(&ui), "pager:3");
    press(&ui, Key::PageDown);
    assert_eq!(last(&ui), "pager:4");
    press(&ui, Key::End);
    press(&ui, Key::Return);
    assert_eq!(last(&ui), "pager:5", "End reaches the next button");
    assert_eq!(
        element(&ui, "Result page 5").accessible_role(),
        Some(AccessibleRole::Button)
    );
}

#[test]
fn pagination_arrows_follow_the_drawn_order_in_rtl() {
    let ui = gallery(A11Y, true);
    ui.invoke_focus_control("a11y-pages".into());
    press(&ui, Key::LeftArrow);
    press(&ui, " ");
    assert_eq!(last(&ui), "pager:3", "the higher pages are on the left in RTL");
}

#[test]
fn accordion_headers_are_one_tab_stop_with_up_down() {
    let ui = gallery(A11Y, false);
    ui.invoke_focus_control("a11y-faq".into());
    press(&ui, Key::DownArrow);
    press(&ui, " ");
    assert_eq!(last(&ui), "faq:1");
    assert_eq!(state(&ui).get_faq_index(), 1);
    press(&ui, Key::End);
    press(&ui, Key::Return);
    assert_eq!(state(&ui).get_faq_index(), 2);
    assert_eq!(
        element(&ui, "Support").accessible_expanded(),
        Some(true)
    );
}

#[test]
fn masked_code_never_reaches_the_accessibility_tree() {
    let ui = gallery(A11Y, false);
    ui.invoke_focus_control("a11y-secret".into());
    press(&ui, "1");
    press(&ui, "2");
    let code = element(&ui, "Secret code");
    assert_eq!(code.accessible_value().as_deref(), Some("2 / 4"));
    press(&ui, "3");
    press(&ui, "4");
    assert_eq!(code.accessible_value().as_deref(), Some("4 / 4"));
    assert_eq!(
        last(&ui),
        "secret:1234",
        "the code itself still reaches the feature"
    );
}

#[test]
fn checkbox_target_is_at_least_24_pixels() {
    let ui = gallery(A11Y, false);
    let size = element(&ui, "Accept the terms").size();
    assert!(size.width >= 24.0 && size.height >= 24.0, "{size:?}");
}

#[test]
fn carousel_in_rtl_enters_slides_from_the_left_without_animation_when_motion_is_reduced() {
    let ui = gallery(A11Y, true);
    apply(&ui, A11yPreferences::new(true, false));
    ui.invoke_focus_control("a11y-carousel".into());
    let one = element(&ui, "Slide one").absolute_position().x;
    let two = element(&ui, "Slide two").absolute_position().x;
    assert!(
        one > two,
        "slide one is at the reading start, the right, in RTL: {one} vs {two}"
    );
    press(&ui, Key::LeftArrow);
    assert_eq!(state(&ui).get_mirror_index(), 1, "Left is forward in RTL");
    let two_after = element(&ui, "Slide two").absolute_position().x;
    assert!(
        near(two_after, one),
        "slide two took the place of slide one: {two_after} vs {one}"
    );
}

#[test]
fn toaster_is_a_named_group_and_escape_dismisses_the_newest_toast() {
    let ui = gallery(A11Y, false);
    let stack = element(&ui, "Alert notifications");
    assert_eq!(stack.accessible_role(), Some(AccessibleRole::Groupbox));
    assert_eq!(
        stack.accessible_value().as_deref(),
        Some("Second alert. More detail"),
        "the newest toast is the group's value"
    );
    ui.invoke_focus_control("a11y-toaster".into());
    press(&ui, Key::Escape);
    assert_eq!(last(&ui), "a11y-toast-dismissed:second");
    assert_eq!(
        ElementHandle::find_by_accessible_label(&ui, "Dismiss alert toast").count(),
        2,
        "every toast has its own reachable close button"
    );
    element(&ui, "Retry").invoke_accessible_default_action();
    assert_eq!(last(&ui), "a11y-toast-action:second");
}

#[test]
fn dialog_tab_reaches_the_close_button_first_and_escape_closes_from_a_control() {
    let ui = gallery(A11Y, false);
    state(&ui).set_trap_open(true);
    ui.invoke_focus_control("a11y-trap".into());
    // Tab from the dialog's first stop lands on the first control, the close button; one more
    // reaches the first action, and Escape closes from there.
    press(&ui, Key::Tab);
    press(&ui, Key::Tab);
    press(&ui, Key::Escape);
    assert_eq!(last(&ui), "trap:closed");
    assert!(!state(&ui).get_trap_open());
}

#[test]
fn dialog_tab_wraps_at_the_end_instead_of_leaving() {
    let ui = gallery(A11Y, false);
    state(&ui).set_trap_open(true);
    ui.invoke_focus_control("a11y-trap".into());
    // Stops: scope, Close, First, Second, tail. Five more Tabs come back to Close.
    for _ in 0..6 {
        press(&ui, Key::Tab);
    }
    press(&ui, " ");
    assert_eq!(last(&ui), "trap:closed", "the sixth Tab is the close button again");
}

#[test]
fn dialog_shift_tab_wraps_from_the_first_stop_to_the_last_control() {
    let ui = gallery(A11Y, false);
    state(&ui).set_trap_open(true);
    ui.invoke_focus_control("a11y-trap".into());
    press(&ui, Key::Backtab);
    press(&ui, Key::Backtab);
    press(&ui, " ");
    assert_eq!(last(&ui), "trap:second");
}

#[test]
fn dialog_panel_is_a_named_group_with_a_description() {
    let ui = gallery(A11Y, false);
    state(&ui).set_trap_open(true);
    let panel = element(&ui, "Trap dialog");
    assert_eq!(panel.accessible_role(), Some(AccessibleRole::Groupbox));
    assert_eq!(
        panel.accessible_description().as_deref(),
        Some("Tab stays in here.")
    );
}

#[test]
fn reduce_motion_and_high_contrast_reach_the_kit() {
    let ui = gallery(A11Y, false);
    let global = ui.global::<AedstA11y>();
    assert!(!global.get_reduce_motion() && !global.get_high_contrast());
    apply(&ui, A11yPreferences::new(true, true));
    assert!(global.get_reduce_motion() && global.get_high_contrast());
    apply(&ui, A11yPreferences::default());
    assert!(!global.get_reduce_motion() && !global.get_high_contrast());
}
