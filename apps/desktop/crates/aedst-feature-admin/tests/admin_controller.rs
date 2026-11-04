//! The admin view model against a scripted repository: the role gate, paging, stale responses, the
//! two-step delete and the broadcast form.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use aedst_common::ErrorKind;
use aedst_feature_admin::{
    domain::{Overview, ValidationError},
    presentation::{BroadcastStatus, DeleteState, Phase, Tab},
};
use support::{entry, page, rig, task};
use tokio::sync::oneshot;

const OWNER: &str = "00000000-0000-4000-8000-000000000001";

fn script_tasks(rig: &support::Rig, ids: &[&str], next: Option<&str>) {
    rig.repo
        .tasks
        .lock()
        .unwrap()
        .push_back(Ok(page(ids.iter().map(|i| task(i)).collect(), next)));
}

#[tokio::test]
async fn a_non_admin_loads_nothing_and_sees_no_access() {
    let rig = rig(false);
    let view = rig.controller.subscribe();
    for tab in [Tab::Overview, Tab::Tasks, Tab::Audit] {
        rig.controller.open_tab(tab).await;
    }
    rig.controller.reload().await;
    rig.controller.load_more().await;
    rig.controller.set_owner_filter(OWNER).await;
    rig.controller.request_delete("x").await;
    rig.controller.confirm_delete("a reason").await;
    rig.controller.broadcast("", "Hi", "", "").await;
    assert!(rig.repo.calls().is_empty(), "{:?}", rig.repo.calls());
    let view = view.borrow().clone();
    assert!(view.no_access);
    assert_eq!(view.delete, DeleteState::Idle);
    assert_eq!(view.broadcast, BroadcastStatus::Idle);
    assert!(view.tasks.rows.is_empty());
}

#[tokio::test]
async fn tabs_load_lazily_and_only_once() {
    let rig = rig(true);
    rig.repo.overviews.lock().unwrap().push_back(Ok(Overview {
        tasks_total: 3,
        ..Overview::default()
    }));
    rig.repo
        .tasks
        .lock()
        .unwrap()
        .push_back(Ok(page(vec![task("u1")], None)));
    rig.controller.open_tab(Tab::Overview).await;
    rig.controller.open_tab(Tab::Tasks).await;
    rig.controller.open_tab(Tab::Overview).await;
    rig.controller.open_tab(Tab::Tasks).await;
    assert_eq!(rig.repo.calls(), ["overview", "tasks::"]);
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view.overview.rows[0].tasks_total, 3);
    assert_eq!(view.tasks.rows.len(), 1);
    assert_eq!(view.tab, Tab::Tasks);
}

#[tokio::test]
async fn paging_echoes_the_token_and_appends() {
    let rig = rig(true);
    {
        let mut pages = rig.repo.tasks.lock().unwrap();
        pages.push_back(Ok(page(vec![task("u1")], Some("tok 1"))));
        pages.push_back(Ok(page(vec![task("u2")], None)));
    }
    rig.controller.open_tab(Tab::Tasks).await;
    assert!(rig.controller.subscribe().borrow().tasks.has_more);
    rig.controller.load_more().await;
    rig.controller.load_more().await; // no more pages: no request
    assert_eq!(rig.repo.calls(), ["tasks::", "tasks::tok 1"]);
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view.tasks.rows.len(), 2);
    assert!(!view.tasks.has_more);
}

#[tokio::test]
async fn audit_log_pages_too_and_a_failed_later_page_keeps_the_rows() {
    let rig = rig(true);
    {
        let mut audits = rig.repo.audits.lock().unwrap();
        audits.push_back(Ok(page(vec![entry("e1")], Some("n"))));
        audits.push_back(Err(ErrorKind::Unavailable));
    }
    rig.controller.open_tab(Tab::Audit).await;
    rig.controller.load_more().await;
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view.audit.rows.len(), 1);
    assert_eq!(view.audit.page_error, Some(ErrorKind::Unavailable));
    assert_eq!(view.audit.phase, Phase::Ready);
}

#[tokio::test]
async fn a_failed_first_page_is_failed_and_cancelled_shows_nothing() {
    let rig = rig(true);
    {
        let mut pages = rig.repo.tasks.lock().unwrap();
        pages.push_back(Err(ErrorKind::Cancelled));
        pages.push_back(Err(ErrorKind::Offline));
    }
    rig.controller.open_tab(Tab::Tasks).await;
    assert_eq!(rig.controller.subscribe().borrow().tasks.phase, Phase::Idle);
    rig.controller.reload().await;
    assert_eq!(
        rig.controller.subscribe().borrow().tasks.phase,
        Phase::Failed(ErrorKind::Offline)
    );
}

#[tokio::test]
async fn forbidden_from_the_server_becomes_no_access() {
    let rig = rig(true);
    rig.repo
        .tasks
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Forbidden));
    rig.controller.open_tab(Tab::Tasks).await;
    let view = rig.controller.subscribe().borrow().clone();
    assert!(view.no_access);
    assert_eq!(view.tasks.phase, Phase::Idle);
}

#[tokio::test]
async fn an_older_response_is_dropped() {
    let rig = rig(true);
    let (open, gate) = oneshot::channel();
    *rig.repo.gate.lock().unwrap() = Some(gate);
    script_tasks(&rig, &["old"], None);
    script_tasks(&rig, &["new"], None);
    let (slow, fast) = tokio::join!(rig.controller.open_tab(Tab::Tasks), async {
        tokio::task::yield_now().await;
        rig.controller.reload().await;
        open.send(()).unwrap();
    });
    let ((), ()) = (slow, fast);
    let view = rig.controller.subscribe().borrow().clone();
    let ids: Vec<_> = view.tasks.rows.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["new"]);
}

