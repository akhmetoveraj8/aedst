//! The search view model against a scripted repository, with tokio's paused clock.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::time::Duration;

use aedst_common::ErrorKind;
use aedst_feature_search::presentation::{DEBOUNCE, Phase};
use support::{page, rig, settle};
use tokio::sync::oneshot;

#[tokio::test(start_paused = true)]
async fn typing_is_debounced_and_only_the_last_text_is_sent() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None, Some(1))));
    rig.controller.set_query("m");
    tokio::time::sleep(Duration::from_millis(100)).await;
    rig.controller.set_query("mi");
    tokio::time::sleep(Duration::from_millis(100)).await;
    rig.controller.set_query("milk");
    settle().await;
    assert!(
        rig.repo.searches.lock().unwrap().is_empty(),
        "still waiting for the pause"
    );

    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    let searches = rig.repo.searches.lock().unwrap().clone();
    assert_eq!(searches.len(), 1);
    assert_eq!(searches[0].text, "milk");
    assert_eq!(searches[0].page_token, None);
    let suggests = rig.repo.suggests.lock().unwrap().clone();
    assert_eq!(suggests, vec![("milk".to_owned(), 8)]);
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(
        (view.phase, view.hits.len(), view.total_estimate),
        (Phase::Ready, 1, Some(1))
    );
}

#[tokio::test(start_paused = true)]
async fn an_empty_query_makes_no_request_and_clears_the_results() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a", "b"], Some("t"), Some(9))));
    rig.repo
        .suggestions
        .lock()
        .unwrap()
        .push_back(Ok(vec!["milk".into()]));
    rig.controller.set_query("milk");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    assert_eq!(rig.controller.subscribe().borrow().hits.len(), 2);

    rig.controller.set_query("   ");
    tokio::time::sleep(DEBOUNCE * 4).await;
    settle().await;
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view, Default::default(), "everything is cleared");
    assert_eq!(rig.repo.searches.lock().unwrap().len(), 1, "no new request");

    rig.controller.submit().await;
    assert_eq!(
        rig.repo.searches.lock().unwrap().len(),
        1,
        "submit of blank"
    );
}

#[tokio::test(start_paused = true)]
async fn clearing_while_a_pause_is_pending_cancels_it() {
    let rig = rig();
    rig.controller.set_query("milk");
    tokio::time::sleep(Duration::from_millis(100)).await;
    rig.controller.set_query("");
    tokio::time::sleep(DEBOUNCE * 2).await;
    settle().await;
    assert!(rig.repo.searches.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_slow_older_answer_cannot_overwrite_a_newer_one() {
    let rig = rig();
    let (release, gate) = oneshot::channel();
    *rig.repo.search_gate.lock().unwrap() = Some(gate);
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["old"], None, Some(1))),
        Ok(page(&["new"], None, Some(1))),
    ]);
    rig.repo.suggestions.lock().unwrap().extend([
        Ok(vec!["old suggestion".into()]),
        Ok(vec!["new suggestion".into()]),
    ]);

    rig.controller.set_query("milk");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await; // the first search is in flight, held by the gate

    rig.controller.set_query("eggs");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await; // the second search finished first
    release.send(()).unwrap();
    settle().await;

    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view.hits[0].id, "new");
    assert_eq!(view.hits.len(), 1);
    assert_eq!(view.suggestions, vec!["new suggestion".to_owned()]);
}

