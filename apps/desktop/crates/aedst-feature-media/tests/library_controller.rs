//! The library view model against a scripted repository, uploader and picker.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use aedst_common::ErrorKind;
use aedst_feature_media::{
    domain::{
        Cleanup, FailureKind, FailureReason, MediaKind, MediaPage, MediaStatus, UploadStage,
        ValidationError,
    },
    presentation::{LibraryController, Phase, UploadView},
};
use support::{FakePicker, file, media, page, rig, ticket};
use tokio::sync::oneshot;

fn controller(
    rig: &support::Rig,
    picks: Vec<Result<Option<aedst_feature_media::domain::PickedFile>, ErrorKind>>,
) -> Arc<LibraryController> {
    LibraryController::new(
        rig.repo.clone(),
        rig.service.clone(),
        Arc::new(FakePicker(Mutex::new(VecDeque::from(picks)))),
    )
}

#[tokio::test]
async fn the_first_page_loads_and_the_token_is_echoed_exactly() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .extend([Ok(page(&["a", "b"], Some("t2=="))), Ok(page(&["c"], None))]);
    let c = controller(&rig, vec![]);

    c.load_first().await;
    let view = c.subscribe().borrow().clone();
    assert_eq!(
        (view.phase, view.rows.len(), view.has_more),
        (Phase::Ready, 2, true)
    );

    c.load_more().await;
    let view = c.subscribe().borrow().clone();
    assert_eq!((view.rows.len(), view.has_more), (3, false));
    let queries = rig.repo.queries.lock().unwrap().clone();
    assert_eq!(queries[1].page_token.as_deref(), Some("t2=="));
}

#[tokio::test]
async fn the_task_filter_is_sent_and_a_failed_first_page_shows_its_kind() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .extend([Err(ErrorKind::Offline), Err(ErrorKind::Cancelled)]);
    let c = controller(&rig, vec![]);
    c.set_task_filter(Some("task-1".into()));

    c.load_first().await;
    assert_eq!(
        c.subscribe().borrow().phase,
        Phase::Failed(ErrorKind::Offline)
    );
    assert_eq!(
        rig.repo.queries.lock().unwrap()[0].task_id.as_deref(),
        Some("task-1")
    );

    c.load_first().await;
    assert_eq!(
        c.subscribe().borrow().phase,
        Phase::Idle,
        "Cancelled shows nothing"
    );
}

#[tokio::test]
async fn statuses_become_badges_and_failures_become_kinds() {
    let rig = rig();
    let mut failed = media("f", MediaKind::Image, MediaStatus::Failed);
    failed.failure = Some(FailureKind::TypeMismatch);
    rig.repo.pages.lock().unwrap().push_back(Ok(MediaPage {
        items: vec![
            media("u", MediaKind::Image, MediaStatus::PendingUpload),
            media("p", MediaKind::Video, MediaStatus::Processing),
            media("r", MediaKind::Video, MediaStatus::Ready),
            media("a", MediaKind::Audio, MediaStatus::Ready),
            failed,
            media("x", MediaKind::Unknown, MediaStatus::Unknown),
        ],
        next_page_token: None,
    }));
    let c = controller(&rig, vec![]);
    c.load_first().await;

    let view = c.subscribe().borrow().clone();
    let keys: Vec<_> = view
        .rows
        .iter()
        .map(|r| (r.status.key(), r.openable))
        .collect();
    assert_eq!(
        keys,
        [
            ("uploading", false),
            ("processing", false),
            ("ready", true),
            ("ready", false),
            ("failed", false),
            ("unknown", false),
        ]
    );
    assert_eq!(view.rows[4].failure, Some(FailureKind::TypeMismatch));
    assert!(view.unfinished);
}

#[tokio::test]
async fn a_stale_first_page_is_dropped() {
    let rig = rig();
    let (open, gate) = oneshot::channel();
    *rig.repo.gate.lock().unwrap() = Some(gate);
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["fresh"], None)), // popped by the newer call, which is not gated
        Ok(page(&["stale"], None)), // popped by the first call once its gate opens
    ]);
    let c = controller(&rig, vec![]);

    let first = tokio::spawn({
        let c = Arc::clone(&c);
        async move { c.load_first().await }
    });
    tokio::task::yield_now().await;
    c.load_first().await; // the newer load finishes first
    let _ = open.send(());
    first.await.unwrap();

    let view = c.subscribe().borrow().clone();
    assert_eq!(
        view.rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["fresh"]
    );
}

