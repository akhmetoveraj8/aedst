//! Self-update: the Ed25519-signed manifest is the authority, the installer's feed is only a transport.
//!
//! Layers, all UI-free:
//!
//! - [`verify`] / [`manifest`] / [`policy`]: the signed envelope, a rotating key set, and the rules a signed
//!   manifest must still satisfy (channel, expiry, replay, rollback).
//! - [`artifact`] / [`url_policy`]: streaming size + SHA-256 verification, and the https-only URL policy.
//! - [`health`] / [`store`]: crash-loop safe mode and the persisted update state, both tolerant of corrupt files.
//! - [`ports`] / [`service`]: `UpdateService` with `ManifestFetcher`, `PackageFetcher` and `Installer` ports and a
//!   `tokio::sync::watch` state machine. [`http`] and [`velopack_installer`] are the production adapters.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod artifact;
mod bind;
mod fsutil;
pub mod health;
mod hex;
pub mod http;
pub mod manifest;
pub mod policy;
pub mod ports;
pub mod service;
pub mod status;
pub mod store;
pub mod url_policy;
pub mod velopack_installer;
pub mod verify;

pub use artifact::{ArtifactError, Expected, verify_file, verify_reader};
pub use bind::{bind_feed, is_plain_file_name};
pub use health::{CRASH_LOOP_THRESHOLD, HealthReport, StartupHealthGuard};
pub use http::HttpFetcher;
pub use manifest::{Artifact, MAX_ARTIFACT_BYTES, Manifest};
pub use policy::{PolicyContext, PolicyError, UpdateOffer, check_freshness, decide, mark_seen};
pub use ports::{
    FeedCandidate, FetchError, Installer, InstallerError, ManifestFetcher, PackageFetcher,
    PackageSource, ProgressFn, ReportOnlyInstaller, VerifiedPackage,
};
pub use service::{Clock, Ports, UpdateService, system_clock};
pub use status::{FeedMismatch, Timing, UpdateConfig, UpdateError, UpdatePhase, UpdateStatus};
pub use store::{FileUpdateStateStore, PersistedState, StateError, UpdateStateStore};
pub use url_policy::{UrlError, check_redirect, validate_url};
pub use velopack_installer::{VelopackInstaller, velopack_startup};
pub use verify::{
    KeyError, ManifestError, SIGNING_PREFIX, TrustedKeys, signing_input, verify_manifest,
};
