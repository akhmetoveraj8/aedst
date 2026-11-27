//! AEDST desktop: the application window.
//!
//! `services` builds the app scope, `session` the controllers of one signed-in user, `features` is
//! the one table of the composed features, `flow` connects it all to the window (routing, sign-in,
//! chores), `panels` wires the privacy switches and the update banner, `glue` holds each feature's
//! binding code.
//! Windows and Linux only (macOS is `apps/apple`).

// A release build is a GUI program: no console window on Windows (ignored elsewhere). Debug builds
// keep the console for `tracing` output while developing (slint-rules B1).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod connectivity;
mod data_key;
mod features;
mod flow;
mod links;
mod panels;
mod routing;
mod services;
mod session;
mod tls;
mod updates;
mod visibility;
#[cfg(test)]
mod ui_tests;

/// Slint-generated code. It uses `unwrap()` and undocumented items, so the workspace lints are
/// relaxed for this module only; hand-written code stays outside it.
#[allow(
    missing_docs,
    clippy::all,
    clippy::pedantic,
    clippy::unwrap_used,
    clippy::expect_used
)]
mod generated {
    slint::include_modules!();
}

/// The binding code of every feature: the feature's own `src/ui_glue_body.rs`, compiled here against
/// the types this crate's single Slint compilation generates. The body names its crate `feature`, so
/// no source is rewritten; the compiler checks it in both crates.
mod glue {
    macro_rules! feature_glue {
        ($name:ident, $krate:ident, $body:literal) => {
            // The language helpers of the body are unused here (the shell selects the language
            // itself), so dead code is expected; the lints already ran on the body in its own crate.
            #[allow(dead_code, missing_docs)]
            pub mod $name {
                #[allow(unused_imports)]
                use crate::generated::*;
                use $krate as feature;
                include!($body);
            }
        };
    }
    feature_glue!(
        tasks,
        aedst_feature_tasks,
        "../../aedst-feature-tasks/src/ui_glue_body.rs"
    );
    feature_glue!(
        search,
        aedst_feature_search,
        "../../aedst-feature-search/src/ui_glue_body.rs"
    );
    feature_glue!(
        notifications,
        aedst_feature_notifications,
        "../../aedst-feature-notifications/src/ui_glue_body.rs"
    );
    feature_glue!(
        media,
        aedst_feature_media,
        "../../aedst-feature-media/src/ui_glue_body.rs"
    );
    feature_glue!(
        admin,
        aedst_feature_admin,
        "../../aedst-feature-admin/src/ui_glue_body.rs"
    );
}

use std::{error::Error, sync::Arc, time::Duration};

use generated::{AppWindow, ShellScreen, ShellState, SignInError};
use slint::ComponentHandle;
use tokio::{runtime::Handle, sync::watch};

use crate::{
    config::AppConfig,
    services::{BuildError, Services},
};

/// A start that stays up this long counts as healthy, even if the session later ends by a log-off or
/// a shutdown instead of a normal quit (the crash-loop guard only needs to catch early deaths).
const HEALTHY_AFTER: Duration = Duration::from_secs(60);
/// How long the exit waits for background work (a blocking task cannot be aborted, slint-rules T9).
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

fn main() -> Result<(), Box<dyn Error>> {
    // Velopack's hook first: during an install, uninstall or just-applied update it ends or restarts
    // the process. For a normal start (or a build that is not installed) it returns at once.
    aedst_update::velopack_startup();

    let config = AppConfig::from_env()?;
    // Redacted JSON lines in a daily file; the guard flushes the last lines when `main` returns.
    let _log = aedst_telemetry::init_logging(&aedst_telemetry::LoggingConfig::new(
        config.data_dir.join("logs"),
    ))?;
    // Crash-loop guard: a version that keeps dying before it is healthy starts in safe mode, where
    // updates are announced but not applied (only a signed rollback is).
    std::fs::create_dir_all(&config.data_dir)?;
    let health = aedst_update::StartupHealthGuard::new(
        config.data_dir.join("health.json"),
        config.app_version,
    );
    let crash_loop = health
        .record_start()
        .map(|report| report.crash_loop)
        .unwrap_or(false);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let ui = AppWindow::new()?;
    slint::select_bundled_translation(config.language)?;
    ui.set_rtl(config.language == "ar");

    // The window opens at once on "Starting..." (the shell's initial screen). The slow part of the
    // start (database open and migrations, the OS trust store, the consent record) runs on a blocking
    // thread, and the screens are bound on the UI thread when it is done (slint-rules T1, T10).
    let unconfigured = config.oidc.is_none();
    // Visible (not minimized) or not; the timer lives as long as the event loop.
    let (visible, foreground) = watch::channel(true);
    let _visibility = visibility::track(&ui, visible);
    let (weak, handle) = (ui.as_weak(), runtime.handle().clone());
    runtime.spawn_blocking(move || {
        let built = Services::build(&config, &handle);
        let shown = weak.upgrade_in_event_loop(move |ui| {
            let start = Start {
                unconfigured,
                crash_loop,
                foreground,
            };
            attach(&ui, built, start, &handle);
        });
        if shown.is_err() {
            tracing::warn!("the window closed before the services were ready");
        }
    });
    let healthy = health.clone();
    runtime.spawn(async move {
        tokio::time::sleep(HEALTHY_AFTER).await;
        mark_healthy(healthy).await;
    });

    ui.run()?;
    // A normal quit before HEALTHY_AFTER also counts as healthy.
    runtime.block_on(mark_healthy(health));
    runtime.shutdown_timeout(SHUTDOWN_GRACE);
    Ok(())
}

/// Records a healthy start; the file write runs on a blocking thread.
async fn mark_healthy(health: aedst_update::StartupHealthGuard) {
    match tokio::task::spawn_blocking(move || health.mark_healthy()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => tracing::warn!(%error, "could not record a healthy start"),
        Err(error) => tracing::warn!(%error, "the health record task failed"),
    }
}

/// What `main` learned before the services were built.
struct Start {
    unconfigured: bool,
    crash_loop: bool,
    foreground: watch::Receiver<bool>,
}

/// Binds the window to the built services, or shows why nothing works. Runs on the UI thread.
fn attach(ui: &AppWindow, built: Result<Services, BuildError>, start: Start, runtime: &Handle) {
    match built {
        Ok(services) => {
            let services = Arc::new(services);
            if let Some(updates) = &services.updates {
                updates.set_crash_loop(start.crash_loop);
            }
            flow::wire(ui, services, start.foreground, runtime);
        }
        Err(error) => {
            // The window still opens and says why nothing works, instead of vanishing.
            tracing::error!(%error, "cannot start the services");
            let state = ui.global::<ShellState>();
            state.set_screen(ShellScreen::Login);
            state.set_sign_in_error(if start.unconfigured {
                SignInError::Unconfigured
            } else {
                SignInError::Failed
            });
        }
    }
}
