//! The unread counter and its poller, on a paused clock.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::{sync::atomic::Ordering, time::Duration};

use aedst_common::ErrorKind;
use support::rig;
use tokio::sync::watch;

#[tokio::test]
async fn refresh_publishes_and_a_failure_keeps_the_shown_count() {
    let rig = rig();
    rig.repo
        .counts
        .lock()
        .unwrap()
        .extend([Ok(7), Err(ErrorKind::Unavailable)]);
    assert_eq!(rig.counter.refresh().await, Ok(7));
    assert_eq!(rig.counter.current(), 7);
    assert_eq!(rig.counter.refresh().await, Err(ErrorKind::Unavailable));
    assert_eq!(rig.counter.current(), 7);
}

#[tokio::test]
async fn a_local_decrease_never_goes_below_zero() {
    let rig = rig();
    rig.counter.set_local(3);
    rig.counter.decrease(5);
    assert_eq!(rig.counter.current(), 0);
}

#[tokio::test(start_paused = true)]
async fn the_poller_backs_off_after_failures_and_resets_after_a_success() {
    let rig = rig();
    rig.repo.counts.lock().unwrap().extend([
        Err(ErrorKind::Unavailable), // t=0   -> next in 60 s
        Err(ErrorKind::Unavailable), // t=60  -> next in 120 s
        Ok(5),                       // t=180 -> next in 30 s
        Ok(6),                       // t=210
    ]);
    let (_foreground, receiver) = watch::channel(true);
    let counter = rig.counter.clone();
    let task = tokio::spawn(async move { counter.run(receiver).await });

    let calls = || rig.repo.count_calls.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(1)).await;
    assert_eq!(calls(), 1);
    tokio::time::sleep(Duration::from_secs(58)).await; // t=58
    assert_eq!(calls(), 1);
    tokio::time::sleep(Duration::from_secs(3)).await; // t=61
    assert_eq!(calls(), 2);
    tokio::time::sleep(Duration::from_secs(118)).await; // t=179
    assert_eq!(calls(), 2);
    tokio::time::sleep(Duration::from_secs(3)).await; // t=182
    assert_eq!(calls(), 3);
    assert_eq!(rig.counter.current(), 5);
    tokio::time::sleep(Duration::from_secs(31)).await; // success reset the delay to 30 s
    assert_eq!(calls(), 4);
    assert_eq!(rig.counter.current(), 6);
    task.abort();
}

#[tokio::test(start_paused = true)]
async fn coming_to_the_foreground_polls_at_once_and_a_dead_session_stops_the_loop() {
    let rig = rig();
    rig.repo
        .counts
        .lock()
        .unwrap()
        .extend([Ok(1), Ok(2), Err(ErrorKind::Unauthenticated)]);
    let (foreground, receiver) = watch::channel(false);
    let counter = rig.counter.clone();
    let task = tokio::spawn(async move { counter.run(receiver).await });

    tokio::time::sleep(Duration::from_millis(1)).await;
    let calls = || rig.repo.count_calls.load(Ordering::SeqCst);
    assert_eq!(calls(), 1);
    tokio::time::sleep(Duration::from_secs(10)).await; // the background interval is 120 s
    assert_eq!(calls(), 1);
    foreground.send(true).unwrap();
    tokio::time::sleep(Duration::from_millis(1)).await;
    assert_eq!(calls(), 2);
    assert_eq!(rig.counter.current(), 2);

    tokio::time::sleep(Duration::from_secs(31)).await; // unauthenticated ends the loop
    task.await.unwrap();
    assert_eq!(calls(), 3);
}
