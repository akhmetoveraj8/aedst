#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Crash reporting: init is refused without DSN or consent; events and breadcrumbs are scrubbed;
//! only reportable error kinds are sent. Uses Sentry's in-memory test transport (no network).

use aedst_common::ErrorKind;
use aedst_telemetry::crash::{build_options, report_error_kind, scrub_breadcrumb, scrub_event};
use aedst_telemetry::{
    Consent, CrashConfig, CrashReporter, CrashStatus, Environment, MemoryConsentStore,
};
use sentry::protocol::{Breadcrumb, Event, Level, Value};

const DSN: &str = "https://public@o0.ingest.example.invalid/1";

fn config(dsn: Option<&str>) -> CrashConfig {
    CrashConfig {
        dsn: dsn.map(str::to_owned),
        version: "1.4.0".into(),
        environment: Environment::Production,
    }
}

async fn consent(crash: bool) -> Consent {
    let consent = Consent::load(Box::new(MemoryConsentStore::default())).await;
    if crash {
        consent.set_crash(true).await.unwrap();
    }
    consent
}

#[tokio::test]
async fn init_is_refused_without_consent() {
    let consent = consent(false).await;
    let reporter = CrashReporter::new(config(Some(DSN)), consent.subscribe());
    assert_eq!(reporter.apply().unwrap(), CrashStatus::NoConsent);
    assert!(!reporter.is_active());
}

#[tokio::test]
async fn init_is_refused_without_a_dsn() {
    let consent = consent(true).await;
    for dsn in [None, Some(""), Some("   ")] {
        let reporter = CrashReporter::new(config(dsn), consent.subscribe());
        assert_eq!(reporter.apply().unwrap(), CrashStatus::NoDsn);
        assert!(!reporter.is_active());
    }
}

#[tokio::test]
async fn a_malformed_dsn_is_an_error_not_a_panic() {
    let consent = consent(true).await;
    let reporter = CrashReporter::new(config(Some("not a dsn")), consent.subscribe());
    assert!(reporter.apply().is_err());
    assert!(!reporter.is_active());
}

#[test]
fn environment_and_release() {
    assert_eq!(
        Environment::for_version("1.4.0", false),
        Environment::Production
    );
    assert_eq!(
        Environment::for_version("1.4.0-beta.2", false),
        Environment::Beta
    );
    assert_eq!(Environment::for_version("1.4.0", true), Environment::Ci);
    assert_eq!(Environment::Production.as_str(), "production");
    assert_eq!(Environment::Beta.as_str(), "beta");
    assert_eq!(Environment::Ci.as_str(), "ci");
    assert_eq!(config(None).release(), "aedst-desktop@1.4.0");
}

#[tokio::test]
async fn options_are_strict() {
    let consent = consent(true).await;
    let options = build_options(&config(Some(DSN)), consent.subscribe()).unwrap();
    assert_eq!(options.release.as_deref(), Some("aedst-desktop@1.4.0"));
    assert_eq!(options.environment.as_deref(), Some("production"));
    assert!(!options.send_default_pii);
    assert!(!options.attach_stacktrace);
    assert!(options.before_send.is_some() && options.before_breadcrumb.is_some());
    assert!(options.dsn.is_some());
    assert_ne!(
        options.server_name.as_deref(),
        None,
        "no host name fallback"
    );
}

fn sensitive_event() -> Event<'static> {
    let mut event = Event {
        message: Some("failed for jane@example.com at C:\\Users\\Alice\\x.db".into()),
        level: Level::Error,
        server_name: Some("ALICE-PC".into()),
        ..Event::default()
    };
    event.user = Some(sentry::protocol::User {
        email: Some("jane@example.com".into()),
        ip_address: Some(sentry::protocol::IpAddress::Auto),
        ..Default::default()
    });
    event
        .extra
        .insert("url".into(), Value::String("https://h/x?sig=abc".into()));
    event
        .extra
        .insert("password".into(), Value::String("hunter2".into()));
    event.tags.insert("path".into(), "/home/bob/x".into());
    event.breadcrumbs.values.push(Breadcrumb {
        message: Some("GET https://h/y?token=zzz".into()),
        ..Breadcrumb::default()
    });
    event
}

