//! The upload use case against fakes: the happy path and every failure step.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::sync::{Arc, Mutex};

use aedst_common::ErrorKind;
use aedst_feature_media::domain::{
    Cleanup, FailureReason, MediaKind, MediaStatus, UploadEvent, UploadStage, ValidationError,
};
use support::{file, media, rig};

type Sink = Arc<dyn Fn(UploadEvent) + Send + Sync>;

fn recorder() -> (Arc<Mutex<Vec<UploadEvent>>>, Sink) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    (events, Arc::new(move |e| sink.lock().unwrap().push(e)))
}

#[tokio::test]
async fn a_valid_file_goes_create_upload_complete_in_that_order() {
    let rig = rig();
    *rig.uploader.chunks.lock().unwrap() = 2;
    let (events, on_event) = recorder();
    let task = "6f1c1d1e-0a53-4a43-8d0f-0c9f4f1b2a10";

    let done = rig
        .service
        .upload(&file("a.png", "image/png", 100), Some(task), on_event)
        .await
        .unwrap();

    assert_eq!(
        (done.id.as_str(), done.status),
        ("new", MediaStatus::Processing)
    );
    assert_eq!(rig.repo.calls(), ["create", "complete new"]);
    let created = rig.repo.created.lock().unwrap().clone();
    assert_eq!(
        (
            created[0].filename.as_str(),
            created[0].size_bytes,
            created[0].task_id.as_deref()
        ),
        ("a.png", 100, Some(task))
    );
    // The method and headers the server returned are what the uploader got.
    let target = rig.uploader.targets.lock().unwrap()[0].clone();
    assert_eq!(target.method, "PUT");
    assert_eq!(target.headers, vec![("x-meta".to_owned(), "1".to_owned())]);
    assert_eq!(
        events.lock().unwrap().clone(),
        [
            UploadEvent::Stage(UploadStage::Validating),
            UploadEvent::Stage(UploadStage::Creating),
            UploadEvent::Stage(UploadStage::Uploading),
            UploadEvent::Bytes {
                sent: 50,
                total: 100
            },
            UploadEvent::Bytes {
                sent: 100,
                total: 100
            },
            UploadEvent::Stage(UploadStage::Completing),
        ]
    );
}

#[tokio::test]
async fn validation_failures_send_nothing() {
    let cases = [
        (file("a.png", "image/png", 0), ValidationError::Empty),
        (
            file("a.svg", "image/svg+xml", 10),
            ValidationError::UnsupportedType,
        ),
        (
            file("a.exe", "application/octet-stream", 10),
            ValidationError::UnsupportedType,
        ),
        (
            file("big.png", "image/png", 20 * 1024 * 1024 + 1),
            ValidationError::TooLarge(MediaKind::Image),
        ),
        (
            file("big.mp4", "video/mp4", 500 * 1024 * 1024 + 1),
            ValidationError::TooLarge(MediaKind::Video),
        ),
        (file("   ", "image/png", 10), ValidationError::BadFilename),
        (
            file(&"n".repeat(256), "image/png", 10),
            ValidationError::BadFilename,
        ),
    ];
    for (picked, expected) in cases {
        let rig = rig();
        let (_, on_event) = recorder();
        let failure = rig
            .service
            .upload(&picked, None, on_event)
            .await
            .unwrap_err();
        assert_eq!(
            failure.reason,
            FailureReason::Invalid(expected),
            "{picked:?}"
        );
        assert_eq!(
            (failure.stage, failure.media_id, failure.cleanup),
            (UploadStage::Validating, None, Cleanup::NotNeeded)
        );
        assert!(rig.repo.calls().is_empty(), "no request for {picked:?}");
        assert!(rig.uploader.targets.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn a_task_id_must_be_a_uuid() {
    let rig = rig();
    let (_, on_event) = recorder();
    let failure = rig
        .service
        .upload(
            &file("a.png", "image/png", 10),
            Some("not-a-uuid"),
            on_event,
        )
        .await
        .unwrap_err();
    assert_eq!(
        failure.reason,
        FailureReason::Invalid(ValidationError::BadTask)
    );
}

#[tokio::test]
async fn a_failed_create_leaves_nothing_behind() {
    let rig = rig();
    rig.repo
        .tickets
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Offline));
    let (_, on_event) = recorder();

    let failure = rig
        .service
        .upload(&file("a.png", "image/png", 10), None, on_event)
        .await
        .unwrap_err();

    assert_eq!(failure.reason, FailureReason::Kind(ErrorKind::Offline));
    assert_eq!(
        (failure.stage, failure.media_id, failure.cleanup),
        (UploadStage::Creating, None, Cleanup::NotNeeded)
    );
    assert_eq!(
        rig.repo.calls(),
        ["create"],
        "no delete: nothing was created"
    );
    assert!(
        rig.uploader.targets.lock().unwrap().is_empty(),
        "nothing queued, nothing sent"
    );
}

#[tokio::test]
async fn a_failed_transfer_removes_the_record_and_says_so() {
    let rig = rig();
    rig.uploader
        .results
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Forbidden));
    let (_, on_event) = recorder();

    let failure = rig
        .service
        .upload(&file("a.png", "image/png", 10), None, on_event)
        .await
        .unwrap_err();

    assert_eq!(failure.reason, FailureReason::Kind(ErrorKind::Forbidden));
    assert_eq!(
        (failure.stage, failure.media_id.as_deref(), failure.cleanup),
        (UploadStage::Uploading, Some("new"), Cleanup::Removed)
    );
    assert_eq!(rig.repo.calls(), ["create", "delete new"]);
}

#[tokio::test]
async fn when_the_cleanup_fails_too_the_failure_says_the_record_may_remain() {
    let rig = rig();
    rig.uploader
        .results
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Offline));
    rig.repo
        .deletes
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Offline));
    let (_, on_event) = recorder();

    let failure = rig
        .service
        .upload(&file("a.png", "image/png", 10), None, on_event)
        .await
        .unwrap_err();

    assert_eq!(failure.reason, FailureReason::Kind(ErrorKind::Offline));
    assert_eq!(
        (failure.media_id.as_deref(), failure.cleanup),
        (Some("new"), Cleanup::Failed)
    );
}

#[tokio::test]
async fn a_failed_completion_is_reported_with_its_stage_and_cleaned_up() {
    let rig = rig();
    rig.repo
        .completes
        .lock()
        .unwrap()
        .push_back(Err(ErrorKind::Unavailable));
    let (_, on_event) = recorder();

    let failure = rig
        .service
        .upload(&file("a.png", "image/png", 10), None, on_event)
        .await
        .unwrap_err();

    assert_eq!(failure.reason, FailureReason::Kind(ErrorKind::Unavailable));
    assert_eq!(
        (failure.stage, failure.media_id.as_deref(), failure.cleanup),
        (UploadStage::Completing, Some("new"), Cleanup::Removed)
    );
    assert_eq!(rig.repo.calls(), ["create", "complete new", "delete new"]);
}

#[test]
fn a_ticket_never_shows_its_url_in_debug_output() {
    let shown = format!("{:?}", support::ticket("x"));
    assert!(
        !shown.contains("SECRET") && !shown.contains("storage.example"),
        "{shown}"
    );
    let m = media("y", MediaKind::Image, MediaStatus::Ready);
    assert!(!format!("{m:?}").contains("SECRET"));
}
