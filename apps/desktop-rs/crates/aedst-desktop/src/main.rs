//! AEDST desktop: the application window.
//!
//! `services` builds everything, `flow` connects it to the window, `glue` binds each feature's
//! screen. Windows and Linux only (macOS is `apps/apple`).

mod config;
mod flow;
mod links;
mod services;
mod tls;
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

/// The binding code of every feature, built from the feature's own `ui_glue.rs` against the types
/// generated in this crate (see `build.rs`).
mod glue {
    macro_rules! feature_glue {
        ($name:ident, $file:literal) => {
            // Copies of the feature glue: the language helpers are unused here (the shell selects the
            // language itself), so dead code is expected.
            #[allow(
                dead_code,
                missing_docs,
                clippy::all,
                clippy::pedantic,
                clippy::unwrap_used,
                clippy::expect_used
            )]
            pub mod $name {
                include!(concat!(env!("OUT_DIR"), "/", $file));
            }
        };
    }
    feature_glue!(tasks, "glue_tasks.rs");
    feature_glue!(search, "glue_search.rs");
    feature_glue!(notifications, "glue_notifications.rs");
    feature_glue!(media, "glue_media.rs");
    feature_glue!(admin, "glue_admin.rs");
}

use std::{error::Error, sync::Arc};

use generated::{AppWindow, ShellState};
use slint::ComponentHandle;

use crate::{config::AppConfig, services::Services};

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

    match Services::build(&config, runtime.handle()) {
        Ok(services) => {
            let services = Arc::new(services);
            if let Some(updates) = &services.updates {
                updates.set_crash_loop(crash_loop);
            }
            glue::tasks::bind(&ui, &services.tasks, runtime.handle());
            glue::search::bind(&ui, &services.search, runtime.handle());
            let notifications = glue::notifications::Controllers {
                inbox: Arc::clone(&services.notifications.inbox),
                preferences: Arc::clone(&services.notifications.preferences),
                unread: Arc::clone(&services.notifications.unread),
            };
            glue::notifications::bind(&ui, &notifications, runtime.handle());
            glue::media::bind(
                &ui,
                &services.media_library,
                &services.media_viewer,
                runtime.handle(),
            );
            glue::admin::bind(&ui, &services.admin, runtime.handle());
            flow::wire(&ui, services, runtime.handle());
        }
        Err(error) => {
            // The window still opens and says why nothing works, instead of vanishing.
            tracing::error!(%error, "cannot start the services");
            let state = ui.global::<ShellState>();
            state.set_screen("login".into());
            state.set_sign_in_error(
                if config.oidc.is_none() {
                    "unconfigured"
                } else {
                    "failed"
                }
                .into(),
            );
        }
    }

    ui.run()?;
    // Reached only after a normal quit: this start counts as healthy.
    if let Err(error) = health.mark_healthy() {
        tracing::warn!(%error, "could not record a healthy exit");
    }
    Ok(())
}
