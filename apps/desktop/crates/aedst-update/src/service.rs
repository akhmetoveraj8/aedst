//! The update flow as a state machine published on a `tokio::sync::watch`.
//!
//! ```text
//! Idle -> Checking -> UpToDate
//!                  -> Available        (this install cannot self-update, or safe mode: only announced)
//!                  -> Downloading -> ReadyToInstall -> RestartRequired
//!                  -> Failed
//! ```
//!
//! `check_now` does, in order: URL policy, fetch (size capped), Ed25519 verification, channel / expiry / replay /
//! rollback rules, persisting what was seen, comparison with the installed version, then (when the installer can
//! replace this install and safe mode allows it) binding the installer's feed entry to the manifest, downloading,
//! and an independent size + SHA-256 check of the package file against the signed manifest. Nothing is installed
//! by itself: the user presses "Restart to update" (`install_and_restart`), which verifies the file once more.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use semver::Version;
use tokio::sync::{Mutex as AsyncMutex, watch};

use crate::artifact::{self, Expected};
use crate::bind::{bind_feed, staged_name};
use crate::policy::{self, PolicyContext, UpdateOffer};
use crate::ports::{
    Installer, ManifestFetcher, PackageFetcher, PackageSource, ProgressFn, VerifiedPackage,
};
use crate::status::{FeedMismatch, Timing, UpdateConfig, UpdateError, UpdatePhase, UpdateStatus};
use crate::store::{PersistedState, UpdateStateStore};
use crate::url_policy::validate_url;
use crate::verify::{TrustedKeys, verify_manifest};

/// Unix seconds now; injectable for tests.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// The wall clock.
#[must_use]
pub fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|d| i64::try_from(d.as_secs()).ok())
            .unwrap_or(0)
    })
}

/// Everything the service talks to.
#[derive(Clone)]
pub struct Ports {
    /// Manifest transport.
    pub manifests: Arc<dyn ManifestFetcher>,
    /// Package transport for [`PackageSource::Manifest`].
    pub packages: Arc<dyn PackageFetcher>,
    /// Installer (Velopack in production, report-only by default).
    pub installer: Arc<dyn Installer>,
    /// Replay protection and bookkeeping.
    pub store: Arc<dyn UpdateStateStore>,
    /// Time source.
    pub clock: Clock,
}

struct Pending {
    offer: UpdateOffer,
    package: VerifiedPackage,
}

/// See the module documentation.
pub struct UpdateService {
    config: UpdateConfig,
    keys: TrustedKeys,
    ports: Ports,
    status: Arc<watch::Sender<UpdateStatus>>,
    run: AsyncMutex<()>,
    pending: Mutex<Option<Pending>>,
    crash_loop: AtomicBool,
}

impl UpdateService {
    /// A service. With an empty `keys` set every check fails closed with [`UpdateError::Disabled`].
    #[must_use]
    pub fn new(config: UpdateConfig, keys: TrustedKeys, ports: Ports) -> Self {
        Self {
            config,
            keys,
            ports,
            status: Arc::new(watch::channel(UpdateStatus::idle()).0),
            run: AsyncMutex::new(()),
            pending: Mutex::new(None),
            crash_loop: AtomicBool::new(false),
        }
    }

