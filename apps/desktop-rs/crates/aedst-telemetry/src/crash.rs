//! Crash and error reports (Sentry), stricter than the web app.
//!
//! * The client exists only when a DSN is configured AND crash consent is on; withdrawing consent
//!   drops it at once, and `before_send` re-checks consent for events already in flight.
//! * `release = aedst-desktop@<version>`; environment `production`, `beta` or `ci`.
//! * `send_default_pii = false`, no performance tracing, no sessions, no logs, no metrics.
//! * `before_send` and `before_breadcrumb` run the one scrubber over everything.
//! * Only [`ErrorKind::reportable`] kinds become events (never the cancelled or expected ones).
//!
//! # What this build cannot capture
//!
//! Only Rust panics (the `panic` integration) and explicit reports. The `sentry` `minidump`
//! feature (an out-of-process crash handler) is NOT enabled, because a minidump holds process memory
//! that cannot be scrubbed; a native crash (access violation, stack overflow, abort) is therefore not
//! reported at all. The C++ app (crashpad) captured those; see `docs/adr/0001` for the decision.

use std::borrow::Cow;
use std::sync::{Arc, Mutex, PoisonError};

use aedst_common::ErrorKind;
use sentry::protocol::{Breadcrumb, Context, DebugImage, Event, Level};
use sentry::{ClientInitGuard, ClientOptions};
use tokio::sync::watch;

use crate::consent::ConsentState;
use crate::scrub::{REDACTED, is_sensitive_key, scrub_json, scrub_pii};

/// Deployment channel, derived from the build and the version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Environment {
    /// A stable release tag.
    Production,
    /// A pre-release tag (`1.2.3-beta.1`).
    Beta,
    /// Anything built by CI that is not a tag.
    Ci,
}

impl Environment {
    /// `ci` wins; otherwise a version with a pre-release part is `beta`.
    #[must_use]
    pub fn for_version(version: &str, ci: bool) -> Self {
        if ci {
            Self::Ci
        } else if version.contains('-') {
            Self::Beta
        } else {
            Self::Production
        }
    }

    /// The value sent to Sentry.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Production => "production",
            Self::Beta => "beta",
            Self::Ci => "ci",
        }
    }
}

/// Static configuration of the crash reporter.
#[derive(Clone, Debug)]
pub struct CrashConfig {
    /// The DSN; `None` or blank disables reporting.
    pub dsn: Option<String>,
    /// The app version (`CARGO_PKG_VERSION` of the binary).
    pub version: String,
    /// The channel.
    pub environment: Environment,
}

impl CrashConfig {
    /// `aedst-desktop@<version>`, the value the symbol upload in CI uses too.
    #[must_use]
    pub fn release(&self) -> String {
        format!("aedst-desktop@{}", self.version)
    }
}

/// Why reporting is (not) running.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CrashStatus {
    /// The client is initialised.
    Active,
    /// No DSN configured.
    NoDsn,
    /// The user has not allowed crash reports.
    NoConsent,
}

/// The DSN could not be used.
#[derive(Debug, thiserror::Error)]
#[error("invalid Sentry DSN")]
pub struct InvalidDsn;

/// Builds the Sentry options; pure, so tests can inspect them and run them on a private hub.
///
/// # Errors
/// The DSN does not parse. A missing DSN is not an error: the options carry no DSN.
pub fn build_options(
    config: &CrashConfig,
    consent: watch::Receiver<ConsentState>,
) -> Result<ClientOptions, InvalidDsn> {
    let dsn = match config.dsn.as_deref().map(str::trim) {
        Some(text) if !text.is_empty() => Some(text.parse().map_err(|_| InvalidDsn)?),
        _ => None,
    };
    let mut options = ClientOptions::default();
    options.dsn = dsn;
    options.release = Some(Cow::Owned(config.release()));
    options.environment = Some(Cow::Borrowed(config.environment.as_str()));
    options.send_default_pii = false;
    options.attach_stacktrace = false;
    options.max_breadcrumbs = 50;
    // The contexts integration would otherwise put the machine's host name here.
    options.server_name = Some(Cow::Borrowed("aedst-desktop"));
    options.before_send = Some(Arc::new(move |event| {
        if !consent.borrow().crash {
            return None;
        }
        Some(scrub_event(event))
    }));
    options.before_breadcrumb = Some(Arc::new(|crumb| Some(scrub_breadcrumb(crumb))));
    Ok(options)
}

/// Owns the Sentry client for the process.
pub struct CrashReporter {
    config: CrashConfig,
    consent: watch::Receiver<ConsentState>,
    guard: Mutex<Option<ClientInitGuard>>,
}

impl CrashReporter {
    /// Creates a reporter that has not initialised anything yet.
    #[must_use]
    pub fn new(config: CrashConfig, consent: watch::Receiver<ConsentState>) -> Self {
        Self {
            config,
            consent,
            guard: Mutex::new(None),
        }
    }

