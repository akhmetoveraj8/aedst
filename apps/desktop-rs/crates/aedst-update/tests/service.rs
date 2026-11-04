#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The update flow end to end with fakes. The Velopack adapter is compile-checked only.

mod support;

use std::sync::atomic::Ordering;
use std::time::Duration;

use aedst_update::{
    ArtifactError, FeedMismatch, Installer, ManifestError, PackageSource, PolicyError,
    ReportOnlyInstaller, Timing, TrustedKeys, UpdateError, UpdatePhase,
};
use semver::Version;
use support::{
    FakeInstaller, Harness, NOW, PACKAGE, Spec, feed_candidate, harness, harness_with, signing_key,
    trusted,
};

fn feed_installer(dir: &support::TempDir) -> FakeInstaller {
    FakeInstaller::feed(
        Some(feed_candidate("1.1.0", PACKAGE)),
        Some((
            dir.file("packages/Aedst-1.1.0-full.nupkg"),
            PACKAGE.to_vec(),
        )),
    )
}

fn ready(spec: &Spec) -> Harness {
    let key = signing_key();
    harness(
        trusted(&[("k1", &key)]),
        spec.signed_by(&[("k1", &key)]),
        feed_installer,
    )
}

#[tokio::test]
async fn happy_path_check_download_verify_install() {
    let h = ready(&Spec::default());
    let rx = h.service.subscribe();

    assert_eq!(h.service.check_now().await, Ok(UpdatePhase::ReadyToInstall));
    let status = h.service.status();
    assert_eq!(status.phase, UpdatePhase::ReadyToInstall);
    assert_eq!(status.offer.unwrap().version, Version::new(1, 1, 0));
    assert!(rx.has_changed().unwrap(), "state changes are published");
    assert_eq!(h.store.0.lock().unwrap().last_check, Some(NOW));

    h.service.install_and_restart().await.unwrap();
    assert_eq!(h.service.status().phase, UpdatePhase::RestartRequired);
    assert_eq!(
        h.installer.applied.lock().unwrap().as_slice(),
        &[(Version::new(1, 1, 0), true)]
    );
    assert_eq!(
        h.store.0.lock().unwrap().applied_version.as_deref(),
        Some("1.1.0")
    );
    assert_eq!(
        h.service.install_and_restart().await,
        Err(UpdateError::NotReady)
    );
}

#[tokio::test]
async fn the_manifest_package_path_downloads_through_the_package_fetcher() {
    let key = signing_key();
    let h = harness(
        trusted(&[("k1", &key)]),
        Spec::default().signed_by(&[("k1", &key)]),
        FakeInstaller::feed_for_manifest_mode,
    );
    assert_eq!(h.installer.package_source(), PackageSource::Manifest);
    assert_eq!(h.service.check_now().await, Ok(UpdatePhase::ReadyToInstall));
    assert_eq!(h.packages.calls.load(Ordering::SeqCst), 1);
    assert_eq!(h.installer.downloads.load(Ordering::SeqCst), 0);
    h.service.install_and_restart().await.unwrap();
}