    /// Observes the state machine.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<UpdateStatus> {
        self.status.subscribe()
    }

    /// The current state.
    #[must_use]
    pub fn status(&self) -> UpdateStatus {
        self.status.borrow().clone()
    }

    /// Safe mode (from `StartupHealthGuard`): ordinary updates are announced but not downloaded or applied;
    /// only a signed rollback is.
    pub fn set_crash_loop(&self, crash_loop: bool) {
        self.crash_loop.store(crash_loop, Ordering::SeqCst);
        self.status.send_modify(|s| s.crash_loop = crash_loop);
    }

    /// Forgets a non-mandatory notification; the next check shows it again.
    pub fn dismiss(&self) {
        self.status.send_modify(|s| {
            let postponable = s.offer.as_ref().is_some_and(|o| !o.mandatory);
            if postponable
                && matches!(
                    s.phase,
                    UpdatePhase::Available | UpdatePhase::ReadyToInstall
                )
            {
                s.phase = UpdatePhase::Idle;
                s.offer = None;
            }
        });
    }

    /// Remembers that the user does not want the offered version (ignored for mandatory updates).
    ///
    /// # Errors
    /// [`UpdateError::State`] when the choice cannot be stored.
    pub fn skip_offered_version(&self) -> Result<(), UpdateError> {
        let Some(offer) = self.status().offer.filter(|o| !o.mandatory) else {
            return Ok(());
        };
        let mut state = self.ports.store.load();
        state.skipped_version = Some(offer.version.to_string());
        self.ports
            .store
            .save(&state)
            .map_err(|e| UpdateError::State(e.0))?;
        self.dismiss();
        Ok(())
    }

    fn publish(&self, phase: UpdatePhase, offer: Option<UpdateOffer>, error: Option<UpdateError>) {
        let crash_loop = self.crash_loop.load(Ordering::SeqCst);
        self.status.send_replace(UpdateStatus {
            phase,
            offer,
            error,
            crash_loop,
        });
    }

    fn pending_slot(&self) -> std::sync::MutexGuard<'_, Option<Pending>> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs one check (and, when allowed, the download). Returns the phase it ended in.
    ///
    /// # Errors
    /// [`UpdateError`]; the phase is then `Failed`, except for `Disabled` and `Busy`, which change nothing.
    pub async fn check_now(&self) -> Result<UpdatePhase, UpdateError> {
        if self.keys.is_empty() {
            return Err(UpdateError::Disabled);
        }
        let Ok(_guard) = self.run.try_lock() else {
            return Err(UpdateError::Busy);
        };
        self.publish(UpdatePhase::Checking, None, None);
        *self.pending_slot() = None;
        match self.run_check().await {
            Ok(phase) => Ok(phase),
            Err(error) => {
                tracing::warn!(%error, "update check failed");
                self.publish(UpdatePhase::Failed, None, Some(error.clone()));
                Err(error)
            }
        }
    }

    async fn run_check(&self) -> Result<UpdatePhase, UpdateError> {
        let cfg = &self.config;
        let url = validate_url(&cfg.manifest_url)?;
        let body = self
            .ports
            .manifests
            .fetch(&url, cfg.max_manifest_bytes)
            .await
            .map_err(|e| UpdateError::Fetch(e.0))?;
        if body.len() > cfg.max_manifest_bytes {
            return Err(UpdateError::Fetch("manifest response too large".to_owned()));
        }
        let manifest = verify_manifest(&body, &self.keys)?;

        let now = (self.ports.clock)();
        let seen = self.ports.store.load();
        let ctx = PolicyContext {
            channel: &cfg.channel,
            installed: &cfg.installed_version,
            platform: &cfg.platform,
            arch: &cfg.arch,
            allow_downgrade: cfg.allow_downgrade,
            now,
            seen: &seen,
        };
        policy::check_freshness(&manifest, &ctx)?;
        let mut next = policy::mark_seen(&manifest, &seen);
        next.last_check = Some(now);
        self.ports
            .store
            .save(&next)
            .map_err(|e| UpdateError::State(e.0))?;

        let Some(offer) = policy::decide(&manifest, &ctx)? else {
            self.publish(UpdatePhase::UpToDate, None, None);
            return Ok(UpdatePhase::UpToDate);
        };
        if !offer.mandatory && skipped(&next, &offer.version) {
            self.publish(UpdatePhase::UpToDate, None, None);
            return Ok(UpdatePhase::UpToDate);
        }
        let safe_mode_blocks = self.crash_loop.load(Ordering::SeqCst) && !offer.rollback;
        if !self.ports.installer.can_self_update() || safe_mode_blocks {
            self.publish(UpdatePhase::Available, Some(offer), None);
            return Ok(UpdatePhase::Available);
        }
        self.publish(
            UpdatePhase::Downloading { percent: 0 },
            Some(offer.clone()),
            None,
        );
        let package = self.obtain_package(&offer).await?;
        *self.pending_slot() = Some(Pending {
            offer: offer.clone(),
            package,
        });
        self.publish(UpdatePhase::ReadyToInstall, Some(offer), None);
        Ok(UpdatePhase::ReadyToInstall)
    }

    fn progress(&self) -> ProgressFn {
        let status = Arc::clone(&self.status);
        Arc::new(move |percent| {
            status.send_modify(|s| {
                if matches!(s.phase, UpdatePhase::Downloading { .. }) {
                    s.phase = UpdatePhase::Downloading {
                        percent: percent.min(100),
                    };
                }
            });
        })
    }

    async fn obtain_package(&self, offer: &UpdateOffer) -> Result<VerifiedPackage, UpdateError> {
        let expected = Expected::from(&offer.artifact);
        let installer = &self.ports.installer;
        let (path, candidate) = match installer.package_source() {
            PackageSource::InstallerFeed => {
                let allow = offer.rollback || self.config.allow_downgrade;
                let candidate = installer
                    .check_feed(&self.config.channel, allow)
                    .await
                    .map_err(|e| UpdateError::Installer(e.0))?
                    .ok_or(FeedMismatch::NoCandidate)?;
                bind_feed(offer, &candidate)?;
                let path = installer
                    .download(&candidate, self.progress())
                    .await
                    .map_err(|e| UpdateError::Installer(e.0))?
                    .ok_or(FeedMismatch::NoPackagePath)?;
                (path, Some(candidate))
            }
            PackageSource::Manifest => {
                let dest = self.config.staging_dir.join(staged_name(&offer.version));
                self.ports
                    .packages
                    .fetch_to_file(&offer.artifact.url, &dest, expected.size, self.progress())
                    .await
                    .map_err(|e| UpdateError::Fetch(e.0))?;
                (dest, None)
            }
        };
        verify_blocking(path.clone(), expected).await?;
        Ok(VerifiedPackage {
            version: offer.version.clone(),
            path,
            candidate,
        })
    }

    /// Hands the verified package to the installer, to be applied when the app exits, and restarts into it.
    /// The package is verified once more first. The caller must quit the application when this returns `Ok`.
    ///
    /// # Errors
    /// [`UpdateError::NotReady`] outside `ReadyToInstall`; verification or installer failures.
    pub async fn install_and_restart(&self) -> Result<(), UpdateError> {
        let Ok(_guard) = self.run.try_lock() else {
            return Err(UpdateError::Busy);
        };
        if self.status().phase != UpdatePhase::ReadyToInstall {
            return Err(UpdateError::NotReady);
        }
        let Some(pending) = self.pending_slot().take() else {
            return Err(UpdateError::NotReady);
        };
        let result = async {
            verify_blocking(
                pending.package.path.clone(),
                Expected::from(&pending.offer.artifact),
            )
            .await?;
            self.ports
                .installer
                .apply(&pending.package, true)
                .await
                .map_err(|e| UpdateError::Installer(e.0))?;
            let mut state = self.ports.store.load();
            state.applied_version = Some(pending.offer.version.to_string());
            self.ports
                .store
                .save(&state)
                .map_err(|e| UpdateError::State(e.0))
        }
        .await;
        match result {
            Ok(()) => {
                self.publish(UpdatePhase::RestartRequired, Some(pending.offer), None);
                Ok(())
            }
            Err(error) => {
                tracing::warn!(%error, "installing the update failed");
                self.publish(UpdatePhase::Failed, None, Some(error.clone()));
                Err(error)
            }
        }
    }

    /// Checks after `first_check_delay`, then every `interval`, until `shutdown` changes or is dropped.
    /// A package that is already downloaded is not replaced by a new run.
    pub async fn run_scheduled(
        self: Arc<Self>,
        timing: Timing,
        mut shutdown: watch::Receiver<bool>,
    ) {
        let mut delay = timing.first_check_delay;
        loop {
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                _ = shutdown.changed() => return,
            }
            if *shutdown.borrow() {
                return;
            }
            let waiting = matches!(
                self.status().phase,
                UpdatePhase::ReadyToInstall | UpdatePhase::RestartRequired
            );
            if !waiting {
                // Failures are published as `Failed` and logged; the next tick tries again.
                let _ = self.check_now().await;
            }
            delay = timing.interval;
        }
    }
}

fn skipped(state: &PersistedState, version: &Version) -> bool {
    state.skipped_version.as_deref() == Some(version.to_string().as_str())
}

async fn verify_blocking(path: std::path::PathBuf, expected: Expected) -> Result<(), UpdateError> {
    let cleanup = path.clone();
    let outcome = tokio::task::spawn_blocking(move || artifact::verify_file(&path, &expected))
        .await
        .map_err(|e| artifact::ArtifactError::Io(e.to_string()))?;
    if outcome.is_err() {
        // A package that failed verification is never kept for another try.
        let _ = tokio::fs::remove_file(&cleanup).await;
    }
    Ok(outcome?)
}
