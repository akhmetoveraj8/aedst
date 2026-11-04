//! The inbox view model against a scripted repository.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use aedst_common::ErrorKind;
use aedst_feature_notifications::presentation::{InboxController, Phase};
use support::{page, rig};
use tokio::sync::oneshot;

#[tokio::test]
async fn pages_load_and_the_token_is_echoed_back_exactly() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&[("a", false), ("b", true)], Some("t2"))),
        Ok(page(&[("c", false)], None)),
    ]);
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());

    inbox.load_first().await;
    let view = inbox.subscribe().borrow().clone();
    assert_eq!(
        (view.phase, view.rows.len(), view.has_more),
        (Phase::Ready, 2, true)
    );
    inbox.load_more().await;
    let view = inbox.subscribe().borrow().clone();
    assert_eq!((view.rows.len(), view.has_more), (3, false));
    let queries = rig.repo.queries.lock().unwrap().clone();
    assert_eq!(queries[0].page_token, None);
    assert_eq!(queries[1].page_token.as_deref(), Some("t2"));
}

#[tokio::test]
async fn the_filter_reloads_from_the_first_page_with_unread_only() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&[("a", false), ("b", true)], Some("t2"))),
        Ok(page(&[("a", false)], None)),
    ]);
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());
    inbox.load_first().await;
    inbox.set_unread_only(true).await;
    inbox.set_unread_only(true).await; // unchanged: no third request

    let view = inbox.subscribe().borrow().clone();
    assert_eq!(
        (view.unread_only, view.rows.len(), view.has_more),
        (true, 1, false)
    );
    let queries = rig.repo.queries.lock().unwrap().clone();
    assert_eq!(queries.len(), 2);
    assert_eq!(
        (queries[1].unread_only, queries[1].page_token.clone()),
        (true, None)
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
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());
    inbox.load_first().await;
    assert_eq!(
        inbox.subscribe().borrow().phase,
        Phase::Failed(ErrorKind::Offline)
    );
    inbox.load_first().await;
    assert_eq!(inbox.subscribe().borrow().phase, Phase::Idle);
}

#[tokio::test]
async fn a_stale_response_is_dropped() {
    let rig = rig();
    let (open, gate) = oneshot::channel();
    *rig.repo.gate.lock().unwrap() = Some(gate);
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&[("old", false)], None)),
        Ok(page(&[("new", false)], None)),
    ]);
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());

    let slow = tokio::spawn({
        let inbox = inbox.clone();
        async move { inbox.load_first().await }
    });
    tokio::task::yield_now().await;
    inbox.load_first().await; // the newer load finishes first
    open.send(()).unwrap();
    slow.await.unwrap();

    let view = inbox.subscribe().borrow().clone();
    assert_eq!(view.rows.len(), 1);
    assert_eq!(view.rows[0].id, "new");
}

#[tokio::test]
async fn opening_an_unread_row_marks_it_read_navigates_and_refreshes_the_badge() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&[("a", false)], None)));
    rig.repo.mark_reads.lock().unwrap().push_back(Ok(()));
    rig.repo.counts.lock().unwrap().push_back(Ok(4));
    rig.counter.set_local(5);
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());
    inbox.load_first().await;

    inbox.open("a").await;

    let view = inbox.subscribe().borrow().clone();
    assert!(view.rows[0].read);
    assert_eq!(view.action_error, None);
    assert_eq!(rig.counter.current(), 4); // the server's answer
    assert_eq!(
        rig.repo.marked.lock().unwrap().clone(),
        vec![vec!["a".to_owned()]]
    );
    assert_eq!(rig.repo.keys.lock().unwrap().len(), 1);
    assert_eq!(
        rig.navigator.opened.lock().unwrap().clone(),
        vec!["/tasks/a".to_owned()]
    );
}

#[tokio::test]
async fn the_row_and_the_badge_change_at_once_and_roll_back_on_failure() {
    let rig = rig();
    let (release, gate) = oneshot::channel();
    *rig.repo.mark_gate.lock().unwrap() = Some(gate);
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&[("a", false)], None)));
    rig.repo
        .mark_reads
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Unavailable));
    rig.counter.set_local(3);
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());
    inbox.load_first().await;

    let call = tokio::spawn({
        let inbox = inbox.clone();
        async move { inbox.open("a").await }
    });
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    // While the request is in flight the change is already visible.
    assert!(inbox.subscribe().borrow().rows[0].read);
    assert_eq!(rig.counter.current(), 2);

    release.send(()).unwrap();
    call.await.unwrap();
    let view = inbox.subscribe().borrow().clone();
    assert!(!view.rows[0].read);
    assert_eq!(view.action_error, Some(ErrorKind::Unavailable));
    assert_eq!(rig.counter.current(), 3);
}

#[tokio::test]
async fn opening_a_read_row_only_navigates() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&[("a", true)], None)));
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());
    inbox.load_first().await;
    inbox.open("a").await;
    assert!(rig.repo.marked.lock().unwrap().is_empty());
    assert_eq!(rig.navigator.opened.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn mark_all_read_updates_rows_and_badge_and_rolls_back_on_failure() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&[("a", false), ("b", true), ("c", false)], None)));
    rig.repo
        .mark_alls
        .lock()
        .unwrap()
        .extend([Err(ErrorKind::Offline), Ok(2)]);
    rig.repo.counts.lock().unwrap().push_back(Ok(0));
    rig.counter.set_local(2);
    let inbox = InboxController::new(rig.service.clone(), rig.counter.clone());
    inbox.load_first().await;

    inbox.mark_all_read().await; // fails
    let view = inbox.subscribe().borrow().clone();
    let unread: Vec<_> = view
        .rows
        .iter()
        .filter(|r| !r.read)
        .map(|r| r.id.as_str())
        .collect();
    assert_eq!(unread, ["a", "c"]);
    assert_eq!(
        (view.action_error, view.marking_all),
        (Some(ErrorKind::Offline), false)
    );
    assert_eq!(rig.counter.current(), 2);

    inbox.mark_all_read().await; // works
    let view = inbox.subscribe().borrow().clone();
    assert!(view.rows.iter().all(|r| r.read));
    assert_eq!((view.action_error, rig.counter.current()), (None, 0));
}
