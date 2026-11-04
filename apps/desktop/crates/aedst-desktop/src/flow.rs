//! Connects the window to the services: the router drives the screen, the sign-in flow, sign-out,
//! the capability gate (admin section, forced upgrade) and the background chores.

use std::{
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use aedst_capabilities::VersionAdvice;
use aedst_navigation::{Route, names};
use aedst_oidc::{BrowserOpener, OidcError, SystemBrowser};
use aedst_update::{Timing, UpdatePhase};
use slint::ComponentHandle;
use tokio::{runtime::Handle, sync::watch, task::JoinHandle};
use tokio_util::sync::CancellationToken;

use crate::{
    generated::{AppWindow, ShellState},
    services::{SECTIONS, Services},
};

/// How often queued writes are retried without a connectivity monitor.
const OUTBOX_TICK: Duration = Duration::from_secs(60);
/// How often the capabilities are fetched again (the server marks them cacheable for minutes).
const CAPABILITIES_TICK: Duration = Duration::from_secs(5 * 60);

/// Screen and sidebar section for a route name.
#[must_use]
pub fn screen_for(route: &str) -> (&'static str, &'static str) {
    match route {
        names::LOGIN => ("login", "tasks"),
        names::UPGRADE_REQUIRED => ("upgrade", "tasks"),
        other => (
            "app",
            SECTIONS
                .iter()
                .find(|(_, r)| *r == other)
                .map_or("tasks", |(s, _)| s),
        ),
    }
}

/// The key the login screen maps to a translated message.
#[must_use]
pub fn sign_in_error_key(error: &OidcError) -> &'static str {
    match error {
        OidcError::Cancelled => "",
        OidcError::TimedOut => "timeout",
        OidcError::Keychain(_) => "keychain",
        OidcError::Unavailable(_) => "unreachable",
        OidcError::Config(_) => "unconfigured",
        OidcError::Rejected(_) | OidcError::Security(_) => "failed",
    }
}

/// Run-time state of the shell that is not a service.
struct Shell {
    services: Arc<Services>,
    weak: slint::Weak<AppWindow>,
    runtime: Handle,
    sign_in_cancel: Mutex<Option<CancellationToken>>,
    unread_poller: Mutex<Option<JoinHandle<()>>>,
    foreground: watch::Sender<bool>,
    /// Keeps the scheduled update checker running; dropping it stops the checker.
    _update_stop: watch::Sender<bool>,
}

impl Shell {
    fn ui(&self, work: impl FnOnce(ShellState<'_>) + Send + 'static) {
        let _ = self
            .weak
            .upgrade_in_event_loop(move |ui| work(ui.global::<ShellState>()));
    }

    /// Loads what the section shows when it is opened.
    fn load_section(self: &Arc<Self>, section: &str) {
        let (shell, section) = (Arc::clone(self), section.to_owned());
        self.runtime.spawn(async move {
            let s = &shell.services;
            match section.as_str() {
                "tasks" => s.tasks.load_first().await,
                "notifications" => {
                    s.notifications.inbox.load_first().await;
                    s.notifications.preferences.load().await;
                }
                "media" => s.media_library.load_first().await,
                "admin" => {
                    s.admin
                        .open_tab(aedst_feature_admin::presentation::Tab::Overview)
                        .await
                }
                _ => {}
            }
        });
    }

    async fn after_sign_in(self: &Arc<Self>) {
        let s = &self.services;
        s.router.reset_to(Route::new(names::TASKS));
        s.outbox.trigger();
        s.capabilities.refresh().await;
        self.start_unread_poller();
        s.tasks.load_first().await;
    }

    fn start_unread_poller(&self) {
        let (unread, foreground) = (
            Arc::clone(&self.services.notifications.unread),
            self.foreground.subscribe(),
        );
        let task = self
            .runtime
            .spawn(async move { unread.run(foreground).await });
        if let Some(old) = self
            .unread_poller
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .replace(task)
        {
            old.abort();
        }
    }

    fn stop_unread_poller(&self) {
        if let Some(task) = self
            .unread_poller
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            task.abort();
        }
    }