#[tokio::test]
async fn the_owner_filter_is_validated_then_sent() {
    let rig = rig(true);
    script_tasks(&rig, &["t1"], None);
    rig.controller.set_owner_filter("not a uuid").await;
    assert!(rig.repo.calls().is_empty());
    assert!(rig.controller.subscribe().borrow().filter_invalid);
    rig.controller.set_owner_filter(OWNER).await;
    assert_eq!(rig.repo.calls(), [format!("tasks:{OWNER}:")]);
    assert!(!rig.controller.subscribe().borrow().filter_invalid);
}

#[tokio::test]
async fn nothing_is_deleted_without_the_confirm_step_and_a_reason() {
    let rig = rig(true);
    script_tasks(&rig, &["t1", "t2"], None);
    rig.controller.open_tab(Tab::Tasks).await;

    // Confirming without step one does nothing.
    rig.controller.confirm_delete("a good reason").await;
    assert_eq!(rig.repo.calls().len(), 1);

    rig.controller.request_delete("t1").await;
    assert_eq!(
        rig.controller.subscribe().borrow().delete,
        DeleteState::Confirming {
            id: "t1".into(),
            title: "task t1".into()
        }
    );
    assert_eq!(rig.repo.calls().len(), 1, "step one sends nothing");

    rig.controller.confirm_delete("  ab ").await;
    assert!(matches!(
        rig.controller.subscribe().borrow().delete,
        DeleteState::Invalid {
            error: ValidationError::ReasonTooShort,
            ..
        }
    ));
    assert_eq!(rig.repo.calls().len(), 1, "an invalid reason sends nothing");

    rig.controller.cancel_delete();
    assert_eq!(
        rig.controller.subscribe().borrow().delete,
        DeleteState::Idle
    );
    rig.controller.confirm_delete("a good reason").await;
    assert_eq!(
        rig.repo.calls().len(),
        1,
        "a cancelled confirmation cannot be confirmed"
    );
}

#[tokio::test]
async fn a_confirmed_delete_sends_the_reason_with_a_key_and_removes_the_row() {
    let rig = rig(true);
    script_tasks(&rig, &["t1", "t2"], None);
    rig.repo.deletes.lock().unwrap().push_back(Ok(()));
    rig.controller.open_tab(Tab::Tasks).await;
    rig.controller.request_delete("t1").await;
    rig.controller.confirm_delete("  spam content ").await;
    assert_eq!(rig.repo.calls()[1], "delete:t1:spam content:k1");
    let view = rig.controller.subscribe().borrow().clone();
    assert_eq!(view.delete, DeleteState::Idle);
    let ids: Vec<_> = view.tasks.rows.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["t2"]);
    assert_eq!(view.audit.phase, Phase::Idle);
}

#[tokio::test]
async fn a_failed_delete_keeps_the_confirmation_open_for_a_retry() {
    let rig = rig(true);
    script_tasks(&rig, &["t1"], None);
    {
        let mut deletes = rig.repo.deletes.lock().unwrap();
        deletes.push_back(Err(ErrorKind::Unavailable));
        deletes.push_back(Ok(()));
    }
    rig.controller.open_tab(Tab::Tasks).await;
    rig.controller.request_delete("t1").await;
    rig.controller.confirm_delete("because").await;
    let view = rig.controller.subscribe().borrow().clone();
    assert!(matches!(
        view.delete,
        DeleteState::Failed {
            kind: ErrorKind::Unavailable,
            ..
        }
    ));
    assert_eq!(view.tasks.rows.len(), 1);
    rig.controller.confirm_delete("because").await;
    assert!(rig.controller.subscribe().borrow().tasks.rows.is_empty());
}

#[tokio::test]
async fn broadcast_validates_sends_and_reports_success() {
    let rig = rig(true);
    rig.repo.broadcasts.lock().unwrap().push_back(Ok(42));

    rig.controller.broadcast("", "  ", "", "").await;
    assert_eq!(
        rig.controller.subscribe().borrow().broadcast,
        BroadcastStatus::Invalid(ValidationError::TitleRequired)
    );
    rig.controller
        .broadcast("", "Hi", "", "//evil.example")
        .await;
    assert_eq!(
        rig.controller.subscribe().borrow().broadcast,
        BroadcastStatus::Invalid(ValidationError::LinkInvalid)
    );
    assert!(rig.repo.calls().is_empty());

    rig.controller.broadcast("", " Hi ", "body", "/tasks").await;
    assert_eq!(rig.repo.calls(), ["broadcast:Hi:k1"]);
    assert_eq!(
        rig.controller.subscribe().borrow().broadcast,
        BroadcastStatus::Sent { recipients: 42 }
    );
    rig.controller.clear_broadcast_status();
    assert_eq!(
        rig.controller.subscribe().borrow().broadcast,
        BroadcastStatus::Idle
    );
}

#[tokio::test]
async fn broadcast_failures_show_their_kind_and_cancelled_shows_nothing() {
    let rig = rig(true);
    {
        let mut broadcasts = rig.repo.broadcasts.lock().unwrap();
        broadcasts.push_back(Err(ErrorKind::RateLimited));
        broadcasts.push_back(Err(ErrorKind::Cancelled));
    }
    rig.controller.broadcast(OWNER, "Hi", "", "").await;
    assert_eq!(
        rig.controller.subscribe().borrow().broadcast,
        BroadcastStatus::Failed(ErrorKind::RateLimited)
    );
    rig.controller.broadcast(OWNER, "Hi", "", "").await;
    assert_eq!(
        rig.controller.subscribe().borrow().broadcast,
        BroadcastStatus::Idle
    );
}