#[tokio::test]
async fn delete_asks_first_and_only_the_confirmation_sends_it() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a", "b"], None)));
    let c = controller(&rig, vec![]);
    c.load_first().await;

    c.request_delete("a");
    assert_eq!(c.subscribe().borrow().confirm_delete.as_deref(), Some("a"));
    assert_eq!(rig.repo.calls(), ["list"], "nothing sent by asking");

    c.cancel_delete();
    c.confirm_delete().await; // nothing awaits confirmation
    assert!(c.subscribe().borrow().confirm_delete.is_none());
    assert_eq!(rig.repo.calls(), ["list"]);

    c.request_delete("a");
    c.confirm_delete().await;
    let view = c.subscribe().borrow().clone();
    assert_eq!(rig.repo.calls(), ["list", "delete a"]);
    assert_eq!(
        view.rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["b"]
    );
    assert!(view.confirm_delete.is_none() && !view.deleting);
}

#[tokio::test]
async fn a_failed_delete_keeps_the_row_and_reports_the_kind() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None)));
    rig.repo
        .deletes
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Forbidden));
    let c = controller(&rig, vec![]);
    c.load_first().await;

    c.request_delete("a");
    c.confirm_delete().await;

    let view = c.subscribe().borrow().clone();
    assert_eq!(
        (view.rows.len(), view.action_error),
        (1, Some(ErrorKind::Forbidden))
    );
    assert!(view.confirm_delete.is_none());
    c.request_delete("missing");
    assert!(
        c.subscribe().borrow().confirm_delete.is_none(),
        "unknown ids are ignored"
    );
}

#[tokio::test]
async fn a_successful_upload_shows_progress_then_lists_the_new_file() {
    let rig = rig();
    *rig.uploader.chunks.lock().unwrap() = 4;
    let (open, gate) = oneshot::channel();
    *rig.uploader.gate.lock().unwrap() = Some(gate);
    rig.repo
        .pages
        .lock()
        .unwrap()
        .extend([Ok(page(&["a"], None)), Ok(page(&["a"], None))]);
    let c = controller(&rig, vec![Ok(Some(file("p.png", "image/png", 400)))]);
    c.load_first().await;

    let running = tokio::spawn({
        let c = Arc::clone(&c);
        async move { c.pick_and_upload().await }
    });
    // The uploader reported all four chunks and now waits for the gate.
    while c.subscribe().borrow().upload.percent() != 100 {
        tokio::task::yield_now().await;
    }
    match c.subscribe().borrow().upload.clone() {
        UploadView::Running {
            file_name,
            stage,
            sent,
            total,
        } => {
            assert_eq!(
                (file_name.as_str(), stage, sent, total),
                ("p.png", UploadStage::Uploading, 400, 400)
            );
        }
        other => panic!("expected a running upload, got {other:?}"),
    }
    // A second request while one runs is ignored.
    c.upload_file(file("q.png", "image/png", 10)).await;
    let _ = open.send(());
    running.await.unwrap();

    let view = c.subscribe().borrow().clone();
    assert_eq!(view.upload, UploadView::Idle);
    assert_eq!(
        view.rows.first().map(|r| r.id.as_str()),
        Some("new"),
        "the new file is on top"
    );
    assert_eq!(
        rig.repo.created.lock().unwrap().len(),
        1,
        "the second request sent nothing"
    );
}

#[tokio::test]
async fn a_failed_upload_stays_visible_with_stage_reason_and_cleanup_until_dismissed() {
    let rig = rig();
    rig.uploader
        .results
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Timeout));
    let c = controller(&rig, vec![Ok(Some(file("p.png", "image/png", 400)))]);

    c.pick_and_upload().await;

    let view = c.subscribe().borrow().clone();
    assert_eq!(
        view.upload,
        UploadView::Failed {
            file_name: "p.png".into(),
            stage: UploadStage::Uploading,
            reason: FailureReason::Kind(ErrorKind::Timeout),
            cleanup: Cleanup::Removed,
        }
    );
    c.dismiss_upload();
    assert_eq!(c.subscribe().borrow().upload, UploadView::Idle);
}