    /// Brings the client in line with the current consent: initialises it when crash consent is on
    /// and a DSN exists, drops it otherwise. Call at start-up and on every consent change (see
    /// [`CrashReporter::run`]).
    ///
    /// # Errors
    /// The DSN is malformed.
    pub fn apply(&self) -> Result<CrashStatus, InvalidDsn> {
        let consent = self.consent.borrow().crash;
        let mut guard = self.guard.lock().unwrap_or_else(PoisonError::into_inner);
        if !consent {
            // Dropping the guard closes the client; nothing more is sent.
            *guard = None;
            return Ok(CrashStatus::NoConsent);
        }
        let options = build_options(&self.config, self.consent.clone())?;
        if options.dsn.is_none() {
            *guard = None;
            return Ok(CrashStatus::NoDsn);
        }
        if guard.is_none() {
            *guard = Some(sentry::init(options));
        }
        Ok(CrashStatus::Active)
    }

    /// Applies consent now and after every change, until the consent source is dropped.
    pub async fn run(self: Arc<Self>) {
        let mut changes = self.consent.clone();
        loop {
            if self.apply().is_err() {
                tracing::warn!("crash reporting disabled: the configured DSN is invalid");
            }
            if changes.changed().await.is_err() {
                return;
            }
        }
    }

    /// Whether a client is currently initialised.
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.guard
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }
}

/// Reports `kind` with a scrubbed `context` label when it is a reportable kind (a bug or a storage
/// fault). Expected states (offline, cancelled, forbidden, ...) are never sent. Returns whether an
/// event was handed to the current Sentry hub; without a client the hub drops it silently.
pub fn report_error_kind(kind: ErrorKind, context: &str) -> bool {
    if !kind.reportable() {
        return false;
    }
    let mut tags = std::collections::BTreeMap::new();
    tags.insert("error_kind".to_owned(), format!("{kind:?}"));
    sentry::capture_event(Event {
        message: Some(scrub_pii(context)),
        level: Level::Error,
        tags,
        ..Event::default()
    });
    true
}

/// Scrubs every free-text part of an event and drops identifying fields.
#[must_use]
pub fn scrub_event(mut event: Event<'static>) -> Event<'static> {
    event.server_name = None;
    event.user = None;
    event.request = None;
    event.message = event.message.map(|m| scrub_pii(&m));
    event.transaction = event.transaction.map(|t| scrub_pii(&t));
    event.culprit = event.culprit.map(|c| scrub_pii(&c));
    if let Some(entry) = event.logentry.as_mut() {
        entry.message = scrub_pii(&entry.message);
        entry.params.iter_mut().for_each(scrub_json);
    }
    for exception in &mut event.exception.values {
        exception.value = exception.value.as_deref().map(scrub_pii);
        exception.stacktrace.iter_mut().for_each(scrub_stacktrace);
    }
    for thread in &mut event.threads.values {
        thread.name = thread.name.as_deref().map(scrub_pii);
        thread.stacktrace.iter_mut().for_each(scrub_stacktrace);
    }
    event.stacktrace.iter_mut().for_each(scrub_stacktrace);
    for crumb in &mut event.breadcrumbs.values {
        *crumb = scrub_breadcrumb(std::mem::take(crumb));
    }
    scrub_map(&mut event.extra);
    for value in event.tags.values_mut() {
        *value = scrub_pii(value);
    }
    for context in event.contexts.values_mut() {
        if let Context::Device(device) = context {
            device.name = None;
        }
    }
    for image in &mut event.debug_meta.to_mut().images {
        if let DebugImage::Symbolic(image) = image {
            image.name = scrub_pii(&image.name);
            image.debug_file = image.debug_file.as_deref().map(scrub_pii);
        }
    }
    event
}

fn scrub_stacktrace(stacktrace: &mut sentry::protocol::Stacktrace) {
    for frame in &mut stacktrace.frames {
        frame.filename = frame.filename.as_deref().map(scrub_pii);
        frame.abs_path = frame.abs_path.as_deref().map(scrub_pii);
        // Local variables are never needed for triage and may hold anything.
        frame.vars.clear();
    }
}

/// Scrubs a breadcrumb at the time it is recorded.
#[must_use]
pub fn scrub_breadcrumb(mut crumb: Breadcrumb) -> Breadcrumb {
    crumb.message = crumb.message.as_deref().map(scrub_pii);
    scrub_map(&mut crumb.data);
    crumb
}

/// Scrubs a map of JSON values, replacing the value of credential-like keys.
fn scrub_map(map: &mut std::collections::BTreeMap<String, serde_json::Value>) {
    for (key, value) in map.iter_mut() {
        if is_sensitive_key(key) {
            *value = serde_json::Value::String(REDACTED.to_owned());
        } else {
            scrub_json(value);
        }
    }
}
