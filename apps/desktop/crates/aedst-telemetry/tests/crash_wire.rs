#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The real Sentry client (global hub, reqwest transport) against a local server. One test only:
//! the Sentry hub is process-global.

use aedst_telemetry::{
    Consent, CrashConfig, CrashReporter, CrashStatus, Environment, MemoryConsentStore,
};
use wiremock::matchers::any;
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nothing_is_sent_without_consent_and_the_report_is_scrubbed_with_it() {
    let server = MockServer::start().await;
    Mock::given(any())
        .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
        .mount(&server)
        .await;
    let dsn = format!("http://public@{}/1", server.address());

    let consent = Consent::load(Box::new(MemoryConsentStore::default())).await;
    let reporter = CrashReporter::new(
        CrashConfig {
            dsn: Some(dsn),
            version: "1.4.0".into(),
            environment: Environment::Ci,
        },
        consent.subscribe(),
    );

    // Consent off: no client, so capturing reaches no transport.
    assert_eq!(reporter.apply().unwrap(), CrashStatus::NoConsent);
    sentry::capture_message("before consent a@b.com", sentry::Level::Error);
    tokio::task::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(300)))
        .await
        .unwrap();
    assert!(server.received_requests().await.unwrap().is_empty());

    // Consent on: the client starts at once and the event is scrubbed.
    consent.set_crash(true).await.unwrap();
    assert_eq!(reporter.apply().unwrap(), CrashStatus::Active);
    assert!(reporter.is_active());
    sentry::capture_message(
        "failed for jane@example.com in C:\\Users\\Alice\\x",
        sentry::Level::Error,
    );
    // Withdrawing consent drops the guard, which flushes what was already accepted.
    consent.set_crash(false).await.unwrap();
    assert_eq!(reporter.apply().unwrap(), CrashStatus::NoConsent);
    assert!(!reporter.is_active());

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1, "exactly the one consented event");
    let body = String::from_utf8_lossy(&requests[0].body).into_owned();
    assert!(
        body.contains("aedst-desktop@1.4.0"),
        "release missing: {body}"
    );
    assert!(
        body.contains("\"environment\":\"ci\""),
        "environment missing: {body}"
    );
    assert!(body.contains("<email>"), "message not scrubbed: {body}");
    for leaked in ["jane@example.com", "Alice"] {
        assert!(!body.contains(leaked), "{leaked} leaked: {body}");
    }

    // After withdrawal nothing more is sent.
    sentry::capture_message("after withdrawal", sentry::Level::Error);
    tokio::task::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(300)))
        .await
        .unwrap();
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}
