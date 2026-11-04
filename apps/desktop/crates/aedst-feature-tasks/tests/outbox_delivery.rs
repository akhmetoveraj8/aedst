//! Queued Tasks writes through the REAL outbox queue and drainer, with a scripted repository.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::sync::Arc;

use aedst_common::ErrorKind;
use aedst_feature_tasks::{
    data::{OutboxPendingWrites, register_handlers},
    domain::{NewTask, PendingWrites, TaskPriority, TaskRepository, TaskStatus},
};
use aedst_outbox::{Handlers, RunResult, SqliteOutbox, Status, run};
use aedst_persistence::Database;
use support::{FakeRepo, task};

struct World {
    repo: Arc<FakeRepo>,
    queue: SqliteOutbox,
    writes: OutboxPendingWrites,
    handlers: Handlers,
}

fn world() -> World {
    let repo = Arc::new(FakeRepo::default());
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    let mut handlers = Handlers::default();
    let as_repository: Arc<dyn TaskRepository> = repo.clone();
    register_handlers(&mut handlers, &as_repository);
    World {
        repo,
        writes: OutboxPendingWrites::new(queue.clone()),
        queue,
        handlers,
    }
}

fn new_task() -> NewTask {
    NewTask::validate(
        "buy milk",
        "2 litres",
        Some(TaskPriority::High),
        Some(86_400),
    )
    .unwrap()
}

#[tokio::test]
async fn a_queued_create_is_delivered_with_its_item_id_as_the_idempotency_key() {
    let w = world();
    w.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Ok(task("srv-1", "buy milk", TaskStatus::Todo)));
    w.writes.enqueue_create("k-42", &new_task()).await.unwrap();

    assert_eq!(
        run(&w.queue, &w.handlers).await.unwrap(),
        RunResult::Complete
    );

    assert_eq!(
        w.repo.keys.lock().unwrap().clone(),
        [("create".to_owned(), "k-42".to_owned())]
    );
    assert!(
        w.queue.all().await.unwrap().is_empty(),
        "delivered items are removed"
    );
}

#[tokio::test]
async fn a_queued_complete_is_delivered_and_a_reopen_too() {
    let w = world();
    w.repo.set_dones.lock().unwrap().extend([
        Ok(task("a", "t", TaskStatus::Done)),
        Ok(task("a", "t", TaskStatus::Todo)),
    ]);
    w.writes.enqueue_set_done("k1", "a", true).await.unwrap();
    w.writes.enqueue_set_done("k2", "a", false).await.unwrap();

    assert_eq!(
        run(&w.queue, &w.handlers).await.unwrap(),
        RunResult::Complete
    );

    let sent = w.repo.keys.lock().unwrap().clone();
    assert_eq!(
        sent,
        [
            ("set_done:a:true".to_owned(), "k1".to_owned()),
            ("set_done:a:false".to_owned(), "k2".to_owned())
        ],
        "delivered in creation order"
    );
}

#[tokio::test]
async fn the_outcome_follows_the_error_kind_verdict() {
    // retry -> the run stops and counts an attempt
    let w = world();
    w.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Offline));
    w.writes.enqueue_create("k1", &new_task()).await.unwrap();
    assert_eq!(
        run(&w.queue, &w.handlers).await.unwrap(),
        RunResult::Retry { attempts: 1 }
    );

    // permanent -> parked, the run goes on
    let w = world();
    w.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::InvalidInput));
    w.writes.enqueue_create("k1", &new_task()).await.unwrap();
    assert_eq!(
        run(&w.queue, &w.handlers).await.unwrap(),
        RunResult::Complete
    );
    assert_eq!(w.queue.all().await.unwrap()[0].status, Status::Failed);

    // blocked (signed out / upgrade required) -> stops without counting
    for kind in [ErrorKind::Unauthenticated, ErrorKind::UpgradeRequired] {
        let w = world();
        w.repo.creates.lock().unwrap().push_back(Err(kind));
        w.writes.enqueue_create("k1", &new_task()).await.unwrap();
        assert_eq!(
            run(&w.queue, &w.handlers).await.unwrap(),
            RunResult::Blocked,
            "{kind:?}"
        );
        let item = &w.queue.all().await.unwrap()[0];
        assert_eq!(
            (item.status, item.attempts),
            (Status::Pending, 0),
            "{kind:?}"
        );
    }
}

#[tokio::test]
async fn a_corrupt_payload_is_parked_instead_of_retried_forever() {
    let w = world();
    w.queue
        .enqueue("k1", aedst_feature_tasks::data::KIND_CREATE, b"not json")
        .await
        .unwrap();
    w.queue
        .enqueue("k2", aedst_feature_tasks::data::KIND_UPDATE, b"{}")
        .await
        .unwrap();

    assert_eq!(
        run(&w.queue, &w.handlers).await.unwrap(),
        RunResult::Complete
    );

    assert!(
        w.queue
            .all()
            .await
            .unwrap()
            .iter()
            .all(|i| i.status == Status::Failed)
    );
    assert!(w.repo.keys.lock().unwrap().is_empty(), "nothing was sent");
}

#[tokio::test]
async fn the_same_key_enqueued_twice_is_one_item() {
    let w = world();
    w.writes.enqueue_create("k1", &new_task()).await.unwrap();
    w.writes.enqueue_create("k1", &new_task()).await.unwrap();
    assert_eq!(w.queue.all().await.unwrap().len(), 1);
}
