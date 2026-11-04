//! The service: retry with backoff and one extra run for a trigger that arrives mid-run.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use aedst_outbox::{Delivery, Handlers, OutboxHandler, OutboxItem, OutboxService, SqliteOutbox};
use aedst_persistence::Database;
use futures::future::BoxFuture;

/// Fails `failures` times with a retryable error, then delivers; counts every attempt.
struct Flaky {
    failures: usize,
    calls: AtomicUsize,
}

impl OutboxHandler for Flaky {
    fn deliver<'a>(&'a self, _: &'a OutboxItem) -> BoxFuture<'a, Delivery> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        let outcome = if call < self.failures {
            Delivery::Retryable
        } else {
            Delivery::Delivered
        };
        Box::pin(async move {
            tokio::task::yield_now().await;
            outcome
        })
    }
}

async fn settle() {
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
}

#[tokio::test(start_paused = true)]
async fn a_retryable_failure_is_retried_after_the_backoff() {
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    let handler = Arc::new(Flaky {
        failures: 2,
        calls: AtomicUsize::new(0),
    });
    let mut handlers = Handlers::default();
    handlers.register("task.create", handler.clone());
    queue.enqueue("a", "task.create", b"{}").await.unwrap();
    let service = OutboxService::new(queue.clone(), handlers);

    service.trigger();
    settle().await;
    assert_eq!(
        handler.calls.load(Ordering::SeqCst),
        1,
        "first attempt, then it waits"
    );

    tokio::time::advance(Duration::from_secs(3)).await; // first backoff is 1-2 s
    settle().await;
    assert_eq!(handler.calls.load(Ordering::SeqCst), 2);

    tokio::time::advance(Duration::from_secs(5)).await; // second backoff is 2-4 s
    settle().await;
    assert_eq!(handler.calls.load(Ordering::SeqCst), 3);
    assert_eq!(service.pending_count().await.unwrap(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_trigger_during_a_run_schedules_exactly_one_more_run() {
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    let handler = Arc::new(Flaky {
        failures: 0,
        calls: AtomicUsize::new(0),
    });
    let mut handlers = Handlers::default();
    handlers.register("task.create", handler.clone());
    queue.enqueue("a", "task.create", b"{}").await.unwrap();
    let service = OutboxService::new(queue.clone(), handlers);

    service.trigger();
    service.trigger(); // lands while the first run is active
    service.trigger();
    settle().await;
    queue.enqueue("b", "task.create", b"{}").await.unwrap();
    service.trigger();
    settle().await;

    assert_eq!(
        handler.calls.load(Ordering::SeqCst),
        2,
        "each item delivered exactly once"
    );
    assert_eq!(service.pending_count().await.unwrap(), 0);
}