#[test]
fn scrub_event_removes_everything_identifying() {
    let event = scrub_event(sensitive_event());
    let dump = format!("{event:?}");
    for leaked in [
        "jane@example.com",
        "Alice",
        "ALICE-PC",
        "sig=abc",
        "hunter2",
        "bob",
        "token=zzz",
    ] {
        assert!(!dump.contains(leaked), "{leaked} survived: {dump}");
    }
    assert!(event.user.is_none() && event.server_name.is_none());
}

#[test]
fn scrub_breadcrumb_scrubs_message_and_data() {
    let mut crumb = Breadcrumb {
        message: Some("mail a@b.com".into()),
        ..Breadcrumb::default()
    };
    crumb
        .data
        .insert("token".into(), Value::String("abc".into()));
    crumb
        .data
        .insert("url".into(), Value::String("https://h/p?q=1".into()));
    let crumb = scrub_breadcrumb(crumb);
    assert_eq!(crumb.message.as_deref(), Some("mail <email>"));
    assert_eq!(crumb.data["token"], "<redacted>");
    assert_eq!(crumb.data["url"], "https://h/p?<redacted>");
}

#[tokio::test]
async fn the_client_scrubs_events_and_breadcrumbs_and_honours_consent() {
    let on = consent(true).await;
    let options = build_options(&config(Some(DSN)), on.subscribe()).unwrap();
    let events = sentry::test::with_captured_events_options(
        || {
            sentry::add_breadcrumb(Breadcrumb {
                message: Some("opened https://h/x?sig=1 for jane@example.com".into()),
                ..Breadcrumb::default()
            });
            sentry::capture_event(sensitive_event());
        },
        options,
    );
    assert_eq!(events.len(), 1);
    let dump = format!("{:?}", events[0]);
    for leaked in ["jane@example.com", "Alice", "sig=1", "hunter2"] {
        assert!(!dump.contains(leaked), "{leaked} survived: {dump}");
    }
    assert_eq!(events[0].release.as_deref(), Some("aedst-desktop@1.4.0"));
    assert!(events[0].user.is_none());

    // Consent withdrawn: the very next event is dropped by before_send, no restart needed.
    let off = consent(false).await;
    let options = build_options(&config(Some(DSN)), off.subscribe()).unwrap();
    let events = sentry::test::with_captured_events_options(
        || {
            sentry::capture_event(sensitive_event());
        },
        options,
    );
    assert!(events.is_empty());
}

#[tokio::test]
async fn only_reportable_kinds_become_events() {
    let on = consent(true).await;
    let options = build_options(&config(Some(DSN)), on.subscribe()).unwrap();
    let all = [
        ErrorKind::Unauthenticated,
        ErrorKind::Forbidden,
        ErrorKind::NotFound,
        ErrorKind::InvalidInput,
        ErrorKind::Conflict,
        ErrorKind::RateLimited,
        ErrorKind::Unavailable,
        ErrorKind::Offline,
        ErrorKind::Timeout,
        ErrorKind::Cancelled,
        ErrorKind::UpgradeRequired,
        ErrorKind::Storage,
        ErrorKind::Unknown,
    ];
    let events = sentry::test::with_captured_events_options(
        || {
            for kind in all {
                assert_eq!(
                    report_error_kind(kind, "load tasks for jane@example.com"),
                    kind.reportable()
                );
            }
        },
        options,
    );
    let expected = all.iter().filter(|k| k.reportable()).count();
    assert_eq!(expected, 2, "Storage and Unknown today");
    assert_eq!(events.len(), expected);
    for event in &events {
        assert_eq!(event.message.as_deref(), Some("load tasks for <email>"));
        assert!(event.tags.contains_key("error_kind"));
    }
    assert!(
        !events
            .iter()
            .any(|e| e.tags.get("error_kind").is_some_and(|k| k == "Cancelled"))
    );
}
