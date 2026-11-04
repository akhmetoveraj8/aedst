//! Reading a Velopack feed entry (`releases.<channel>.json` or one asset object of it).
//!
//! The fields the app binds to (`aedst_update::bind_feed`) are `Version`, `SHA256`, `Size` and `FileName`. The
//! legacy `RELEASES` text file carries SHA-1 only and is refused: the manifest needs a SHA-256.

use semver::Version;
use serde::Deserialize;

use crate::error::ReleaseError;
use crate::hex;

/// What the manifest needs from the feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FeedEntry {
    pub(crate) version: Version,
    pub(crate) sha256: String,
    pub(crate) size: u64,
    pub(crate) file_name: String,
}

#[derive(Deserialize)]
struct RawEntry {
    #[serde(rename = "Version")]
    version: String,
    #[serde(rename = "FileName")]
    file_name: String,
    #[serde(rename = "SHA256")]
    sha256: Option<String>,
    #[serde(rename = "Size")]
    size: u64,
    #[serde(rename = "Type")]
    kind: Option<String>,
}

#[derive(Deserialize)]
struct RawFeed {
    #[serde(rename = "Assets")]
    assets: Vec<RawEntry>,
}

fn feed_err(text: impl Into<String>) -> ReleaseError {
    ReleaseError::Feed(text.into())
}

fn is_full(kind: Option<&str>) -> bool {
    kind.is_none_or(|k| k.eq_ignore_ascii_case("full"))
}

fn convert(raw: RawEntry) -> Result<FeedEntry, ReleaseError> {
    let version = Version::parse(&raw.version).map_err(|_| feed_err("Version is not semver"))?;
    let sha256 = raw
        .sha256
        .ok_or_else(|| feed_err("no SHA256 field (a legacy RELEASES line has only SHA-1)"))?
        .to_ascii_lowercase();
    if hex::decode_fixed::<32>(&sha256).is_none() {
        return Err(feed_err("SHA256 is not 64 hex digits"));
    }
    if raw.size == 0 {
        return Err(feed_err("Size is zero"));
    }
    if !aedst_update::is_plain_file_name(&raw.file_name) {
        return Err(feed_err("FileName is not a plain file name"));
    }
    Ok(FeedEntry {
        version,
        sha256,
        size: raw.size,
        file_name: raw.file_name,
    })
}

fn check_version(entry: FeedEntry, version: &Version) -> Result<FeedEntry, ReleaseError> {
    if entry.version.cmp_precedence(version).is_ne() {
        return Err(feed_err(format!(
            "entry version {} differs from --version {version}",
            entry.version
        )));
    }
    Ok(entry)
}

/// Picks the full-package entry for `version` from the file content.
pub(crate) fn parse_feed_entry(text: &str, version: &Version) -> Result<FeedEntry, ReleaseError> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| {
        feed_err("not JSON (the legacy text RELEASES format has no SHA-256 and is not supported)")
    })?;
    if value.get("Assets").is_some() {
        let feed: RawFeed =
            serde_json::from_value(value).map_err(|e| feed_err(format!("bad feed: {e}")))?;
        let mut matching = feed.assets.into_iter().filter(|a| {
            is_full(a.kind.as_deref())
                && Version::parse(&a.version).is_ok_and(|v| v.cmp_precedence(version).is_eq())
        });
        let first = matching.next().ok_or_else(|| {
            feed_err(format!("no full package for version {version} in the feed"))
        })?;
        if matching.next().is_some() {
            return Err(feed_err(format!(
                "several full packages for version {version}"
            )));
        }
        return convert(first).and_then(|e| check_version(e, version));
    }
    let raw: RawEntry =
        serde_json::from_value(value).map_err(|e| feed_err(format!("bad entry: {e}")))?;
    if !is_full(raw.kind.as_deref()) {
        return Err(feed_err("the entry is not a full package"));
    }
    convert(raw).and_then(|e| check_version(e, version))
}
