//! The update manifest: what the release key vouches for.
//!
//! JSON, camelCase. Required: `version` (semver), `channel` (`[a-z0-9-]{1,32}`), `releaseNotesUrl` (https),
//! `publishedAt` (positive Unix seconds), `artifacts` (1..=32 entries). Optional: `minSupportedVersion` (semver,
//! default `0.0.0`), `rollback` (default false), `expiresAt` (Unix seconds; NEW compared with the Qt app, which only
//! had `publishedAt`). Unknown fields are ignored so a newer release tool can add fields.
//!
//! Each artifact has `platform` and `arch` (`[a-z0-9_]{1,16}`), an https `url`, a lowercase 64-hex `sha256` and a
//! `size` in `1..=MAX_ARTIFACT_BYTES`. A platform/arch pair may appear once. The optional per-artifact `signature`
//! of the Qt manifest is not read: the manifest signature already covers url, hash and size.

use semver::Version;
use serde::Deserialize;
use url::Url;

use crate::hex;
use crate::url_policy::validate_url;

/// Largest package the updater accepts (4 GiB).
pub const MAX_ARTIFACT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// Most artifacts one manifest may list.
pub const MAX_ARTIFACTS: usize = 32;

/// One downloadable package for a platform and architecture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Artifact {
    /// `windows`, `linux`, ...
    pub platform: String,
    /// `x86_64`, `arm64`, ...
    pub arch: String,
    /// Where the package can be fetched (policy-checked).
    pub url: Url,
    /// SHA-256 of the package file.
    pub sha256: [u8; 32],
    /// Exact size of the package file in bytes.
    pub size: u64,
}

/// A validated manifest. Only [`crate::verify_manifest`] produces one from untrusted bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    /// The release this manifest offers.
    pub version: Version,
    /// `stable` or `beta` (any `[a-z0-9-]{1,32}` is syntactically valid).
    pub channel: String,
    /// Where the release notes live.
    pub release_notes_url: Url,
    /// Packages per platform.
    pub artifacts: Vec<Artifact>,
    /// Installed versions below this must update.
    pub min_supported_version: Version,
    /// Unix seconds; the replay and rollback ordering key.
    pub published_at: i64,
    /// Unix seconds after which the manifest is refused; `None` = never.
    pub expires_at: Option<i64>,
    /// A deliberate, signed rollback to `version`.
    pub rollback: bool,
}

