//! Connects the window to the services: the router drives the screen, the sign-in flow and
//! sign-out swap the session scope, the capability gate locks admin and forced upgrades, and the
//! app-wide chores run.

use std::{
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use aedst_navigation::{Route, names};
use aedst_oidc::{BrowserOpener, OidcError, SystemBrowser};
use slint::ComponentHandle;
use tokio::{runtime::Handle, sync::watch};
use tokio_util::sync::CancellationToken;

use crate::{
    features::{self, HOME},
    generated::{AppWindow, ShellSection, ShellState, SignInError},
    panels,
    routing,
    services::Services,
    session::SessionScope,
};

/// What the login screen says about a failed sign-in (nothing for a cancel).
#[must_use]
pub fn sign_in_error(error: &OidcError) -> SignInError {
    match error {
        OidcError::Cancelled => SignInError::NoError,
        OidcError::TimedOut => SignInError::Timeout,
        OidcError::Keychain(_) => SignInError::Keychain,
        OidcError::Unavailable(_) => SignInError::Unreachable,
        OidcError::Config(_) => SignInError::Unconfigured,
        OidcError::Rejected(_) | OidcError::Security(_) => SignInError::Failed,
    }
}

/// Run-time state of the shell that is not a service.
struct Shell {
    services: Arc<Services>,
    weak: slint::Weak<AppWindow>,
    runtime: Handle,
    /// The scope bound to the window: empty until a sign-in starts it, replaced at sign-out.
    scope: Mutex<Arc<SessionScope>>,
    sign_in_cancel: Mutex<Option<CancellationToken>>,
    /// Whether the window is visible (not minimized); the unread poller pauses while it is not.
    foreground: watch::Receiver<bool>,
    /// Keeps the scheduled update checker running; dropping it stops the checker.
    update_stop: watch::Sender<bool>,
}

impl Shell {
    fn ui(&self, work: impl FnOnce(ShellState<'_>) + Send + 'static) {
        let _ = self
            .weak
            .upgrade_in_event_loop(move |ui| work(ui.global::<ShellState>()));
    }

    fn scope(&self) -> Arc<SessionScope> {
        Arc::clone(&self.scope.lock().unwrap_or_else(PoisonError::into_inner))
    }

    /// Binds `scope` to the window (on the UI thread) and makes it the current one; the previous
    /// scope's work is stopped and, once its callbacks are replaced, its data is freed.
    fn install(&self, scope: Arc<SessionScope>) {
        let previous = std::mem::replace(
            &mut *self.scope.lock().unwrap_or_else(PoisonError::into_inner),
            Arc::clone(&scope),
        );
        previous.end();
        let runtime = self.runtime.clone();
        let _ = self.weak.upgrade_in_event_loop(move |ui| {
            scope.bind(&ui, &runtime);
            forward_unread(&ui, &scope, &runtime);
        });
    }

    /// Loads what the feature of `section` shows when it is opened.
    fn open(&self, section: ShellSection) {
        let Some(feature) = features::by_section(section) else {
            return;
        };
        let scope = self.scope();
        self.runtime
            .spawn(async move { scope.open(feature.id).await });
    }

    async fn after_sign_in(&self) {
        let (s, scope) = (&self.services, self.scope());
        // Queued writes of another account are dropped before anything is delivered.
        match s.session.subject() {
            Some(subject) => s.claim_outbox(&subject).await,
            None => s.drop_outbox().await,
        }
        s.router.reset_to(Route::new(HOME.route));
        scope.start(s, self.foreground.clone(), &self.runtime);
        s.capabilities.refresh().await;
        scope.open(HOME.id).await;
    }

    async fn startup(&self) {
        // Debug builds only: `AEDST_PREVIEW=<section>` shows the app screen without signing in, so the
        // layout can be looked at (every request then fails by kind). Never compiled into a release.
        if cfg!(debug_assertions)
            && let Some(preview) = std::env::var("AEDST_PREVIEW")
                .ok()
                .filter(|v| !v.is_empty())
        {
            self.services.router.reset_to(Route::new(HOME.route));
            if preview == "privacy" {
                tokio::time::sleep(Duration::from_millis(500)).await;
                self.ui(|state| state.set_section(ShellSection::Privacy));
            } else if let Some(feature) = features::FEATURES.iter().find(|f| f.id == preview) {
                self.services.router.reset_to(Route::new(feature.route));
                self.open(feature.section);
            }
            return;
        }
        self.services.capabilities.start().await;
        let s = &self.services;
        match s.session.restore().await {
            Ok(Some(_)) => self.after_sign_in().await,
            // Offline with a stored session: the app opens and the outbox and lists catch up later.
            Err(error) if !error.ends_session() && s.session.subject().is_some() => {
                self.after_sign_in().await;
            }
            _ => {
                s.router.reset_to(Route::new(names::LOGIN));
            }
        }
    }

    async fn sign_in(&self) {
        let cancel = CancellationToken::new();
        *self
            .sign_in_cancel
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(cancel.clone());
        self.ui(|state| {
            state.set_busy(true);
            state.set_sign_in_error(SignInError::NoError);
        });
        let result = self.services.session.sign_in(&SystemBrowser, &cancel).await;
        *self
            .sign_in_cancel
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = None;
        let error = result.as_ref().err().map_or(SignInError::NoError, sign_in_error);
        if let Err(cause) = &result {
            tracing::warn!(error = %cause, "sign-in did not complete");
        }
        self.ui(move |state| {
            state.set_busy(false);
            state.set_sign_in_error(error);
        });
        if result.is_ok() {
            self.after_sign_in().await;
        }
    }

    async fn sign_out(&self) {
        // The user's controllers and background work go first, the login screen at once, then the
        // queue (before the network call, which can take seconds) and the session.
        self.install(SessionScope::new(&self.services.features));
        let s = &self.services;
        s.router.reset_to(Route::new(names::LOGIN));
        s.drop_outbox().await;
        let out = s.session.sign_out().await;
        if let Some(url) = out.end_session_url
            && let Err(reason) = SystemBrowser.open(url.as_str())
        {
            tracing::info!(reason, "could not open the end-session page");
        }
    }
}

/// The sidebar's unread badge follows the scope's counter until that scope is replaced.
fn forward_unread(ui: &AppWindow, scope: &SessionScope, runtime: &Handle) {
    let mut unread = scope.unread();
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
}

/// Wires the window to the services and starts the background work. Runs on the UI thread.
pub fn wire(
    ui: &AppWindow,
    services: Arc<Services>,
    foreground: watch::Receiver<bool>,
    runtime: &Handle,
) {
    let scope = SessionScope::new(&services.features);
    scope.bind(ui, runtime);
    forward_unread(ui, &scope, runtime);
    let shell = Arc::new(Shell {
        services: Arc::clone(&services),
        weak: ui.as_weak(),
        runtime: runtime.clone(),
        scope: Mutex::new(scope),
        sign_in_cancel: Mutex::new(None),
        foreground,
        update_stop: watch::channel(false).0,
    });
    wire_callbacks(ui, &shell);
    panels::wire_consent(ui, &services, runtime);
    panels::wire_updates(ui, shell.update_stop.subscribe(), &services, runtime);
    routing::wire_router(ui, &services, runtime);
    routing::wire_capabilities(ui, &services, runtime);

    let starter = Arc::clone(&shell);
    runtime.spawn(async move { starter.startup().await });
}

fn wire_callbacks(ui: &AppWindow, shell: &Arc<Shell>) {
    let state = ui.global::<ShellState>();
    state.set_sign_in_available(true);
    state.on_sign_in({
        let shell = Arc::clone(shell);
        move || {
            let shell = Arc::clone(&shell);
            let runtime = shell.runtime.clone();
            runtime.spawn(async move { shell.sign_in().await });
        }
    });
    state.on_cancel_sign_in({
        let shell = Arc::clone(shell);
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
        let shell = Arc::clone(shell);
        move || {
            let shell = Arc::clone(&shell);
            let runtime = shell.runtime.clone();
            runtime.spawn(async move { shell.sign_out().await });
        }
    });
    state.on_select({
        let shell = Arc::clone(shell);
        move |section| {
            // The privacy screen is a part of the shell, not a routed destination.
            let Some(feature) = features::by_section(section) else {
                shell.ui(move |state| state.set_section(section));
                return;
            };
            if feature.flagged && !shell.services.capabilities.is_enabled(feature.id) {
                return;
            }
            if shell.services.router.reset_to(Route::new(feature.route)) {
                shell.open(section);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_in_errors_map_to_login_messages_and_cancel_shows_none() {
        assert_eq!(sign_in_error(&OidcError::Cancelled), SignInError::NoError);
        assert_eq!(sign_in_error(&OidcError::TimedOut), SignInError::Timeout);
        assert_eq!(
            sign_in_error(&OidcError::Keychain("x".into())),
            SignInError::Keychain
        );
        assert_eq!(
            sign_in_error(&OidcError::Unavailable("x".into())),
            SignInError::Unreachable
        );
        assert_eq!(
            sign_in_error(&OidcError::Security("x".into())),
            SignInError::Failed
        );
    }
}
