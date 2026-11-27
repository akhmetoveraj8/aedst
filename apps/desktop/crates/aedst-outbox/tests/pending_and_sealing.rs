//! The pending-count stream, delivery on enqueue, and payload encryption at rest.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use aedst_outbox::{
    Delivery, Handlers, OutboxHandler, OutboxItem, OutboxService, SqliteOutbox, Status,
};
use aedst_persistence::{DataKey, Database, Sealer};
use futures::future::BoxFuture;

/// Delivers every item and counts the calls.
#[derive(Default)]
struct Counting {
    calls: AtomicUsize,
}

impl OutboxHandler for Counting {
    fn deliver<'a>(&'a self, _: &'a OutboxItem) -> BoxFuture<'a, Delivery> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Delivery::Delivered })
    }
}

async fn settle() {
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
}

fn sealer() -> Arc<Sealer> {
    Arc::new(Sealer::new(DataKey::generate()))
}

#[tokio::test]
async fn the_pending_count_follows_enqueue_delivery_park_and_purge() {
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    let pending = queue.subscribe_pending();
    assert_eq!(*pending.borrow(), 0);

    queue.enqueue("a", "task.create", b"{}").await.unwrap();
    queue.enqueue("b", "task.create", b"{}").await.unwrap();
    queue.enqueue("c", "task.create", b"{}").await.unwrap();
    assert!(!queue.enqueue("c", "task.create", b"{}").await.unwrap(), "double tap");
    assert_eq!(*pending.borrow(), 3);

    queue.remove("a").await.unwrap();
    assert_eq!(*pending.borrow(), 2);
    queue.park("b", "permanent").await.unwrap();
    assert_eq!(*pending.borrow(), 1, "a parked item is not pending");
    queue.purge().await.unwrap();
    assert_eq!(*pending.borrow(), 0);
}

#[tokio::test]
async fn refresh_pending_loads_what_an_earlier_run_left() {
    let db = Database::open_in_memory().unwrap();
    SqliteOutbox::new(db.clone())
        .enqueue("a", "task.create", b"{}")
        .await
        .unwrap();
    let queue = SqliteOutbox::new(db); // a fresh handle, as after a restart
    assert_eq!(*queue.subscribe_pending().borrow(), 0);
    assert_eq!(queue.refresh_pending().await.unwrap(), 1);
    assert_eq!(*queue.subscribe_pending().borrow(), 1);
}

#[tokio::test]
async fn an_enqueue_is_delivered_at_once_without_a_manual_trigger() {
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    let handler = Arc::new(Counting::default());
    let mut handlers = Handlers::default();
    handlers.register("task.create", handler.clone());
    let service = OutboxService::new(queue.clone(), handlers);
    let watcher = tokio::spawn(Arc::clone(&service).trigger_on_enqueue());
    settle().await;

    let mut pending = service.subscribe_pending();
    queue.enqueue("a", "task.create", b"{}").await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), pending.wait_for(|count| *count == 0))
        .await
        .expect("delivered without a trigger")
        .unwrap();

    assert_eq!(handler.calls.load(Ordering::SeqCst), 1);
    assert_eq!(service.pending_count().await.unwrap(), 0);
    assert_eq!(*service.subscribe_pending().borrow(), 0);
    watcher.abort();
}

#[tokio::test]
async fn a_sealed_queue_keeps_payloads_encrypted_and_hands_them_out_decrypted() {
    let db = Database::open_in_memory().unwrap();
    let queue = SqliteOutbox::sealed(db.clone(), sealer());
    queue
        .enqueue("a", "task.create", b"{\"title\":\"buy milk\"}")
        .await
        .unwrap();

    let item = queue.next_pending().await.unwrap().unwrap();
    assert_eq!(item.payload, b"{\"title\":\"buy milk\"}");
    assert_eq!(queue.all().await.unwrap()[0].payload, item.payload);

    let raw = SqliteOutbox::new(db).all().await.unwrap();
    assert!(
        !raw[0].payload.windows(8).any(|w| w == b"buy milk"),
        "the payload is stored in the clear"
    );
}

#[tokio::test]
async fn a_planted_plaintext_item_is_parked_never_delivered() {
    let db = Database::open_in_memory().unwrap();
    // Someone with write access to the file adds an unsealed write.
    SqliteOutbox::new(db.clone())
        .enqueue("planted", "task.create", b"{}")
        .await
        .unwrap();
    let next = SqliteOutbox::sealed(db.clone(), sealer())
        .next_pending()
        .await
        .unwrap();
    assert!(next.is_none(), "an unsealed payload must not be delivered");
    let item = SqliteOutbox::new(db).all().await.unwrap().remove(0);
    assert_eq!(item.status, Status::Failed);
}

#[tokio::test]
async fn an_item_sealed_with_a_lost_key_is_parked_and_does_not_block_the_queue() {
    let db = Database::open_in_memory().unwrap();
    SqliteOutbox::sealed(db.clone(), sealer())
        .enqueue("lost", "task.create", b"{}")
        .await
        .unwrap();
    let queue = SqliteOutbox::sealed(db.clone(), sealer()); // a new key: the old one is gone
    queue.enqueue("new", "task.create", b"{}").await.unwrap();

    let next = queue.next_pending().await.unwrap().unwrap();
    assert_eq!(next.id, "new");
    let parked: Vec<_> = SqliteOutbox::new(db)
        .all()
        .await
        .unwrap()
        .into_iter()
        .filter(|item| item.status == Status::Failed)
        .map(|item| item.id)
        .collect();
    assert_eq!(parked, ["lost"]);
}