#[tokio::test]
async fn an_invalid_file_fails_at_validation_without_a_request() {
    let rig = rig();
    let c = controller(&rig, vec![Ok(Some(file("p.svg", "image/svg+xml", 400)))]);

    c.pick_and_upload().await;

    match c.subscribe().borrow().upload.clone() {
        UploadView::Failed {
            stage,
            reason,
            cleanup,
            ..
        } => assert_eq!(
            (stage, reason, cleanup),
            (
                UploadStage::Validating,
                FailureReason::Invalid(ValidationError::UnsupportedType),
                Cleanup::NotNeeded
            )
        ),
        other => panic!("expected a failed upload, got {other:?}"),
    }
    assert!(rig.repo.calls().is_empty());
}

#[tokio::test]
async fn a_cancelled_dialog_does_nothing_and_a_picker_failure_is_reported() {
    let rig = rig();
    let c = controller(&rig, vec![Ok(None), Err(ErrorKind::Storage)]);

    c.pick_and_upload().await;
    let view = c.subscribe().borrow().clone();
    assert_eq!((view.upload, view.action_error), (UploadView::Idle, None));

    c.pick_and_upload().await;
    assert_eq!(
        c.subscribe().borrow().action_error,
        Some(ErrorKind::Storage)
    );
    assert!(rig.repo.calls().is_empty());
}

#[tokio::test]
async fn refresh_updates_known_files_in_place_and_keeps_later_pages() {
    let rig = rig();
    let processing = media("a", MediaKind::Image, MediaStatus::Processing);
    rig.repo.pages.lock().unwrap().extend([
        Ok(MediaPage {
            items: vec![processing, media("b", MediaKind::Image, MediaStatus::Ready)],
            next_page_token: Some("t".into()),
        }),
        Ok(page(&["c"], None)),
        // the refresh: "a" is ready now and "n" is new
        Ok(MediaPage {
            items: vec![
                media("n", MediaKind::Image, MediaStatus::Processing),
                media("a", MediaKind::Image, MediaStatus::Ready),
                media("b", MediaKind::Image, MediaStatus::Ready),
            ],
            next_page_token: Some("t".into()),
        }),
        Ok(page(&[], None)),
    ]);
    let c = controller(&rig, vec![]);
    c.load_first().await;
    c.load_more().await;
    assert!(c.subscribe().borrow().unfinished);

    assert!(
        c.poll_unfinished().await,
        "the new file is still processing"
    );
    let view = c.subscribe().borrow().clone();
    let ids: Vec<_> = view
        .rows
        .iter()
        .map(|r| (r.id.as_str(), r.status.key()))
        .collect();
    assert_eq!(
        ids,
        [
            ("n", "processing"),
            ("a", "ready"),
            ("b", "ready"),
            ("c", "ready")
        ]
    );
}

#[tokio::test]
async fn polling_stops_when_nothing_is_unfinished() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None)));
    let c = controller(&rig, vec![]);
    c.load_first().await;
    assert!(!c.poll_unfinished().await);
    assert_eq!(
        rig.repo.calls(),
        ["list"],
        "no request when everything is finished"
    );
}

#[tokio::test]
async fn the_full_record_of_a_listed_file_is_available_for_the_viewer() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None)));
    let c = controller(&rig, vec![]);
    c.load_first().await;
    assert_eq!(c.media("a").map(|m| m.id), Some("a".to_owned()));
    assert!(c.media("zzz").is_none());
    let _ = ticket("unused");
}

#[tokio::test]
async fn a_reload_during_load_more_does_not_block_the_next_page() {
    let rig = rig();
    // The fake takes its page after the gate opens, so the reload's page comes second.
    rig.repo.pages.lock().unwrap().extend([
        Ok(page(&["a"], Some("t2"))),
        Ok(page(&["a"], Some("t3"))),
        Ok(page(&["stale"], None)),
        Ok(page(&["c"], None)),
    ]);
    let library = controller(&rig, Vec::new());
    library.load_first().await;

    let (release, gate) = oneshot::channel();
    *rig.repo.gate.lock().unwrap() = Some(gate);
    let stale = tokio::spawn({
        let library = library.clone();
        async move { library.load_more().await }
    });
    tokio::task::yield_now().await;
    library.load_first().await; // the reload makes the page load above stale
    release.send(()).unwrap();
    stale.await.unwrap();

    library.load_more().await;
    let view = library.subscribe().borrow().clone();
    let ids: Vec<&str> = view.rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["a", "c"]);
    assert!(!view.loading_more);
    let queries = rig.repo.queries.lock().unwrap().clone();
    assert_eq!(queries[3].page_token.as_deref(), Some("t3"));
}
