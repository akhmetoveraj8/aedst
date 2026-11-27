//! Whether the window is visible to the user (not minimized), published on a `watch` channel so
//! background polling (the unread badge) can pause while nobody looks. Slint has no minimize event,
//! so a UI-thread timer reads the window state; reading it is a cheap property lookup.

use std::time::Duration;

use slint::{ComponentHandle, Timer, TimerMode};
use tokio::sync::watch;

use crate::generated::AppWindow;

/// How often the window state is read.
const POLL: Duration = Duration::from_secs(2);

/// Starts tracking on the UI thread. Keep the returned timer alive for as long as tracking should
/// run (`main` holds it until the event loop ends).
#[must_use]
pub fn track(ui: &AppWindow, visible: watch::Sender<bool>) -> Timer {
    let timer = Timer::default();
    let weak = ui.as_weak();
    timer.start(TimerMode::Repeated, POLL, move || {
        if let Some(ui) = weak.upgrade() {
            let shown = !ui.window().is_minimized();
            visible.send_if_modified(|current| {
                let changed = *current != shown;
                *current = shown;
                changed
            });
        }
    });
    timer
}
