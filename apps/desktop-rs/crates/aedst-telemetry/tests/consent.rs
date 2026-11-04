#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Consent: both opt-ins default to OFF, are separate, persist, and apply at once.

use std::sync::Arc;

use aedst_persistence::{Database, KvStore};
use aedst_telemetry::{
    Consent, ConsentError, ConsentState, ConsentStore, KvConsentStore, MemoryConsentStore,
};
use futures::future::BoxFuture;

/// Lets two `Consent` instances (two app starts) share one store.
struct Shared(Arc<MemoryConsentStore>);

impl ConsentStore for Shared {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, ConsentError>> {
        self.0.get(key)
    }
    fn set<'a>(&'a self, key: &'a str, value: &'a [u8]) -> BoxFuture<'a, Result<(), ConsentError>> {
        self.0.set(key, value)
    }
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), ConsentError>> {
        self.0.delete(key)
    }
}

/// A store whose writes fail.
struct Broken;

impl ConsentStore for Broken {
    fn get<'a>(&'a self, _: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, ConsentError>> {
        Box::pin(async { Ok(Some(b"1".to_vec())) })
    }
    fn set<'a>(&'a self, _: &'a str, _: &'a [u8]) -> BoxFuture<'a, Result<(), ConsentError>> {
        Box::pin(async { Err(ConsentError("disk full".into())) })
    }
    fn delete<'a>(&'a self, _: &'a str) -> BoxFuture<'a, Result<(), ConsentError>> {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn both_default_to_off() {
    let consent = Consent::load(Box::new(MemoryConsentStore::default())).await;
    assert_eq!(consent.state(), ConsentState::default());
    assert!(!consent.state().crash && !consent.state().analytics);
}

#[tokio::test]
async fn the_two_opt_ins_are_independent_and_persist() {
    let store = Arc::new(MemoryConsentStore::default());
    let consent = Consent::load(Box::new(Shared(store.clone()))).await;
    consent.set_crash(true).await.unwrap();
    assert_eq!(
        consent.state(),
        ConsentState {
            crash: true,
            analytics: false
        }
    );

    let restarted = Consent::load(Box::new(Shared(store.clone()))).await;
    assert_eq!(
        restarted.state(),
        ConsentState {
            crash: true,
            analytics: false
        }
    );

    restarted.set_analytics(true).await.unwrap();
    restarted.set_crash(false).await.unwrap();
    let again = Consent::load(Box::new(Shared(store))).await;
    assert_eq!(
        again.state(),
        ConsentState {
            crash: false,
            analytics: true
        }
    );
}

#[tokio::test]
async fn changes_are_visible_to_subscribers_at_once() {
    let consent = Consent::load(Box::new(MemoryConsentStore::default())).await;
    let mut rx = consent.subscribe();
    consent.set_analytics(true).await.unwrap();
    assert!(rx.has_changed().unwrap());
    assert!(rx.borrow_and_update().analytics);
    consent.set_analytics(false).await.unwrap();
    assert!(!rx.borrow().analytics);
}

#[tokio::test]
async fn malformed_stored_values_count_as_no() {
    let store = MemoryConsentStore::default();
    store
        .set("telemetry.consent.crash", b"yes please")
        .await
        .unwrap();
    let consent = Consent::load(Box::new(store)).await;
    assert!(!consent.state().crash);
}

#[tokio::test]
async fn granting_needs_the_store_but_withdrawing_never_does() {
    let consent = Consent::load(Box::new(Broken)).await;
    // The broken store claims "1" on read, so both start on.
    assert!(consent.state().crash && consent.state().analytics);
    assert!(consent.set_crash(false).await.is_err());
    assert!(
        !consent.state().crash,
        "withdrawal applies even if it cannot be saved"
    );

    assert!(consent.set_crash(true).await.is_err());
    assert!(
        !consent.state().crash,
        "a grant that could not be saved is not applied"
    );
}

#[tokio::test]
async fn kv_adapter_round_trips() {
    let kv = KvStore::new(Database::open_in_memory().unwrap());
    let consent = Consent::load(Box::new(KvConsentStore::new(kv.clone()))).await;
    consent.set_analytics(true).await.unwrap();
    let restarted = Consent::load(Box::new(KvConsentStore::new(kv))).await;
    assert!(restarted.state().analytics);
    assert!(!restarted.state().crash);
}
