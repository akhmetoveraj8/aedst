//! Production [`Installer`] over the `velopack` crate.
//!
//! COMPILE-CHECKED ONLY: nothing here has run against a real Velopack installation (that needs a package made
//! by `vpk pack`, installed by its setup). Written against `velopack` 1.2.161:
//!
//! - `UpdateManager::new(HttpSource, Some(UpdateOptions), None)` fails unless the process runs from a Velopack
//!   install; that failure is what [`Installer::can_self_update`] reports as false.
//! - `check_for_updates` -> `UpdateCheck::UpdateAvailable(UpdateInfo)`; the info is kept for download and apply.
//! - `download_updates(&info, Some(Sender<i16>))` verifies the package against the FEED's SHA-256 itself and
//!   leaves it in the locator's packages directory under `TargetFullRelease.FileName`. Unlike the Qt SDK, the Rust
//!   crate exposes that directory (`locator::auto_locate_app_manifest(..).get_packages_dir()`), so the service can
//!   hash the file itself against the SIGNED manifest.
//! - `wait_exit_then_apply_updates(info, silent, restart, [])` starts the updater, which waits for this process
//!   to exit. (`apply_updates_and_restart` calls `exit(0)` at once, which would skip our shutdown.)
//!
//! Velopack's own HTTP client (ureq) fetches the feed and package; the feed URL passes the URL policy here, but
//! Velopack's redirect handling is not ours. The signed manifest, not the feed, is the authority.
//! The app's `main` must call [`velopack_startup`] first.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError, mpsc};

use futures::future::BoxFuture;
use velopack::locator::{LocationContext, auto_locate_app_manifest};
use velopack::sources::HttpSource;
use velopack::{UpdateCheck, UpdateInfo, UpdateManager, UpdateOptions, VelopackApp};

use crate::bind::is_plain_file_name;
use crate::ports::{FeedCandidate, Installer, InstallerError, ProgressFn, VerifiedPackage};
use crate::url_policy::validate_url;

/// Velopack's startup hook. Call it first in `main`: in some situations (install, uninstall, an update just
/// applied) it terminates or restarts the process.
pub fn velopack_startup() {
    VelopackApp::build().run();
}

/// [`Installer`] backed by a Velopack installation and an HTTP release feed.
pub struct VelopackInstaller {
    feed_url: String,
    last: Arc<Mutex<Option<UpdateInfo>>>,
}

impl VelopackInstaller {
    /// An installer reading releases from `feed_url` (the directory holding `releases.<channel>.json`).
    ///
    /// # Errors
    /// [`InstallerError`] when the feed URL breaks the transport policy.
    pub fn new(feed_url: &str) -> Result<Self, InstallerError> {
        validate_url(feed_url).map_err(|e| InstallerError(format!("feed url: {e}")))?;
        Ok(Self {
            feed_url: feed_url.to_owned(),
            last: Arc::new(Mutex::new(None)),
        })
    }

    fn manager(
        &self,
        channel: &str,
        allow_downgrade: bool,
    ) -> Result<UpdateManager, InstallerError> {
        let options = UpdateOptions {
            AllowVersionDowngrade: allow_downgrade,
            ExplicitChannel: (!channel.is_empty()).then(|| channel.to_owned()),
            ..UpdateOptions::default()
        };
        UpdateManager::new(HttpSource::new(&self.feed_url), Some(options), None)
            .map_err(|e| InstallerError(e.to_string()))
    }
}

fn spawn_error(e: impl std::fmt::Display) -> InstallerError {
    InstallerError(format!("installer task failed: {e}"))
}

impl Installer for VelopackInstaller {
    fn can_self_update(&self) -> bool {
        auto_locate_app_manifest(LocationContext::FromCurrentExe).is_ok()
    }

    fn check_feed<'a>(
        &'a self,
        channel: &'a str,
        allow_downgrade: bool,
    ) -> BoxFuture<'a, Result<Option<FeedCandidate>, InstallerError>> {
        Box::pin(async move {
            let manager = self.manager(channel, allow_downgrade)?;
            let checked = tokio::task::spawn_blocking(move || manager.check_for_updates())
                .await
                .map_err(spawn_error)?
                .map_err(|e| InstallerError(e.to_string()))?;
            let mut slot = self.last.lock().unwrap_or_else(PoisonError::into_inner);
            match checked {
                UpdateCheck::UpdateAvailable(info) => {
                    let target = &info.TargetFullRelease;
                    let candidate = FeedCandidate {
                        version: target.Version.clone(),
                        sha256: target.SHA256.clone(),
                        size: target.Size,
                        file_name: target.FileName.clone(),
                    };
                    *slot = Some(*info);
                    Ok(Some(candidate))
                }
                UpdateCheck::RemoteIsEmpty | UpdateCheck::NoUpdateAvailable => {
                    *slot = None;
                    Ok(None)
                }
            }
        })
    }

    fn download<'a>(
        &'a self,
        candidate: &'a FeedCandidate,
        progress: ProgressFn,
    ) -> BoxFuture<'a, Result<Option<PathBuf>, InstallerError>> {
        Box::pin(async move {
            if !is_plain_file_name(&candidate.file_name) {
                return Err(InstallerError("unsafe package file name".to_owned()));
            }
            let info = self
                .last
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone()
                .ok_or_else(|| {
                    InstallerError("download requested before a feed check".to_owned())
                })?;
            if info.TargetFullRelease.FileName != candidate.file_name {
                return Err(InstallerError(
                    "candidate does not match the checked feed entry".to_owned(),
                ));
            }
            // The channel is only needed for the feed; downloading uses the stored entry.
            let manager = self.manager("", info.IsDowngrade)?;
            let locator = auto_locate_app_manifest(LocationContext::FromCurrentExe)
                .map_err(|e| InstallerError(e.to_string()))?;
            let path = locator.get_packages_dir().join(&candidate.file_name);
            let (sender, receiver) = mpsc::channel::<i16>();
            let forwarder = std::thread::spawn(move || {
                for percent in receiver {
                    progress(u8::try_from(percent.clamp(0, 100)).unwrap_or(100));
                }
            });
            let outcome =
                tokio::task::spawn_blocking(move || manager.download_updates(&info, Some(sender)))
                    .await
                    .map_err(spawn_error)?;
            let _ = forwarder.join();
            outcome.map_err(|e| InstallerError(e.to_string()))?;
            Ok(Some(path))
        })
    }

    fn apply<'a>(
        &'a self,
        package: &'a VerifiedPackage,
        restart: bool,
    ) -> BoxFuture<'a, Result<(), InstallerError>> {
        Box::pin(async move {
            let info = self
                .last
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone()
                .ok_or_else(|| InstallerError("nothing was downloaded".to_owned()))?;
            let manager = self.manager("", info.IsDowngrade)?;
            tokio::task::spawn_blocking(move || {
                manager.wait_exit_then_apply_updates(&info, true, restart, Vec::<String>::new())
            })
            .await
            .map_err(spawn_error)?
            .map_err(|e| InstallerError(format!("{}: {e}", package.version)))
        })
    }
}
