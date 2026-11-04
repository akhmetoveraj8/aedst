//! The preferences view model against a scripted repository.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use aedst_common::ErrorKind;
use aedst_feature_notifications::{
    domain::Preferences,
    presentation::{PreferencesController, PrefsPhase},
};
use support::rig;

const ALL_ON: Preferences = Preferences {
    push_enabled: true,
    task_completed: true,
    task_due_soon: true,
    media_ready: true,
};

#[tokio::test]
async fn loading_shows_the_server_values_and_a_failure_shows_its_kind() {
    let rig = rig();
    rig.repo
        .gets
        .lock()
        .unwrap()
        .extend([Err(ErrorKind::Timeout), Ok(ALL_ON)]);
    let prefs = PreferencesController::new(rig.service.clone());
    prefs.load().await;
    assert_eq!(
        prefs.subscribe().borrow().phase,
        PrefsPhase::Failed(ErrorKind::Timeout)
    );
    prefs.load().await;
    let view = *prefs.subscribe().borrow();
    assert_eq!((view.phase, view.preferences), (PrefsPhase::Ready, ALL_ON));
}

#[tokio::test]
async fn a_toggle_sends_the_whole_set_with_a_key_and_keeps_the_server_answer() {
    let rig = rig();
    rig.repo.gets.lock().unwrap().push_back(Ok(ALL_ON));
    let stored = Preferences {
        task_due_soon: false,
        ..ALL_ON
    };
    rig.repo.updates.lock().unwrap().push_back(Ok(stored));
    let prefs = PreferencesController::new(rig.service.clone());
    prefs.load().await;

    prefs.set("task-due-soon", false).await;

    assert_eq!(prefs.subscribe().borrow().preferences, stored);
    assert_eq!(
        rig.repo.sent_preferences.lock().unwrap().clone(),
        vec![stored]
    );
    assert_eq!(rig.repo.keys.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_failed_save_rolls_the_switch_back_and_shows_the_kind() {
    let rig = rig();
    rig.repo.gets.lock().unwrap().push_back(Ok(ALL_ON));
    rig.repo
        .updates
        .lock()
        .unwrap()
        .extend([Err(ErrorKind::Offline), Ok(ALL_ON)]);
    let prefs = PreferencesController::new(rig.service.clone());
    prefs.load().await;

    prefs.set("media-ready", false).await;
    let view = *prefs.subscribe().borrow();
    assert_eq!(view.preferences, ALL_ON);
    assert_eq!(view.save_error, Some(ErrorKind::Offline));

    prefs.set("media-ready", true).await; // the next attempt clears the error
    assert_eq!(prefs.subscribe().borrow().save_error, None);
}

#[tokio::test]
async fn unknown_keys_and_toggles_before_loading_do_nothing() {
    let rig = rig();
    let prefs = PreferencesController::new(rig.service.clone());
    prefs.set("task-completed", true).await; // not loaded yet
    rig.repo.gets.lock().unwrap().push_back(Ok(ALL_ON));
    prefs.load().await;
    prefs.set("no-such-switch", false).await;
    assert!(rig.repo.sent_preferences.lock().unwrap().is_empty());
}
