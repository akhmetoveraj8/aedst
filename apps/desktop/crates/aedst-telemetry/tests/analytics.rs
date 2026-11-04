#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Analytics: consent gating (zero transport calls when off), allowlist, anonymous id.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use aedst_telemetry::{
    Analytics, AnalyticsSink, Consent, EventCatalog, EventTransport, MemoryConsentStore, NoopSink,
    OutgoingEvent,
};
use serde_json::{Map, Value, json};

#[derive(Default)]
struct Recorder(Mutex<Vec<OutgoingEvent>>);

impl Recorder {
    fn events(&self) -> Vec<OutgoingEvent> {
        self.0.lock().unwrap().clone()
    }
}

impl EventTransport for Recorder {
    fn send(&self, event: OutgoingEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn props(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

struct Fixture {
    consent: Arc<Consent>,
    recorder: Arc<Recorder>,
    analytics: Analytics,
}

async fn fixture() -> Fixture {
    let consent = Arc::new(Consent::load(Box::new(MemoryConsentStore::default())).await);
    let recorder = Arc::new(Recorder::default());
    let analytics = Analytics::new(EventCatalog::desktop(), &consent, recorder.clone());
    Fixture {
        consent,
        recorder,
        analytics,
    }
}

async fn opted_in() -> Fixture {
    let f = fixture().await;
    f.consent.set_analytics(true).await.unwrap();
    f.analytics.sync_install_id(&f.consent).await.unwrap();
    f
}

#[test]
fn the_catalog_is_the_desktop_part_of_the_contract() {
    let catalog = EventCatalog::desktop();
    assert!(!catalog.is_empty(), "the embedded contract must parse");
    for name in [
        "task_created",
        "search_performed",
        "media_uploaded",
        "logout",
        "login_success",
    ] {
        assert!(catalog.allows(name), "{name} exists on desktop");
    }
    // Web-only and Apple-only events are not desktop events.
    for name in [
        "web_vital",
        "task_reopened",
        "pwa_install_prompt",
        "made_up_event",
    ] {
        assert!(!catalog.allows(name), "{name} must not be accepted");
    }
}

#[tokio::test]
async fn consent_off_means_no_transport_call_at_all() {
    let f = fixture().await;
    // Even with an id on disk and a perfectly valid event.
    f.analytics
        .track("task_created", &props(json!({"priority": "high"})));
    f.analytics.sync_install_id(&f.consent).await.unwrap();
    f.analytics
        .track("task_created", &props(json!({"priority": "high"})));
    f.analytics.track("task_completed", &Map::new());
    assert!(f.recorder.events().is_empty());
}

#[tokio::test]
async fn crash_consent_alone_does_not_enable_analytics() {
    let f = fixture().await;
    f.consent.set_crash(true).await.unwrap();
    f.analytics.sync_install_id(&f.consent).await.unwrap();
    f.analytics.track("task_completed", &Map::new());
    assert!(f.recorder.events().is_empty());
}

#[tokio::test]
async fn accepted_events_carry_only_documented_typed_properties() {
    let f = opted_in().await;
    f.analytics.track(
        "task_created",
        &props(json!({
            "priority": "high",
            "has_due_date": true,
            "title": "buy milk for jane@example.com",
            "notes": 5
        })),
    );
    let events = f.recorder.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name, "task_created");
    assert_eq!(
        events[0].properties,
        props(json!({"priority": "high", "has_due_date": true}))
    );
}

#[tokio::test]
async fn free_text_and_wrong_types_are_dropped_but_the_event_stays() {
    let f = opted_in().await;
    f.analytics.track(
        "task_created",
        &props(json!({"priority": "buy milk and call mom", "has_due_date": "yes"})),
    );
    f.analytics.track(
        "search_performed",
        &props(json!({"query_length": 4, "results": "many"})),
    );
    f.analytics.track(
        "login_failure",
        &props(json!({"method": "fax", "reason": "a@b.com"})),
    );
    f.analytics
        .track("login_success", &props(json!({"method": "browser"})));
    let events = f.recorder.events();
    assert_eq!(events.len(), 4);
    assert!(events[0].properties.is_empty());
    assert_eq!(events[1].properties, props(json!({"query_length": 4})));
    assert!(
        events[2].properties.is_empty(),
        "enum outside the list and an e-mail are dropped"
    );
    assert_eq!(events[3].properties, props(json!({"method": "browser"})));
}

#[tokio::test]
async fn unlisted_events_are_dropped() {
    let f = opted_in().await;
    for name in [
        "web_vital",
        "task_reopened",
        "unknown",
        "",
        "task_created ",
        "TASK_CREATED",
    ] {
        f.analytics.track(name, &Map::new());
    }
    assert!(f.recorder.events().is_empty());
}

#[tokio::test]
async fn the_id_is_an_anonymous_uuid_v4_that_is_stable_until_withdrawal() {
    let f = opted_in().await;
    f.analytics.track("logout", &Map::new());
    f.analytics.track("logout", &Map::new());
    let events = f.recorder.events();
    let first = events[0].distinct_id.clone();
    assert_eq!(first, events[1].distinct_id);
    let parsed = uuid::Uuid::parse_str(&first).unwrap();
    assert_eq!(parsed.get_version_num(), 4);

    // Withdraw: the id is forgotten; opting in again starts a new, unlinked identity.
    f.consent.set_analytics(false).await.unwrap();
    f.analytics.sync_install_id(&f.consent).await.unwrap();
    f.analytics.track("logout", &Map::new());
    assert_eq!(f.recorder.events().len(), 2, "nothing after withdrawal");

    f.consent.set_analytics(true).await.unwrap();
    f.analytics.sync_install_id(&f.consent).await.unwrap();
    f.analytics.track("logout", &Map::new());
    let events = f.recorder.events();
    assert_eq!(events.len(), 3);
    assert_ne!(events[2].distinct_id, first);
}

#[tokio::test]
async fn withdrawal_applies_without_a_restart_or_a_sync() {
    let f = opted_in().await;
    f.analytics.track("logout", &Map::new());
    f.consent.set_analytics(false).await.unwrap();
    f.analytics.track("logout", &Map::new());
    assert_eq!(f.recorder.events().len(), 1);
}

#[tokio::test]
async fn events_wait_for_the_install_id() {
    let f = fixture().await;
    f.consent.set_analytics(true).await.unwrap();
    f.analytics.track("logout", &Map::new());
    assert!(f.recorder.events().is_empty(), "no id yet, no event");
}

#[tokio::test]
async fn background_sync_creates_the_id_after_opt_in() {
    let f = fixture().await;
    let analytics = Arc::new(f.analytics);
    tokio::spawn(analytics.clone().run_install_id_sync(f.consent.clone()));
    f.consent.set_analytics(true).await.unwrap();
    for _ in 0..100 {
        analytics.track("logout", &Map::new());
        if !f.recorder.events().is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the install id was never created");
}

#[test]
fn the_noop_sink_accepts_anything() {
    NoopSink.track("task_created", &props(json!({"priority": "high"})));
}
