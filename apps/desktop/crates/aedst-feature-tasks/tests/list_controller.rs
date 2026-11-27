//! The list view model against a scripted repository.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::sync::atomic::Ordering;

use aedst_common::ErrorKind;
use aedst_feature_tasks::{
    domain::{TaskStatus, ValidationError},
    presentation::{CreateStatus, Phase, TaskListController},
};
use support::{FakePending, page, rig, rig_with, task};
use tokio::sync::oneshot;

#[tokio::test]
async fn the_first_page_loads_and_keeps_the_total_from_that_page_only() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["a", "b"], Some("t2"), Some(3))),
        Ok(page(&["c"], None, None)),
    ]);
    let controller = TaskListController::new(rig.service.clone());

    controller.load_first().await;
    let view = controller.subscribe().borrow().clone();
    assert_eq!(
        (view.phase, view.rows.len(), view.total_count, view.has_more),
        (Phase::Ready, 2, Some(3), true)
    );

    controller.load_more().await;
    let view = controller.subscribe().borrow().clone();
    assert_eq!(
        (view.rows.len(), view.total_count, view.has_more),
        (3, Some(3), false)
    );
    let queries = rig.repo.queries.lock().unwrap().clone();
    assert_eq!(
        queries[1].page_token.as_deref(),
        Some("t2"),
        "the token is echoed back exactly"
    );
}

#[tokio::test]
async fn a_failed_first_page_shows_its_kind_and_cancelled_shows_nothing() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .extend([Err(ErrorKind::Offline), Err(ErrorKind::Cancelled)]);
    let controller = TaskListController::new(rig.service.clone());

    controller.load_first().await;
    assert_eq!(
        controller.subscribe().borrow().phase,
        Phase::Failed(ErrorKind::Offline)
    );
    controller.load_first().await;
    assert_eq!(
        controller.subscribe().borrow().phase,
        Phase::Idle,
        "user intent is not an error"
    );
}

#[tokio::test]
async fn a_slow_older_load_cannot_overwrite_a_newer_one() {
    let rig = rig();
    let (release, gate) = oneshot::channel();
    *rig.repo.gate.lock().unwrap() = Some(gate);
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["old"], None, Some(1))),
        Ok(page(&["new"], None, Some(1))),
    ]);
    let controller = TaskListController::new(rig.service.clone());

    let first = tokio::spawn({
        let controller = controller.clone();
        async move { controller.load_first().await }
    });
    tokio::task::yield_now().await;
    controller.load_first().await; // the newer load finishes first
    release.send(()).unwrap();
    first.await.unwrap();

    let view = controller.subscribe().borrow().clone();
    assert_eq!(view.rows[0].id, "new");
}

#[tokio::test]
async fn a_reload_during_load_more_does_not_block_the_next_page() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["a"], Some("t2"), None)),
        Ok(page(&["stale"], None, None)),
        Ok(page(&["a"], Some("t3"), None)),
        Ok(page(&["c"], None, None)),
    ]);
    let controller = TaskListController::new(rig.service.clone());
    controller.load_first().await;

    let (release, gate) = oneshot::channel();
    *rig.repo.gate.lock().unwrap() = Some(gate);
    let stale = tokio::spawn({
        let controller = controller.clone();
        async move { controller.load_more().await }
    });
    tokio::task::yield_now().await;
    controller.load_first().await; // the reload makes the page load above stale
    release.send(()).unwrap();
    stale.await.unwrap();

    controller.load_more().await;
    let view = controller.subscribe().borrow().clone();
    let ids: Vec<&str> = view.rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["a", "c"]);
    assert!(!view.loading_more);
    let queries = rig.repo.queries.lock().unwrap().clone();
    assert_eq!(queries[3].page_token.as_deref(), Some("t3"));
}

#[tokio::test]
async fn invalid_input_never_reaches_the_repository() {
    let rig = rig();
    let controller = TaskListController::new(rig.service.clone());

    controller.create("   ", "", "medium").await;
    assert_eq!(
        controller.subscribe().borrow().create,
        CreateStatus::Invalid(ValidationError::TitleRequired)
    );
    controller.create("ok", "", "unknown").await;
    assert_eq!(
        controller.subscribe().borrow().create,
        CreateStatus::Invalid(ValidationError::PriorityRequired)
    );
    assert!(rig.repo.keys.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_created_task_goes_on_top_and_is_counted_without_free_text() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None, Some(1))));
    rig.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Ok(task("new", "buy milk", TaskStatus::Todo)));
    let controller = TaskListController::new(rig.service.clone());
    controller.load_first().await;

    controller
        .create("buy milk", "secret details", "high")
        .await;

    let view = controller.subscribe().borrow().clone();
    assert_eq!(
        (view.rows[0].id.as_str(), view.rows.len(), view.total_count),
        ("new", 2, Some(2))
    );
    assert_eq!(view.create, CreateStatus::Idle);
    assert_eq!(
        *rig.analytics.created.lock().unwrap(),
        [("high".to_owned(), false)],
        "priority and flag only"
    );
}

