#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Crash-loop safe mode and the persisted update state, including corrupt files.

mod support;

use aedst_update::{
    CRASH_LOOP_THRESHOLD, FileUpdateStateStore, PersistedState, StartupHealthGuard,
    UpdateStateStore,
};
use support::TempDir;

#[test]
fn unhealthy_starts_accumulate_into_safe_mode() {
    let dir = TempDir::new();
    let path = dir.file("health.json");
    let guard = StartupHealthGuard::new(path, "1.0.0");

    let first = guard.record_start().unwrap();
    assert!(first.first_start_of_this_version);
    assert_eq!((first.unhealthy_starts, first.crash_loop), (1, false));
    assert_eq!(guard.record_start().unwrap().unhealthy_starts, 2);
    let third = guard.record_start().unwrap();
    assert_eq!(third.unhealthy_starts, CRASH_LOOP_THRESHOLD);
    assert!(third.crash_loop && !third.first_start_of_this_version);
}

#[test]
fn a_clean_exit_resets_the_count_and_remembers_the_good_version() {
    let dir = TempDir::new();
    let guard = StartupHealthGuard::new(dir.file("health.json"), "1.0.0");
    guard.record_start().unwrap();
    guard.record_start().unwrap();
    guard.mark_healthy().unwrap();

    let next = guard.record_start().unwrap();
    assert_eq!((next.unhealthy_starts, next.crash_loop), (1, false));
    assert_eq!(next.last_known_good.as_deref(), Some("1.0.0"));
}

#[test]
fn a_newly_installed_version_starts_with_a_clean_count() {
    let dir = TempDir::new();
    let path = dir.file("health.json");
    let old = StartupHealthGuard::new(path.clone(), "1.0.0");
    old.mark_healthy().unwrap();
    old.record_start().unwrap();
    old.record_start().unwrap();
    old.record_start().unwrap();
    assert!(old.record_start().unwrap().crash_loop);

    // The signed rollback (or a fixed release) installs another version: safe mode ends, the good one is remembered.
    let fixed = StartupHealthGuard::new(path, "1.0.1");
    let report = fixed.record_start().unwrap();
    assert!(report.first_start_of_this_version);
    assert_eq!((report.unhealthy_starts, report.crash_loop), (1, false));
    assert_eq!(report.last_known_good.as_deref(), Some("1.0.0"));
}

#[test]
fn a_corrupt_health_file_is_no_history_and_never_a_crash() {
    for junk in [
        &b"\x00\xff garbage"[..],
        b"{\"unhealthyStarts\":\"many\"}",
        b"[1,2,3]",
        &[b'x'; 10_000],
    ] {
        let dir = TempDir::new();
        let path = dir.file("health.json");
        std::fs::write(&path, junk).unwrap();
        let guard = StartupHealthGuard::new(path.clone(), "1.0.0");
        let report = guard.record_start().unwrap();
        assert_eq!((report.unhealthy_starts, report.crash_loop), (1, false));
        // The next save replaced the garbage with valid state.
        assert_eq!(guard.record_start().unwrap().unhealthy_starts, 2);
    }
}

#[test]
fn an_unwritable_health_path_is_an_error_not_a_panic() {
    let dir = TempDir::new();
    let blocker = dir.file("file");
    std::fs::write(&blocker, b"x").unwrap();
    // A directory cannot be created below a regular file.
    let guard = StartupHealthGuard::new(blocker.join("health.json"), "1.0.0");
    assert!(guard.record_start().is_err());
    assert!(guard.mark_healthy().is_err());
}

#[test]
fn the_update_state_round_trips_and_leaves_no_temporary_file() {
    let dir = TempDir::new();
    let path = dir.file("nested/update-state.json");
    let store = FileUpdateStateStore::new(path.clone());
    assert_eq!(store.load(), PersistedState::default(), "first run");

    let state = PersistedState {
        last_seen_published_at: 1234,
        last_seen_version: Some("1.2.3".to_owned()),
        last_check: Some(99),
        skipped_version: Some("1.2.3".to_owned()),
        applied_version: Some("1.2.2".to_owned()),
    };
    store.save(&state).unwrap();
    assert_eq!(store.load(), state);
    assert_eq!(
        FileUpdateStateStore::new(path.clone()).load(),
        state,
        "a new store sees it"
    );
    assert!(!dir.file("nested/update-state.json.tmp").exists());
}

#[test]
fn a_corrupt_update_state_reads_as_the_default_and_is_replaced_by_the_next_save() {
    let dir = TempDir::new();
    let path = dir.file("update-state.json");
    let store = FileUpdateStateStore::new(path.clone());
    for junk in [
        &b""[..],
        b"\xff\xfe",
        b"{not json",
        b"{\"lastCheck\":\"yesterday\"}",
        &[b'{'; 9_000],
    ] {
        std::fs::write(&path, junk).unwrap();
        assert_eq!(store.load(), PersistedState::default());
    }
    let state = PersistedState {
        last_check: Some(5),
        ..PersistedState::default()
    };
    store.save(&state).unwrap();
    assert_eq!(store.load(), state);
}

#[test]
fn unknown_fields_in_the_state_file_are_tolerated() {
    let dir = TempDir::new();
    let path = dir.file("update-state.json");
    std::fs::write(&path, br#"{"lastCheck":7,"fromTheFuture":true}"#).unwrap();
    assert_eq!(FileUpdateStateStore::new(path).load().last_check, Some(7));
}
