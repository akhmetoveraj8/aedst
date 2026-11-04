//! `manifest`: builds the manifest JSON the app expects from a Velopack feed entry.

use std::path::Path;

use chrono::DateTime;
use semver::Version;
use url::Url;

use crate::args::Flags;
use crate::error::ReleaseError;
use crate::feed::parse_feed_entry;
use crate::{Output, check, fsio};

const DAY: i64 = 86_400;

const VALUED: &[&str] = &[
    "version",
    "channel",
    "feed-entry",
    "published-at",
    "expires-in-days",
    "base-url",
    "notes-url",
    "platform",
    "arch",
    "min-supported",
    "out",
];

fn manifest_err(text: impl Into<String>) -> ReleaseError {
    ReleaseError::Manifest(text.into())
}

fn published_at(text: &str) -> Result<i64, ReleaseError> {
    if text == "now" {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| manifest_err("the system clock is before 1970"))?;
        return i64::try_from(now.as_secs()).map_err(|_| manifest_err("clock out of range"));
    }
    DateTime::parse_from_rfc3339(text)
        .map(|t| t.timestamp())
        .map_err(|_| ReleaseError::usage("--published-at must be `now` or an RFC 3339 time"))
}

fn package_url(base: &str, file_name: &str) -> Result<String, ReleaseError> {
    let mut url = Url::parse(base).map_err(|_| ReleaseError::usage("--base-url is not a URL"))?;
    url.path_segments_mut()
        .map_err(|()| ReleaseError::usage("--base-url cannot be a base"))?
        .pop_if_empty()
        .push(file_name);
    Ok(url.into())
}

fn expiry(flags: &Flags, published: i64) -> Result<Option<i64>, ReleaseError> {
    let Some(days) = flags.optional("expires-in-days") else {
        return Ok(None);
    };
    let days: i64 = days
        .parse()
        .ok()
        .filter(|d| (1..=3650).contains(d))
        .ok_or_else(|| ReleaseError::usage("--expires-in-days must be 1..=3650"))?;
    Ok(Some(published + days * DAY))
}

/// `manifest ...`.
pub(crate) fn run(args: &[String]) -> Result<Output, ReleaseError> {
    let flags = Flags::parse(args, VALUED, &["rollback"])?;
    let version = Version::parse(flags.required("version")?)
        .map_err(|_| ReleaseError::usage("--version is not semver"))?;
    let channel = flags.required("channel")?;
    if !matches!(channel, "stable" | "beta") {
        return Err(ReleaseError::usage("--channel must be stable or beta"));
    }
    let published = published_at(flags.required("published-at")?)?;
    let expires = expiry(&flags, published)?;
    let feed_text = fsio::read_text(Path::new(flags.required("feed-entry")?), 4 * 1024 * 1024)?;
    let entry = parse_feed_entry(&feed_text, &version)?;
    let mut doc = serde_json::json!({
        "version": version.to_string(),
        "channel": channel,
        "releaseNotesUrl": flags.required("notes-url")?,
        "publishedAt": published,
        "artifacts": [{
            "platform": flags.optional("platform").unwrap_or("windows"),
            "arch": flags.optional("arch").unwrap_or("x86_64"),
            "url": package_url(flags.required("base-url")?, &entry.file_name)?,
            "sha256": entry.sha256,
            "size": entry.size,
        }],
    });
    if let Some(expires) = expires {
        doc["expiresAt"] = expires.into();
    }
    if let Some(min) = flags.optional("min-supported") {
        let min = Version::parse(min)
            .map_err(|_| ReleaseError::usage("--min-supported is not semver"))?;
        doc["minSupportedVersion"] = min.to_string().into();
    }
    if flags.switch("rollback") {
        doc["rollback"] = true.into();
    }
    let payload = doc.to_string();
    check::manifest_structure(&payload)?;
    let out = Path::new(flags.required("out")?);
    fsio::create_new(out, payload.as_bytes(), false)?;
    let mut output = Output::default();
    output.line(format!("manifest={}", out.display()));
    output.line(format!("version={version}"));
    output.line(format!("channel={channel}"));
    output.line(format!("sha256={}", entry.sha256));
    output.line(format!("size={}", entry.size));
    output.line(format!("published-at={published}"));
    Ok(output)
}