#[tokio::test]
async fn tampered_package_bytes_are_refused_and_deleted() {
    let key = signing_key();
    let h = harness(
        trusted(&[("k1", &key)]),
        Spec::default().signed_by(&[("k1", &key)]),
        FakeInstaller::feed_for_manifest_mode,
    );
    // Same length, one byte different: the feed hash check cannot see it, the file hash does.
    let mut tampered = PACKAGE.to_vec();
    tampered[3] ^= 1;
    *h.packages.bytes.lock().unwrap() = tampered;
    let error = h.service.check_now().await.unwrap_err();
    assert_eq!(error, UpdateError::Artifact(ArtifactError::HashMismatch));
    assert_eq!(h.service.status().phase, UpdatePhase::Failed);
    assert!(!h.dir.file("staging/aedst-update-1.1.0.pkg").exists());
    assert_eq!(
        h.service.install_and_restart().await,
        Err(UpdateError::NotReady)
    );
    assert!(h.installer.applied.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_package_of_the_wrong_size_is_refused() {
    let key = signing_key();
    let h = harness(
        trusted(&[("k1", &key)]),
        Spec::default().signed_by(&[("k1", &key)]),
        FakeInstaller::feed_for_manifest_mode,
    );
    *h.packages.bytes.lock().unwrap() = [PACKAGE, b"extra"].concat();
    assert!(matches!(
        h.service.check_now().await,
        Err(UpdateError::Artifact(ArtifactError::SizeMismatch { .. }))
    ));
}

#[tokio::test]
async fn a_feed_that_disagrees_with_the_signed_manifest_is_refused_before_download() {
    let key = signing_key();
    let keys = trusted(&[("k1", &key)]);
    let manifest = Spec::default().signed_by(&[("k1", &key)]);
    let evil = b"evil package".to_vec();
    let cases: Vec<(support::FeedCandidateEdit, FeedMismatch)> = vec![
        (
            Box::new(|c| c.sha256 = support::sha_hex(b"evil package")),
            FeedMismatch::Sha256,
        ),
        (
            Box::new(|c| c.version = "9.0.0".to_owned()),
            FeedMismatch::Version,
        ),
        (Box::new(|c| c.size += 1), FeedMismatch::Size),
        (
            Box::new(|c| c.file_name = "..\\evil.nupkg".to_owned()),
            FeedMismatch::FileName,
        ),
    ];
    for (edit, expected) in cases {
        let mut candidate = feed_candidate("1.1.0", PACKAGE);
        edit(&mut candidate);
        let h = harness(keys.clone(), manifest.clone(), |dir| {
            FakeInstaller::feed(Some(candidate), Some((dir.file("p/x.nupkg"), evil.clone())))
        });
        assert_eq!(
            h.service.check_now().await,
            Err(UpdateError::Feed(expected))
        );
        assert_eq!(
            h.installer.downloads.load(Ordering::SeqCst),
            0,
            "{expected:?}: nothing was downloaded"
        );
    }
    let empty = harness(keys, manifest, |_| FakeInstaller::feed(None, None));
    assert_eq!(
        empty.service.check_now().await,
        Err(UpdateError::Feed(FeedMismatch::NoCandidate))
    );
}

#[tokio::test]
async fn a_feed_package_whose_file_differs_from_the_manifest_is_refused() {
    let key = signing_key();
    let mut other = PACKAGE.to_vec();
    other[0] ^= 1;
    // The feed entry looks right (it repeats the signed hash) but the file on disk is not that package.
    let h = harness(
        trusted(&[("k1", &key)]),
        Spec::default().signed_by(&[("k1", &key)]),
        |dir| {
            FakeInstaller::feed(
                Some(feed_candidate("1.1.0", PACKAGE)),
                Some((dir.file("p/x.nupkg"), other)),
            )
        },
    );
    assert_eq!(
        h.service.check_now().await,
        Err(UpdateError::Artifact(ArtifactError::HashMismatch))
    );
    assert!(h.installer.applied.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_installer_that_hides_the_package_path_fails_closed() {
    let key = signing_key();
    let h = harness(
        trusted(&[("k1", &key)]),
        Spec::default().signed_by(&[("k1", &key)]),
        |_| FakeInstaller::feed(Some(feed_candidate("1.1.0", PACKAGE)), None),
    );
    assert_eq!(
        h.service.check_now().await,
        Err(UpdateError::Feed(FeedMismatch::NoPackagePath))
    );
}

#[tokio::test]
async fn refusals_of_the_manifest_reach_the_state_machine() {
    let key = signing_key();
    let other = signing_key();
    let keys = trusted(&[("k1", &key)]);

    let unsigned = harness(keys.clone(), Spec::default().signed_by(&[]), feed_installer);
    assert_eq!(
        unsigned.service.check_now().await,
        Err(UpdateError::Manifest(ManifestError::Unsigned))
    );
    assert_eq!(unsigned.service.status().phase, UpdatePhase::Failed);

    let wrong = harness(
        keys.clone(),
        Spec::default().signed_by(&[("k1", &other)]),
        feed_installer,
    );
    assert_eq!(
        wrong.service.check_now().await,
        Err(UpdateError::Manifest(ManifestError::BadSignature))
    );

    let beta = Spec {
        channel: "beta".to_owned(),
        ..Spec::default()
    };
    let channel = harness(
        keys.clone(),
        beta.signed_by(&[("k1", &key)]),
        feed_installer,
    );
    assert!(matches!(
        channel.service.check_now().await,
        Err(UpdateError::Policy(PolicyError::WrongChannel { .. }))
    ));

    let expired = Spec {
        expires_at: Some(NOW - 5),
        ..Spec::default()
    };
    let expired = harness(
        keys.clone(),
        expired.signed_by(&[("k1", &key)]),
        feed_installer,
    );
    assert_eq!(
        expired.service.check_now().await,
        Err(UpdateError::Policy(PolicyError::Expired))
    );

    let older = Spec {
        version: "0.9.0".to_owned(),
        ..Spec::default()
    };
    let down = harness(keys, older.signed_by(&[("k1", &key)]), feed_installer);
    assert_eq!(
        down.service.check_now().await,
        Err(UpdateError::Policy(PolicyError::DowngradeRefused))
    );
    assert_eq!(down.installer.downloads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_updater_without_keys_is_disabled_and_never_fetches() {
    let key = signing_key();
    let h = harness(
        TrustedKeys::default(),
        Spec::default().signed_by(&[("k1", &key)]),
        feed_installer,
    );
    assert_eq!(h.service.check_now().await, Err(UpdateError::Disabled));
    assert_eq!(h.manifests.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_insecure_manifest_url_is_refused_before_any_fetch() {
    let key = signing_key();
    let h = harness_with(
        trusted(&[("k1", &key)]),
        Spec::default().signed_by(&[("k1", &key)]),
        feed_installer,
        |cfg| cfg.manifest_url = "http://updates.example.com/stable.json".to_owned(),
    );
    assert!(matches!(
        h.service.check_now().await,
        Err(UpdateError::Url(_))
    ));
    assert_eq!(h.manifests.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rollback_protection_survives_across_checks() {
    let key = signing_key();
    let keys = trusted(&[("k1", &key)]);
    let h = harness(
        keys,
        Spec::default().signed_by(&[("k1", &key)]),
        feed_installer,
    );
    assert_eq!(h.service.check_now().await, Ok(UpdatePhase::ReadyToInstall));

    // An attacker replays an older, vulnerable manifest that is correctly signed (it is a real old release).
    let old = Spec {
        version: "1.0.5".to_owned(),
        published_at: NOW - 9000,
        ..Spec::default()
    };
    *h.manifests.body.lock().unwrap() = old.signed_by(&[("k1", &key)]);
    assert_eq!(
        h.service.check_now().await,
        Err(UpdateError::Policy(PolicyError::Replay))
    );
}

#[tokio::test]
async fn a_signed_rollback_is_installed_even_in_safe_mode() {
    let key = signing_key();
    let rollback = Spec {
        version: "0.9.0".to_owned(),
        rollback: true,
        ..Spec::default()
    };
    let h = harness_with(
        trusted(&[("k1", &key)]),
        rollback.signed_by(&[("k1", &key)]),
        |dir| {
            FakeInstaller::feed(
                Some(feed_candidate("0.9.0", PACKAGE)),
                Some((dir.file("p/x.nupkg"), PACKAGE.to_vec())),
            )
        },
        |_| {},
    );
    h.service.set_crash_loop(true);
    assert_eq!(h.service.check_now().await, Ok(UpdatePhase::ReadyToInstall));
    let offer = h.service.status().offer.unwrap();
    assert!(offer.rollback && offer.mandatory && offer.is_downgrade);
}

#[tokio::test]
async fn safe_mode_announces_ordinary_updates_without_downloading() {
    let h = ready(&Spec::default());
    h.service.set_crash_loop(true);
    assert_eq!(h.service.check_now().await, Ok(UpdatePhase::Available));
    assert!(h.service.status().crash_loop);
    assert_eq!(h.installer.downloads.load(Ordering::SeqCst), 0);
    assert_eq!(
        h.service.install_and_restart().await,
        Err(UpdateError::NotReady)
    );
}

#[tokio::test]
async fn a_report_only_install_announces_the_signed_offer() {
    let key = signing_key();
    let h = harness(
        trusted(&[("k1", &key)]),
        Spec::default().signed_by(&[("k1", &key)]),
        |_| FakeInstaller {
            self_update: false,
            ..FakeInstaller::manifest_mode()
        },
    );
    assert_eq!(h.service.check_now().await, Ok(UpdatePhase::Available));
    assert_eq!(h.packages.calls.load(Ordering::SeqCst), 0);
    // The real default for DEB/RPM/Flatpak.
    assert!(!aedst_update::Installer::can_self_update(
        &ReportOnlyInstaller
    ));
}

#[tokio::test]
async fn skipping_a_version_hides_it_until_it_is_mandatory() {
    let h = ready(&Spec::default());
    h.service.check_now().await.unwrap();
    h.service.skip_offered_version().unwrap();
    assert_eq!(h.service.status().phase, UpdatePhase::Idle);
    assert_eq!(h.service.check_now().await, Ok(UpdatePhase::UpToDate));

    let key = signing_key();
    let forced = Spec {
        min_supported: Some("1.0.5".to_owned()),
        ..Spec::default()
    };
    let m = harness(
        trusted(&[("k1", &key)]),
        forced.signed_by(&[("k1", &key)]),
        feed_installer,
    );
    m.store.0.lock().unwrap().skipped_version = Some("1.1.0".to_owned());
    assert_eq!(m.service.check_now().await, Ok(UpdatePhase::ReadyToInstall));
}

#[tokio::test(start_paused = true)]
async fn the_scheduler_checks_after_the_delay_then_on_the_interval() {
    let h = ready(&Spec {
        version: "1.0.0".to_owned(),
        ..Spec::default()
    });
    let (stop, shutdown) = tokio::sync::watch::channel(false);
    let timing = Timing {
        first_check_delay: Duration::from_secs(10),
        interval: Duration::from_secs(100),
    };
    let task = tokio::spawn(h.service.clone().run_scheduled(timing, shutdown));

    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(h.manifests.calls.load(Ordering::SeqCst), 0);
    tokio::time::sleep(Duration::from_secs(10)).await;
    assert_eq!(h.manifests.calls.load(Ordering::SeqCst), 1);
    tokio::time::sleep(Duration::from_secs(100)).await;
    assert_eq!(h.manifests.calls.load(Ordering::SeqCst), 2);

    stop.send(true).unwrap();
    task.await.unwrap();
}