#[tokio::test(start_paused = true)]
async fn load_more_echoes_the_token_and_appends() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["a", "b"], Some("t2"), Some(3))),
        Ok(page(&["c"], None, None)),
    ]);
    rig.controller.set_query("milk");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    let view = rig.controller.subscribe().borrow().clone();
    assert!(view.has_more);

    rig.controller.load_more().await;
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(
        (view.hits.len(), view.total_estimate, view.has_more),
        (3, Some(3), false)
    );
    let searches = rig.repo.searches.lock().unwrap().clone();
    assert_eq!(searches[1].page_token.as_deref(), Some("t2"));
    assert_eq!(searches[1].text, "milk");

    rig.controller.load_more().await; // nothing left: no request
    assert_eq!(rig.repo.searches.lock().unwrap().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_failed_search_shows_its_kind_retry_works_and_cancelled_shows_nothing() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Err(ErrorKind::Offline),
        Ok(page(&["a"], None, Some(1))),
        Err(ErrorKind::Cancelled),
    ]);
    rig.controller.set_query("milk");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    assert_eq!(
        rig.controller.subscribe().borrow().phase,
        Phase::Failed(ErrorKind::Offline)
    );

    rig.controller.submit().await; // "Try again"
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!((view.phase, view.hits.len()), (Phase::Ready, 1));

    rig.controller.submit().await;
    assert_eq!(
        rig.controller.subscribe().borrow().phase,
        Phase::Idle,
        "user intent is not an error"
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_later_page_keeps_the_hits_and_reports_the_kind() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["a"], Some("t2"), Some(2))),
        Err(ErrorKind::Unavailable),
    ]);
    rig.controller.set_query("milk");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    rig.controller.load_more().await;
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(
        (view.hits.len(), view.has_more, view.action_error),
        (1, true, Some(ErrorKind::Unavailable))
    );
}

#[tokio::test(start_paused = true)]
async fn a_failing_suggest_stays_silent_and_a_suggestion_can_be_picked() {
    let rig = rig();
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["a"], None, Some(1))),
        Ok(page(&["b"], None, Some(1))),
    ]);
    rig.repo
        .suggestions
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Unavailable));
    rig.controller.set_query("mi");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view.phase, Phase::Ready);
    assert!(view.suggestions.is_empty() && view.action_error.is_none());

    rig.controller.pick_suggestion("milk").await; // no waiting for a pause
    let searches = rig.repo.searches.lock().unwrap().clone();
    assert_eq!(searches.last().unwrap().text, "milk");
    assert_eq!(rig.controller.subscribe().borrow().hits[0].id, "b");
}

#[tokio::test(start_paused = true)]
async fn long_queries_are_cut_and_get_no_suggestions() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&[], None, Some(0))));
    rig.controller
        .set_query(&format!("  {}  ", "ж".repeat(300)));
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    let searches = rig.repo.searches.lock().unwrap().clone();
    assert_eq!(searches[0].text.chars().count(), 200);
    assert!(
        rig.repo.suggests.lock().unwrap().is_empty(),
        "over 100 characters: no suggest request"
    );
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!((view.phase, view.hits.len()), (Phase::Ready, 0));
}

#[tokio::test(start_paused = true)]
async fn open_hit_goes_through_the_navigator_only_for_in_app_links() {
    let rig = rig();
    let mut p = page(&["a", "b", "c", "d"], None, Some(4));
    p.hits[1].link = "https://evil.example/x".into();
    p.hits[2].link = "//evil.example/x".into();
    rig.repo.pages.lock().unwrap().push_back(Ok(p));
    rig.navigator
        .refuse
        .lock()
        .unwrap()
        .push("/tasks/d".to_owned());
    rig.controller.set_query("hit");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;

    assert!(rig.controller.open_hit(0));
    assert!(!rig.controller.open_hit(1), "absolute URL");
    assert!(!rig.controller.open_hit(2), "scheme-relative URL");
    assert!(!rig.controller.open_hit(3), "refused by the router");
    assert!(!rig.controller.open_hit(99), "no such row");
    assert_eq!(
        rig.navigator.opened.lock().unwrap().clone(),
        vec!["/tasks/a".to_owned()]
    );
}

#[tokio::test(start_paused = true)]
async fn rows_carry_plain_snippets_and_unknown_kinds() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None, Some(1))));
    rig.controller.set_query("hit");
    tokio::time::sleep(DEBOUNCE + Duration::from_millis(1)).await;
    settle().await;
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view.hits[0].snippet, "about hit a here");
    assert_eq!(view.hits[0].segments.len(), 3);
    assert_eq!(view.hits[0].kind.key(), "task");
}
