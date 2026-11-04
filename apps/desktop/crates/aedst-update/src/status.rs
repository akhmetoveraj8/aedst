//! Configuration, observable state and errors of the update service.

use std::path::PathBuf;
use std::time::Duration;

use semver::Version;

use crate::artifact::ArtifactError;
use crate::policy::{PolicyError, UpdateOffer};
use crate::url_policy::UrlError;
use crate::verify::ManifestError;

/// What the service needs to know about this install.
#[derive(Debug, Clone)]
pub struct UpdateConfig {
    /// https URL of the signed manifest envelope for `channel`.
    pub manifest_url: String,
    /// The running version.
    pub installed_version: Version,
    /// `stable` or `beta`; manifests of any other channel are refused.
    pub channel: String,
    /// `windows`, `linux`, ... (matches the manifest's artifact `platform`).
    pub platform: String,
    /// `x86_64`, `arm64`, ...
    pub arch: String,
    /// Accept an older manifest without a rollback flag (explicit channel switch). Off by default.
    pub allow_downgrade: bool,
    /// Largest manifest envelope that is read.
    pub max_manifest_bytes: usize,
    /// Directory for packages the service downloads itself ([`crate::PackageSource::Manifest`]).
    pub staging_dir: PathBuf,
}

/// Check schedule: first after `first_check_delay`, then every `interval`. Call `check_now` as well when the
/// machine resumes from sleep (ADR-0036: a stale connection says nothing about whether the app is up to date).
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// Delay before the first check.
    pub first_check_delay: Duration,
    /// Time between checks.
    pub interval: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            first_check_delay: Duration::from_secs(120),
            interval: Duration::from_secs(6 * 60 * 60),
        }
    }
}

/// Where the update flow is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdatePhase {
    /// Nothing happened yet (or the offer was dismissed).
    Idle,
    /// Fetching and verifying the manifest.
    Checking,
    /// Nothing newer.
    UpToDate,
    /// Downloading the package.
    Downloading {
        /// 0..=100
        percent: u8,
    },
    /// Downloaded and verified; `install_and_restart` applies it.
    ReadyToInstall,
    /// A verified newer version exists but this install cannot (or, in safe mode, must not) replace itself.
    Available,
    /// The installer is scheduled to run when the app exits: quit now.
    RestartRequired,
    /// The last run failed; see `error`.
    Failed,
}

/// The state published on the `watch` channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateStatus {
    /// Current phase.
    pub phase: UpdatePhase,
    /// The offer in `Downloading`, `ReadyToInstall`, `Available` and `RestartRequired`.
    pub offer: Option<UpdateOffer>,
    /// Set in `Failed`.
    pub error: Option<UpdateError>,
    /// Safe mode: ordinary updates are announced but not applied; only a signed rollback is.
    pub crash_loop: bool,
}

impl UpdateStatus {
    pub(crate) fn idle() -> Self {
        Self {
            phase: UpdatePhase::Idle,
            offer: None,
            error: None,
            crash_loop: false,
        }
    }
}

/// The installer's feed disagrees with the signed manifest, or hides the package.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum FeedMismatch {
    /// The feed has no entry although the manifest announces a release.
    #[error("the installer feed offers nothing")]
    NoCandidate,
    /// Another version than the manifest's.
    #[error("the installer feed offers another version")]
    Version,
    /// Another SHA-256.
    #[error("the installer feed has another SHA-256")]
    Sha256,
    /// Another size.
    #[error("the installer feed has another size")]
    Size,
    /// A file name with a path in it.
    #[error("the installer feed names an unsafe file")]
    FileName,
    /// The installer did not say where the package is, so it cannot be hashed.
    #[error("the installer did not report the package path")]
    NoPackagePath,
}

/// Why a check, download or install failed. Strings are for logs; the UI picks its text from the variant.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UpdateError {
    /// No trusted signing key: the updater is off (fails closed).
    #[error("updates are disabled: no trusted signing key")]
    Disabled,
    /// Another run is active.
    #[error("an update run is already active")]
    Busy,
    /// `install_and_restart` without a verified package.
    #[error("no verified package is ready")]
    NotReady,
    /// Manifest or artifact URL refused.
    #[error("url: {0}")]
    Url(#[from] UrlError),
    /// Network failure.
    #[error("fetch: {0}")]
    Fetch(String),
    /// Unsigned, badly signed or malformed manifest.
    #[error("manifest: {0}")]
    Manifest(#[from] ManifestError),
    /// Channel, expiry, replay or rollback rule.
    #[error("policy: {0}")]
    Policy(#[from] PolicyError),
    /// The package does not match the manifest.
    #[error("package: {0}")]
    Artifact(#[from] ArtifactError),
    /// The installer's feed disagrees with the manifest.
    #[error("feed: {0}")]
    Feed(#[from] FeedMismatch),
    /// The installer failed.
    #[error("installer: {0}")]
    Installer(String),
    /// A state file could not be written.
    #[error("state: {0}")]
    State(String),
}
