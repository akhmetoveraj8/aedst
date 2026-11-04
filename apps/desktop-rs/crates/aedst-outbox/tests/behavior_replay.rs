//! Replays `docs/contract/behavior/offline-outbox.json`, the fixture shared with every client.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use aedst_outbox::{
    Delivery, Handlers, OutboxHandler, OutboxItem, RunResult, SqliteOutbox, Status, run,
};
use aedst_persistence::Database;
use futures::future::BoxFuture;
use serde_json::Value;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../docs/contract/behavior/offline-outbox.json"
);

/// Plays back the scripted outcomes and records what it was asked to send.
#[derive(Default)]
struct Script {
    outcomes: Mutex<VecDeque<Delivery>>,
    sent: Mutex<Vec<(String, String)>>,
}

impl OutboxHandler for Script {
    fn deliver<'a>(&'a self, item: &'a OutboxItem) -> BoxFuture<'a, Delivery> {
        // The item id is the Idempotency-Key.
        self.sent
            .lock()
            .unwrap()
            .push((item.id.clone(), item.id.clone()));
        let outcome = self
            .outcomes
            .lock()
            .unwrap()
            .pop_front()
            .expect("fixture ran out of outcomes");
        Box::pin(async move { outcome })
    }
}

fn outcome(name: &str) -> Delivery {
    match name {
        "ok" => Delivery::Delivered,
        "retryable" => Delivery::Retryable,
        "permanent" => Delivery::Permanent,
        other => panic!("unknown outcome {other}"),
    }
}

async fn check_run(
    queue: &SqliteOutbox,
    handlers: &Handlers,
    script: &Script,
    step: &Value,
    run_spec: &Value,
    case: &str,
) {
    script.sent.lock().unwrap().clear();
    *script.outcomes.lock().unwrap() = run_spec["outcomes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| outcome(o.as_str().unwrap()))
        .collect();
    let result = run(queue, handlers).await.unwrap();
    let expect = &step["expect"];

    let want = expect["result"].as_str().unwrap();
    let got = match result {
        RunResult::Complete => "complete",
        RunResult::Retry { .. } => "retry",
        RunResult::Blocked => "blocked",
    };
    assert_eq!(got, want, "{case}: run result");

    if let Some(sent) = expect.get("sent") {
        let want: Vec<(String, String)> = sent
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                (
                    s["id"].as_str().unwrap().to_owned(),
                    s["idempotencyKey"].as_str().unwrap().to_owned(),
                )
            })
            .collect();
        assert_eq!(*script.sent.lock().unwrap(), want, "{case}: sent");
    }
    if let Some(queue_spec) = expect.get("queue") {
        let want: Vec<(String, Status, u32)> = queue_spec
            .as_array()
            .unwrap()
            .iter()
            .map(|q| {
                let status = if q["status"] == "failed" {
                    Status::Failed
                } else {
                    Status::Pending
                };
                (
                    q["id"].as_str().unwrap().to_owned(),
                    status,
                    u32::try_from(q["attempts"].as_u64().unwrap()).unwrap(),
                )
            })
            .collect();
        let got: Vec<_> = queue
            .all()
            .await
            .unwrap()
            .into_iter()
            .map(|i| (i.id, i.status, i.attempts))
            .collect();
        assert_eq!(got, want, "{case}: queue");
    }
}

#[tokio::test]
async fn every_case_of_the_shared_fixture_passes() {
    let fixture: Value =
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).expect("fixture")).unwrap();
    assert_eq!(fixture["maxAttempts"], aedst_outbox::MAX_ATTEMPTS);
    let cases = fixture["cases"].as_array().unwrap();
    assert!(!cases.is_empty());

    for case in cases {
        let name = case["id"].as_str().unwrap();
        let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
        let script = Arc::new(Script::default());
        let mut handlers = Handlers::default();
        for kind in fixture["knownTypes"].as_array().unwrap() {
            handlers.register(kind.as_str().unwrap(), script.clone());
        }
        for step in case["steps"].as_array().unwrap() {
            if let Some(enqueue) = step.get("enqueue") {
                queue
                    .enqueue(
                        enqueue["id"].as_str().unwrap(),
                        enqueue["type"].as_str().unwrap(),
                        b"{}",
                    )
                    .await
                    .unwrap();
            } else if let Some(run_spec) = step.get("run") {
                let repeat = step.get("repeatRun").and_then(Value::as_u64).unwrap_or(1);
                for _ in 0..repeat {
                    check_run(&queue, &handlers, &script, step, run_spec, name).await;
                }
            }
        }
    }
}

#[tokio::test]
async fn a_blocked_handler_stops_the_run_without_counting_an_attempt() {
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    let script = Arc::new(Script::default());
    script.outcomes.lock().unwrap().push_back(Delivery::Blocked);
    let mut handlers = Handlers::default();
    handlers.register("task.create", script);
    queue.enqueue("a", "task.create", b"{}").await.unwrap();

    assert_eq!(run(&queue, &handlers).await.unwrap(), RunResult::Blocked);
    let items = queue.all().await.unwrap();
    assert_eq!((items[0].status, items[0].attempts), (Status::Pending, 0));
}

#[tokio::test]
async fn a_panicking_handler_parks_its_item_and_the_run_continues() {
    struct Boom;
    impl OutboxHandler for Boom {
        fn deliver<'a>(&'a self, _: &'a OutboxItem) -> BoxFuture<'a, Delivery> {
            Box::pin(async { panic!("handler bug") })
        }
    }
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    let ok = Arc::new(Script::default());
    ok.outcomes.lock().unwrap().push_back(Delivery::Delivered);
    let mut handlers = Handlers::default();
    handlers.register("boom", Arc::new(Boom));
    handlers.register("task.update", ok);
    queue.enqueue("a", "boom", b"{}").await.unwrap();
    queue.enqueue("b", "task.update", b"{}").await.unwrap();

    assert_eq!(run(&queue, &handlers).await.unwrap(), RunResult::Complete);
    let items = queue.all().await.unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(
        (items[0].id.as_str(), items[0].status),
        ("a", Status::Failed)
    );
}

#[tokio::test]
async fn purge_removes_everything() {
    let queue = SqliteOutbox::new(Database::open_in_memory().unwrap());
    queue
        .enqueue("a", "task.create", b"secret-title")
        .await
        .unwrap();
    queue.purge().await.unwrap();
    assert!(queue.all().await.unwrap().is_empty());
}
