//! The window follows the app-wide state: the router picks the screen and section, the capabilities
//! show flagged sections and lock a forced upgrade. Split out of `flow` (sign-in and the session).

use std::{sync::Arc, time::Duration};

use aedst_capabilities::VersionAdvice;
use aedst_navigation::{Route, names};
use slint::ComponentHandle;
use tokio::runtime::Handle;

use crate::{
    features::{self, HOME},
    generated::{AppWindow, ShellScreen, ShellState},
    services::Services,
};

/// How often the capabilities are fetched again (the server marks them cacheable for minutes).
const CAPABILITIES_TICK: Duration = Duration::from_secs(5 * 60);

/// The router decides which screen and section the window shows.
pub fn wire_router(ui: &AppWindow, services: &Services, runtime: &Handle) {
    let mut snapshots = services.router.subscribe();
    let weak = ui.as_weak();
    runtime.spawn(async move {
        loop {
            let current = snapshots.borrow_and_update().current.clone();
            let (screen, section) = current.map_or((ShellScreen::Starting, HOME.section), |r| {
                features::screen_for(&r.name)
            });
            let shown = weak.upgrade_in_event_loop(move |ui| {
                let state = ui.global::<ShellState>();
                state.set_screen(screen);
                state.set_section(section);
            });
            if shown.is_err() || snapshots.changed().await.is_err() {
                break;
            }
        }
    });
}

/// Capabilities: flagged sections and the forced-upgrade lock, refreshed on a tick (they are
/// anonymous and client-wide, so this runs for the life of the app, signed in or not).
pub fn wire_capabilities(ui: &AppWindow, services: &Services, runtime: &Handle) {
    let mut changed = services.capabilities.subscribe();
    let (weak, caps, router) = (
        ui.as_weak(),
        Arc::clone(&services.capabilities),
        Arc::clone(&services.router),
    );
    runtime.spawn(async move {
        loop {
            changed.borrow_and_update();
            if caps.advice() == VersionAdvice::UpgradeRequired {
                router.lock_to(Route::new(names::UPGRADE_REQUIRED));
            }
            let admin = caps.is_enabled("admin");
            let shown = weak
                .upgrade_in_event_loop(move |ui| ui.global::<ShellState>().set_show_admin(admin));
            if shown.is_err() || changed.changed().await.is_err() {
                break;
            }
        }
    });
    let caps = Arc::clone(&services.capabilities);
    runtime.spawn(async move {
        loop {
            tokio::time::sleep(CAPABILITIES_TICK).await;
            caps.refresh().await;
        }
    });
}