impl Manifest {
    /// The artifact for exactly this platform and architecture.
    #[must_use]
    pub fn artifact_for(&self, platform: &str, arch: &str) -> Option<&Artifact> {
        self.artifacts
            .iter()
            .find(|a| a.platform == platform && a.arch == arch)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawManifest {
    version: String,
    channel: String,
    release_notes_url: String,
    published_at: i64,
    artifacts: Vec<RawArtifact>,
    min_supported_version: Option<String>,
    rollback: Option<bool>,
    expires_at: Option<i64>,
}

#[derive(Deserialize)]
struct RawArtifact {
    platform: String,
    arch: String,
    url: String,
    sha256: String,
    size: u64,
}

fn token(text: &str, max: usize, allow_dash: bool) -> bool {
    !text.is_empty()
        && text.len() <= max
        && text.bytes().all(|b| {
            b.is_ascii_lowercase()
                || b.is_ascii_digit()
                || (if allow_dash { b == b'-' } else { b == b'_' })
        })
}

/// Parses and validates manifest JSON. Does not check any signature.
///
/// # Errors
/// A description of the first rule the document breaks.
pub(crate) fn parse_manifest(bytes: &[u8]) -> Result<Manifest, String> {
    let raw: RawManifest =
        serde_json::from_slice(bytes).map_err(|e| format!("not a manifest: {e}"))?;
    let version = Version::parse(&raw.version).map_err(|_| "version is not semver".to_owned())?;
    let min_supported_version = match raw.min_supported_version.as_deref() {
        None => Version::new(0, 0, 0),
        Some(text) => {
            Version::parse(text).map_err(|_| "minSupportedVersion is not semver".to_owned())?
        }
    };
    if !token(&raw.channel, 32, true) {
        return Err("channel must be [a-z0-9-]{1,32}".to_owned());
    }
    let release_notes_url =
        validate_url(&raw.release_notes_url).map_err(|e| format!("releaseNotesUrl: {e}"))?;
    if raw.published_at <= 0 {
        return Err("publishedAt must be a positive Unix time".to_owned());
    }
    if raw.expires_at.is_some_and(|e| e <= raw.published_at) {
        return Err("expiresAt must be after publishedAt".to_owned());
    }
    if raw.artifacts.is_empty() || raw.artifacts.len() > MAX_ARTIFACTS {
        return Err("artifacts must list 1..=32 packages".to_owned());
    }
    let mut artifacts: Vec<Artifact> = Vec::with_capacity(raw.artifacts.len());
    for item in raw.artifacts {
        if !token(&item.platform, 16, false) || !token(&item.arch, 16, false) {
            return Err("artifact platform/arch must be [a-z0-9_]{1,16}".to_owned());
        }
        if artifacts
            .iter()
            .any(|a| a.platform == item.platform && a.arch == item.arch)
        {
            return Err("duplicate platform/arch artifact".to_owned());
        }
        if item.size == 0 || item.size > MAX_ARTIFACT_BYTES {
            return Err("artifact size is out of range".to_owned());
        }
        if item.sha256.bytes().any(|b| b.is_ascii_uppercase()) {
            return Err("artifact sha256 must be lowercase hex".to_owned());
        }
        let sha256 =
            hex::decode_fixed::<32>(&item.sha256).ok_or("artifact sha256 is not 64 hex digits")?;
        let url = validate_url(&item.url).map_err(|e| format!("artifact url: {e}"))?;
        artifacts.push(Artifact {
            platform: item.platform,
            arch: item.arch,
            url,
            sha256,
            size: item.size,
        });
    }
    Ok(Manifest {
        version,
        channel: raw.channel,
        release_notes_url,
        artifacts,
        min_supported_version,
        published_at: raw.published_at,
        expires_at: raw.expires_at,
        rollback: raw.rollback.unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(extra: &str) -> String {
        format!(
            r#"{{"version":"1.2.0","channel":"stable","releaseNotesUrl":"https://example.com/n",
            "publishedAt":1000,"artifacts":[{{"platform":"windows","arch":"x86_64",
            "url":"https://example.com/a.nupkg","sha256":"{}","size":10}}]{extra}}}"#,
            "ab".repeat(32)
        )
    }

    #[test]
    fn a_minimal_manifest_gets_its_defaults() {
        let m = parse_manifest(json("").as_bytes()).unwrap();
        assert_eq!(m.min_supported_version, Version::new(0, 0, 0));
        assert!(!m.rollback);
        assert_eq!(m.expires_at, None);
        assert!(m.artifact_for("windows", "x86_64").is_some());
        assert!(m.artifact_for("linux", "x86_64").is_none());
    }

    #[test]
    fn unknown_fields_are_ignored_and_bad_ones_refused() {
        assert!(parse_manifest(json(r#","future":1"#).as_bytes()).is_ok());
        for bad in [
            r#","expiresAt":500"#,
            r#","minSupportedVersion":"x""#,
            r#","rollback":"yes""#,
        ] {
            assert!(parse_manifest(json(bad).as_bytes()).is_err(), "{bad}");
        }
        assert!(parse_manifest(b"{}").is_err());
        assert!(parse_manifest(b"not json").is_err());
        let http = json("").replace("https://example.com/a.nupkg", "http://example.com/a.nupkg");
        assert!(parse_manifest(http.as_bytes()).is_err());
        let zero = json("").replace("\"size\":10", "\"size\":0");
        assert!(parse_manifest(zero.as_bytes()).is_err());
        let upper = json("").replace(&"ab".repeat(32), &"AB".repeat(32));
        assert!(parse_manifest(upper.as_bytes()).is_err());
        let channel = json("").replace("stable", "Stable!");
        assert!(parse_manifest(channel.as_bytes()).is_err());
    }
}