#[tokio::test]
async fn offline_create_is_queued_with_the_same_key_and_shows_as_pending() {
    let rig = rig();
    rig.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Offline));
    let controller = TaskListController::new(rig.service.clone());

    controller.create("buy milk", "", "medium").await;

    let view = controller.subscribe().borrow().clone();
    assert_eq!(view.rows[0].id, "local:k1");
    assert!(view.rows[0].pending);
    assert_eq!(
        rig.repo.keys.lock().unwrap()[0].1,
        "k1",
        "the direct attempt used the key"
    );
    assert_eq!(
        *rig.pending.creates.lock().unwrap(),
        ["k1"],
        "the outbox gets the SAME key"
    );
}

#[tokio::test]
async fn a_permanent_failure_is_reported_and_not_queued() {
    let rig = rig();
    rig.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::InvalidInput));
    let controller = TaskListController::new(rig.service.clone());

    controller.create("buy milk", "", "medium").await;

    assert_eq!(
        controller.subscribe().borrow().create,
        CreateStatus::Failed(ErrorKind::InvalidInput)
    );
    assert!(rig.pending.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_enqueue_is_a_storage_error() {
    let rig = rig_with(FakePending {
        fail: true,
        ..Default::default()
    });
    rig.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Unavailable));
    let controller = TaskListController::new(rig.service.clone());

    controller.create("buy milk", "", "medium").await;

    assert_eq!(
        controller.subscribe().borrow().create,
        CreateStatus::Failed(ErrorKind::Storage)
    );
}

#[tokio::test]
async fn toggling_completes_then_reopens_and_counts_the_completion_once() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None, Some(1))));
    rig.repo.set_dones.lock().unwrap().extend([
        Ok(task("a", "task a", TaskStatus::Done)),
        Ok(task("a", "task a", TaskStatus::Todo)),
    ]);
    let controller = TaskListController::new(rig.service.clone());
    controller.load_first().await;

    controller.toggle("a").await;
    assert_eq!(
        controller.subscribe().borrow().rows[0].status,
        TaskStatus::Done
    );
    controller.toggle("a").await;
    assert_eq!(
        controller.subscribe().borrow().rows[0].status,
        TaskStatus::Todo
    );

    assert_eq!(rig.analytics.completed.load(Ordering::SeqCst), 1);
    let keys: Vec<_> = rig
        .repo
        .keys
        .lock()
        .unwrap()
        .iter()
        .map(|(op, _)| op.clone())
        .collect();
    assert_eq!(keys, ["set_done:a:true", "set_done:a:false"]);
}

#[tokio::test]
async fn an_offline_toggle_is_queued_and_the_row_flips_as_pending() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None, Some(1))));
    rig.repo
        .set_dones
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Timeout));
    let controller = TaskListController::new(rig.service.clone());
    controller.load_first().await;

    controller.toggle("a").await;

    let row = controller.subscribe().borrow().rows[0].clone();
    assert_eq!((row.status, row.pending), (TaskStatus::Done, true));
    assert_eq!(
        rig.pending.updates.lock().unwrap().clone(),
        [("k1".to_owned(), "a".to_owned(), true)]
    );
}

#[tokio::test]
async fn a_pending_local_row_cannot_be_toggled() {
    let rig = rig();
    rig.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Offline));
    let controller = TaskListController::new(rig.service.clone());
    controller.create("buy milk", "", "medium").await;

    controller.toggle("local:k1").await;

    assert_eq!(
        rig.repo.keys.lock().unwrap().len(),
        1,
        "only the create attempt, no set_done"
    );
}

#[tokio::test]
async fn pending_rows_survive_a_reload_until_the_server_confirms_them() {
    let rig = rig();
    rig.repo
        .creates
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Offline));
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None, Some(1))));
    let controller = TaskListController::new(rig.service.clone());
    controller.create("buy milk", "", "medium").await;

    controller.load_first().await;

    let ids: Vec<_> = controller
        .subscribe()
        .borrow()
        .rows
        .iter()
        .map(|r| r.id.clone())
        .collect();
    assert_eq!(ids, ["local:k1", "a"]);
}
