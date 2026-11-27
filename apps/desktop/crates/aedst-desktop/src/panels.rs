//! The shell's side panels: the privacy screen's consent switches and the update banner with its
//! restart button. Split out of `flow` (which wires routing, sign-in and the chores).

use std::sync::Arc;

use aedst_update::{Timing, UpdatePhase};
use slint::ComponentHandle;
use tokio::{runtime::Handle, sync::watch};

use crate::{
    generated::{AppWindow, ShellState, UpdateBanner},
    services::Services,
};

/// The two consent switches of the privacy screen: both off until the user says yes, and a switch is
/// disabled when this build has no DSN or key to send to.
pub fn wire_consent(ui: &AppWindow, services: &Arc<Services>, runtime: &Handle) {
    let state = ui.global::<ShellState>();
    state.set_crash_available(services.crash_available);
    state.set_analytics_available(services.analytics_available);
    state.on_set_crash_consent({
        let (consent, runtime) = (Arc::clone(&services.consent), runtime.clone());
        move |on| {
            let consent = Arc::clone(&consent);
            runtime.spawn(async move {
                if let Err(error) = consent.set_crash(on).await {
                    tracing::warn!(%error, "could not save the crash-report choice");
                }
            });
        }
    });
    state.on_set_analytics_consent({
        let (consent, runtime) = (Arc::clone(&services.consent), runtime.clone());
        move |on| {
            let consent = Arc::clone(&consent);
            runtime.spawn(async move {
                if let Err(error) = consent.set_analytics(on).await {
                    tracing::warn!(%error, "could not save the analytics choice");
                }
            });
        }
    });
    let mut choice = services.consent.subscribe();
    let weak = ui.as_weak();
    runtime.spawn(async move {
        loop {
            let (crash, analytics) = {
                let now = choice.borrow_and_update();
                (now.crash, now.analytics)
            };
            let shown = weak.upgrade_in_event_loop(move |ui| {
                let state = ui.global::<ShellState>();
                state.set_crash_consent(crash);
                state.set_analytics_consent(analytics);
            });
            if shown.is_err() || choice.changed().await.is_err() {
                break;
            }
        }
    });
}

/// Scheduled signed-update checks, the sidebar banner and the restart button.
pub fn wire_updates(
    ui: &AppWindow,
    stop: watch::Receiver<bool>,
    services: &Arc<Services>,
    runtime: &Handle,
) {
    let Some(updates) = services.updates.clone() else {
        return;
    };
    // A first check after a short delay, then every few hours. A check after the machine resumes from
    // sleep (ADR-0036) needs a power-event source that the shell does not have yet.
    runtime.spawn(Arc::clone(&updates).run_scheduled(Timing::default(), stop));

    ui.global::<ShellState>().on_install_update({
        let (updates, runtime) = (Arc::clone(&updates), runtime.clone());
        move || {
            let updates = Arc::clone(&updates);
            runtime.spawn(async move {
                if let Err(error) = updates.install_and_restart().await {
                    tracing::warn!(%error, "could not start the update");
                }
            });
        }
    });

    let mut status = updates.subscribe();
    let weak = ui.as_weak();
    runtime.spawn(async move {
        loop {
            let phase = status.borrow_and_update().phase;
            let (banner, percent) = match phase {
                UpdatePhase::Available => (UpdateBanner::Available, 0),
                UpdatePhase::Downloading { percent } => {
                    (UpdateBanner::Downloading, i32::from(percent))
                }
                UpdatePhase::ReadyToInstall => (UpdateBanner::Ready, 0),
                _ => (UpdateBanner::Hidden, 0),
            };
            let restart = phase == UpdatePhase::RestartRequired;
            let shown = weak.upgrade_in_event_loop(move |ui| {
                let state = ui.global::<ShellState>();
                state.set_update_phase(banner);
                state.set_update_percent(percent);
                if restart {
                    // The installer runs when the app exits: leave now.
                    let _ = slint::quit_event_loop();
                }
            });
            if shown.is_err() || status.changed().await.is_err() {
                break;
            }
        }
    });
}