    async fn startup(self: &Arc<Self>) {
        // Debug builds only: `AEDST_PREVIEW=<section>` shows the app screen without signing in, so the
        // layout can be looked at (every request then fails by kind). Never compiled into a release.
        if cfg!(debug_assertions)
            && let Some(section) = std::env::var("AEDST_PREVIEW")
                .ok()
                .filter(|v| !v.is_empty())
        {
            if section == "privacy" {
                self.services.router.reset_to(Route::new(names::TASKS));
                tokio::time::sleep(Duration::from_millis(500)).await;
                self.ui(|state| state.set_section("privacy".into()));
                return;
            }
            if let Some((_, route)) = SECTIONS.iter().find(|(id, _)| *id == section) {
                self.services.router.reset_to(Route::new(route));
                self.load_section(&section);
                return;
            }
        }
        self.services.capabilities.start().await;
        let s = &self.services;
        match s.session.restore().await {
            Ok(Some(_)) => self.after_sign_in().await,
            // Offline with a stored session: the app opens and the outbox and lists catch up later.
            Err(error) if !error.ends_session() && s.session.subject().is_some() => {
                self.after_sign_in().await
            }
            _ => {
                s.router.reset_to(Route::new(names::LOGIN));
            }
        }
    }

    async fn sign_in(self: &Arc<Self>) {
        let cancel = CancellationToken::new();
        *self
            .sign_in_cancel
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(cancel.clone());
        self.ui(|state| {
            state.set_busy(true);
            state.set_sign_in_error("".into());
        });
        let result = self.services.session.sign_in(&SystemBrowser, &cancel).await;
        *self
            .sign_in_cancel
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = None;
        let key = result.as_ref().err().map_or("", sign_in_error_key);
        if let Err(error) = &result {
            tracing::warn!(error = %error, "sign-in did not complete");
        }
        self.ui(move |state| {
            state.set_busy(false);
            state.set_sign_in_error(key.into());
        });
        if result.is_ok() {
            self.after_sign_in().await;
        }
    }

    async fn sign_out(self: &Arc<Self>) {
        self.stop_unread_poller();
        let s = &self.services;
        let out = s.session.sign_out().await;
        // Queued writes must never be delivered under another account.
        if let Err(error) = s.outbox_queue.purge().await {
            tracing::warn!(%error, "could not purge the outbox on sign-out");
        }
        s.router.reset_to(Route::new(names::LOGIN));
        if let Some(url) = out.end_session_url
            && let Err(reason) = SystemBrowser.open(url.as_str())
        {
            tracing::info!(reason, "could not open the end-session page");
        }
    }
}

