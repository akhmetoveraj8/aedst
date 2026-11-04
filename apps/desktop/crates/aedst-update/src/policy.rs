//! The rules a correctly signed manifest must still satisfy before it is acted on.
//!
//! In order: channel, expiry, not published in the future, replay (`publishedAt` never goes backwards), version
//! never older than one already seen unless the manifest is a signed rollback. Then, against the installed
//! version: equal = up to date, older = refused unless it is a signed rollback (or the caller allows a downgrade,
//! the explicit "switch channel" flow). A signed rollback is mandatory.
//!
//! Split in two so the caller can record "seen" between the steps, like the Qt app: a manifest that passed
//! [`check_freshness`] is remembered even if [`decide`] then refuses it.

use semver::Version;
use url::Url;

use crate::manifest::{Artifact, Manifest};
use crate::store::PersistedState;

/// How far into the future a manifest may be dated (clock skew), in seconds.
pub const MAX_FUTURE_SKEW_SECS: i64 = 24 * 60 * 60;

/// Why a correctly signed manifest was not acted on.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PolicyError {
    /// The manifest belongs to another channel (blocks channel confusion).
    #[error("the manifest is for channel {found}, not {expected}")]
    WrongChannel {
        /// The configured channel.
        expected: String,
        /// The channel in the manifest.
        found: String,
    },
    /// `expiresAt` has passed.
    #[error("the manifest has expired")]
    Expired,
    /// `publishedAt` lies too far in the future.
    #[error("the manifest is dated in the future")]
    NotYetValid,
    /// `publishedAt` is older than a manifest already accepted.
    #[error("the manifest is older than one already seen (replay)")]
    Replay,
    /// The version is lower than one already seen and the manifest is not a signed rollback.
    #[error("the manifest version is older than one already seen")]
    OlderThanSeen,
    /// Older than the installed version without a signed rollback.
    #[error("the manifest is older than the installed version and is not a signed rollback")]
    DowngradeRefused,
    /// No package for this platform and architecture.
    #[error("the manifest has no package for this platform")]
    NoArtifact,
}

/// What the running client is and has seen.
#[derive(Debug, Clone)]
pub struct PolicyContext<'a> {
    /// The only channel accepted.
    pub channel: &'a str,
    /// The running version.
    pub installed: &'a Version,
    /// `windows`, `linux`, ...
    pub platform: &'a str,
    /// `x86_64`, `arm64`, ...
    pub arch: &'a str,
    /// Accept an older manifest without a rollback flag (explicit channel switch).
    pub allow_downgrade: bool,
    /// Current Unix time in seconds.
    pub now: i64,
    /// What earlier checks recorded.
    pub seen: &'a PersistedState,
}

/// A verified, applicable release.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateOffer {
    /// The offered version.
    pub version: Version,
    /// Channel it was published on.
    pub channel: String,
    /// Release notes.
    pub release_notes_url: Url,
    /// The package for this platform; url, hash and size are signed.
    pub artifact: Artifact,
    /// The user cannot postpone it (below `minSupportedVersion`, or a signed rollback away from a higher version).
    pub mandatory: bool,
    /// Older than the installed version.
    pub is_downgrade: bool,
    /// The manifest is an explicit signed rollback.
    pub rollback: bool,
    /// `publishedAt` of the manifest.
    pub published_at: i64,
}

/// Channel, expiry, future-dating, replay and "older than seen".
///
/// # Errors
/// [`PolicyError`] naming the rule.
pub fn check_freshness(manifest: &Manifest, ctx: &PolicyContext<'_>) -> Result<(), PolicyError> {
    if manifest.channel != ctx.channel {
        return Err(PolicyError::WrongChannel {
            expected: ctx.channel.to_owned(),
            found: manifest.channel.clone(),
        });
    }
    if manifest
        .expires_at
        .is_some_and(|expires| expires <= ctx.now)
    {
        return Err(PolicyError::Expired);
    }
    if manifest.published_at > ctx.now.saturating_add(MAX_FUTURE_SKEW_SECS) {
        return Err(PolicyError::NotYetValid);
    }
    if manifest.published_at < ctx.seen.last_seen_published_at {
        return Err(PolicyError::Replay);
    }
    let last_seen = ctx
        .seen
        .last_seen_version
        .as_deref()
        .and_then(|v| Version::parse(v).ok());
    if !manifest.rollback
        && last_seen.is_some_and(|seen| manifest.version.cmp_precedence(&seen).is_lt())
    {
        return Err(PolicyError::OlderThanSeen);
    }
    Ok(())
}

/// Compares with the installed version; `None` = already up to date.
///
/// # Errors
/// [`PolicyError::DowngradeRefused`] or [`PolicyError::NoArtifact`].
pub fn decide(
    manifest: &Manifest,
    ctx: &PolicyContext<'_>,
) -> Result<Option<UpdateOffer>, PolicyError> {
    // Build metadata does not take part in precedence; equal precedence is the same release.
    let order = manifest.version.cmp_precedence(ctx.installed);
    if order.is_eq() {
        return Ok(None);
    }
    let is_downgrade = order.is_lt();
    if is_downgrade && !ctx.allow_downgrade && !manifest.rollback {
        return Err(PolicyError::DowngradeRefused);
    }
    let artifact = manifest
        .artifact_for(ctx.platform, ctx.arch)
        .ok_or(PolicyError::NoArtifact)?
        .clone();
    Ok(Some(UpdateOffer {
        version: manifest.version.clone(),
        channel: manifest.channel.clone(),
        release_notes_url: manifest.release_notes_url.clone(),
        artifact,
        mandatory: ctx
            .installed
            .cmp_precedence(&manifest.min_supported_version)
            .is_lt()
            || (manifest.rollback && is_downgrade),
        is_downgrade,
        rollback: manifest.rollback,
        published_at: manifest.published_at,
    }))
}

/// The state to persist after a manifest passed [`check_freshness`].
#[must_use]
pub fn mark_seen(manifest: &Manifest, before: &PersistedState) -> PersistedState {
    PersistedState {
        last_seen_published_at: manifest.published_at,
        last_seen_version: Some(manifest.version.to_string()),
        ..before.clone()
    }
}
