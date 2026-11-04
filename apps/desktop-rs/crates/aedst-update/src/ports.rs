//! Ports of the update service. Production adapters: [`crate::http`] (fetchers) and
//! [`crate::velopack_installer`] (installer); tests use fakes.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures::future::BoxFuture;
use semver::Version;
use url::Url;

/// Download progress in percent (0..=100); may be called from any thread.
pub type ProgressFn = Arc<dyn Fn(u8) + Send + Sync>;

/// A fetch failed. The message is for logs, never shown to the user.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct FetchError(pub String);

/// The installer failed or cannot do what was asked.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct InstallerError(pub String);

/// Fetches the signed manifest envelope.
pub trait ManifestFetcher: Send + Sync {
    /// The response body of `url`, at most `max_bytes` (more is an error).
    fn fetch<'a>(
        &'a self,
        url: &'a Url,
        max_bytes: usize,
    ) -> BoxFuture<'a, Result<Vec<u8>, FetchError>>;
}

/// Streams a package to a file.
pub trait PackageFetcher: Send + Sync {
    /// Writes the body of `url` to `dest` (replacing it), at most `max_bytes`, reporting progress.
    /// The caller verifies the file; the fetcher does not decide whether it is genuine.
    fn fetch_to_file<'a>(
        &'a self,
        url: &'a Url,
        dest: &'a Path,
        max_bytes: u64,
        progress: ProgressFn,
    ) -> BoxFuture<'a, Result<(), FetchError>>;
}

/// What the installer's own release feed says about the package it would install. The feed is only a
/// transport: the signed manifest decides which exact package may be installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeedCandidate {
    /// Version string of the feed entry.
    pub version: String,
    /// SHA-256 hex of the package (either case).
    pub sha256: String,
    /// Size in bytes.
    pub size: u64,
    /// File name of the package in the installer's package directory.
    pub file_name: String,
}

/// Where the package to install comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageSource {
    /// The installer downloads from its own feed (Velopack); the service binds the feed entry to the manifest and
    /// re-hashes the file the installer reports.
    InstallerFeed,
    /// The service downloads the manifest's artifact URL through the [`PackageFetcher`] and hands the verified file
    /// to [`Installer::apply`].
    Manifest,
}

/// A package that passed verification and is ready to be applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedPackage {
    /// The version it installs.
    pub version: Version,
    /// The verified file.
    pub path: PathBuf,
    /// The feed entry it came from, for [`PackageSource::InstallerFeed`].
    pub candidate: Option<FeedCandidate>,
}

/// Downloads and installs a package.
pub trait Installer: Send + Sync {
    /// True only when this process runs from an installation the installer can replace (a Velopack install).
    /// Portable, development, DEB/RPM and Flatpak runs cannot; the service then only reports the signed offer.
    fn can_self_update(&self) -> bool;

    /// Where packages come from; the default is the installer's own feed.
    fn package_source(&self) -> PackageSource {
        PackageSource::InstallerFeed
    }

    /// The entry of the installer's feed for `channel`; `None` = nothing different from what is installed.
    /// `allow_downgrade` is set for a signed rollback.
    fn check_feed<'a>(
        &'a self,
        channel: &'a str,
        allow_downgrade: bool,
    ) -> BoxFuture<'a, Result<Option<FeedCandidate>, InstallerError>>;

    /// Downloads the candidate. Returns where the package file is, so the service can hash it itself; `None`
    /// means the installer cannot say, and the service then refuses to install (fail closed).
    fn download<'a>(
        &'a self,
        candidate: &'a FeedCandidate,
        progress: ProgressFn,
    ) -> BoxFuture<'a, Result<Option<PathBuf>, InstallerError>>;

    /// Installs the package when this process exits and, if asked, starts the new version. Returns at once; the
    /// caller must then quit the application.
    fn apply<'a>(
        &'a self,
        package: &'a VerifiedPackage,
        restart: bool,
    ) -> BoxFuture<'a, Result<(), InstallerError>>;
}

/// The default installer: this installation cannot replace itself (repository or portable installs), so the
/// service announces a signed offer and the package manager does the update.
#[derive(Debug, Clone, Copy, Default)]
pub struct ReportOnlyInstaller;

impl Installer for ReportOnlyInstaller {
    fn can_self_update(&self) -> bool {
        false
    }

    fn check_feed<'a>(
        &'a self,
        _channel: &'a str,
        _allow_downgrade: bool,
    ) -> BoxFuture<'a, Result<Option<FeedCandidate>, InstallerError>> {
        Box::pin(async {
            Err(InstallerError(
                "this installation updates through its package manager".to_owned(),
            ))
        })
    }

    fn download<'a>(
        &'a self,
        _candidate: &'a FeedCandidate,
        _progress: ProgressFn,
    ) -> BoxFuture<'a, Result<Option<PathBuf>, InstallerError>> {
        Box::pin(async {
            Err(InstallerError(
                "report-only installer cannot download".to_owned(),
            ))
        })
    }

    fn apply<'a>(
        &'a self,
        _package: &'a VerifiedPackage,
        _restart: bool,
    ) -> BoxFuture<'a, Result<(), InstallerError>> {
        Box::pin(async {
            Err(InstallerError(
                "report-only installer cannot apply".to_owned(),
            ))
        })
    }
}