/// Wires the window to the services and starts the background work.
pub fn wire(ui: &AppWindow, services: Arc<Services>, runtime: &Handle) {
    let shell = Arc::new(Shell {
        services: Arc::clone(&services),
        weak: ui.as_weak(),
        runtime: runtime.clone(),
        sign_in_cancel: Mutex::new(None),
        unread_poller: Mutex::new(None),
        foreground: watch::channel(true).0,
        _update_stop: watch::channel(false).0,
    });
    let state = ui.global::<ShellState>();

    state.on_sign_in({
        let shell = Arc::clone(&shell);
        move || {
            let shell = Arc::clone(&shell);
            let runtime = shell.runtime.clone();
            runtime.spawn(async move { shell.sign_in().await });
        }
    });
    state.on_cancel_sign_in({
        let shell = Arc::clone(&shell);
        move || {
            if let Some(cancel) = shell
                .sign_in_cancel
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .as_ref()
            {
                cancel.cancel();
            }
        }
    });
    state.on_sign_out({
        let shell = Arc::clone(&shell);
        move || {
            let shell = Arc::clone(&shell);
            let runtime = shell.runtime.clone();
            runtime.spawn(async move { shell.sign_out().await });
        }
    });
    state.on_select({
        let shell = Arc::clone(&shell);
        move |section| {
            let section = section.to_string();
            // The privacy screen is a part of the shell, not a routed destination.
            if section == "privacy" {
                shell.ui(|state| state.set_section("privacy".into()));
                return;
            }
            let Some((_, route)) = SECTIONS.iter().find(|(id, _)| *id == section) else {
                return;
            };
            if section == "admin" && !shell.services.capabilities.is_enabled("admin") {
                return;
            }
            if shell.services.router.reset_to(Route::new(route)) {
                shell.load_section(&section);
            }
        }
    });

    wire_consent(ui, &services, runtime);
    wire_updates(ui, &shell, &services, runtime);

    // The router decides which screen and section the window shows.
    let mut snapshots = services.router.subscribe();
    let weak = ui.as_weak();
    runtime.spawn(async move {
        loop {
            let current = snapshots.borrow_and_update().current.clone();
            let (screen, section) = current.map_or(("starting", "tasks"), |r| screen_for(&r.name));
            let shown = weak.upgrade_in_event_loop(move |ui| {
                let state = ui.global::<ShellState>();
                state.set_screen(screen.into());
                state.set_section(section.into());
            });
            if shown.is_err() || snapshots.changed().await.is_err() {
                break;
            }
        }
    });

    // The unread badge of the sidebar.
    let mut unread = services.notifications.unread.subscribe();
    let weak = ui.as_weak();
    runtime.spawn(async move {
        loop {
            let count = *unread.borrow_and_update();
            let shown = weak.upgrade_in_event_loop(move |ui| {
                ui.global::<ShellState>()
                    .set_unread(i32::try_from(count).unwrap_or(i32::MAX));
            });
            if shown.is_err() || unread.changed().await.is_err() {
                break;
            }
        }
    });

    // Capabilities: the admin section and the forced-upgrade lock.
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

    // Chores: retry queued writes and refresh the capabilities (no connectivity monitor yet).
    let outbox = Arc::clone(&services.outbox);
    runtime.spawn(async move {
        loop {
            tokio::time::sleep(OUTBOX_TICK).await;
            outbox.trigger();
        }
    });
    let caps = Arc::clone(&services.capabilities);
    runtime.spawn(async move {
        loop {
            tokio::time::sleep(CAPABILITIES_TICK).await;
            caps.refresh().await;
        }
    });

    let starter = Arc::clone(&shell);
    runtime.spawn(async move { starter.startup().await });
}

/// The two consent switches of the privacy screen: both off until the user says yes, and a switch is
/// disabled when this build has no DSN or key to send to.
fn wire_consent(ui: &AppWindow, services: &Arc<Services>, runtime: &Handle) {
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
fn wire_updates(ui: &AppWindow, shell: &Arc<Shell>, services: &Arc<Services>, runtime: &Handle) {
    let Some(updates) = services.updates.clone() else {
        return;
    };
    // A first check after a short delay, then every few hours. A check after the machine resumes from
    // sleep (ADR-0036) needs a power-event source that the shell does not have yet.
    runtime.spawn(
        Arc::clone(&updates).run_scheduled(Timing::default(), shell._update_stop.subscribe()),
    );

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
            let (key, percent) = match phase {
                UpdatePhase::Available => ("available", 0),
                UpdatePhase::Downloading { percent } => ("downloading", i32::from(percent)),
                UpdatePhase::ReadyToInstall => ("ready", 0),
                _ => ("none", 0),
            };
            let restart = phase == UpdatePhase::RestartRequired;
            let shown = weak.upgrade_in_event_loop(move |ui| {
                let state = ui.global::<ShellState>();
                state.set_update_phase(key.into());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_map_to_screens_and_sections() {
        assert_eq!(screen_for(names::LOGIN).0, "login");
        assert_eq!(screen_for(names::UPGRADE_REQUIRED).0, "upgrade");
        assert_eq!(screen_for(names::MEDIA), ("app", "media"));
        assert_eq!(screen_for(names::ADMIN), ("app", "admin"));
        assert_eq!(
            screen_for("tasks/detail"),
            ("app", "tasks"),
            "an unknown route falls back to tasks"
        );
    }

    #[test]
    fn sign_in_errors_map_to_login_messages_and_cancel_shows_none() {
        assert_eq!(sign_in_error_key(&OidcError::Cancelled), "");
        assert_eq!(sign_in_error_key(&OidcError::TimedOut), "timeout");
        assert_eq!(
            sign_in_error_key(&OidcError::Keychain("x".into())),
            "keychain"
        );
        assert_eq!(
            sign_in_error_key(&OidcError::Unavailable("x".into())),
            "unreachable"
        );
        assert_eq!(
            sign_in_error_key(&OidcError::Security("x".into())),
            "failed"
        );
    }
}
