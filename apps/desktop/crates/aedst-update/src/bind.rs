//! Binding the installer's feed to the signed manifest.
//!
//! Velopack has no publisher signature for packages, so its release feed is not trusted. A feed entry is accepted
//! only if its version, SHA-256 and size equal what the signed manifest declares; a feed that disagrees (a
//! compromised or misconfigured update server) is refused before anything is downloaded.

use semver::Version;

use crate::artifact::digests_equal;
use crate::hex;
use crate::policy::UpdateOffer;
use crate::ports::FeedCandidate;
use crate::status::FeedMismatch;

/// Checks a feed entry against the offer taken from the signed manifest.
///
/// # Errors
/// The first [`FeedMismatch`] found.
pub fn bind_feed(offer: &UpdateOffer, candidate: &FeedCandidate) -> Result<(), FeedMismatch> {
    let version = Version::parse(&candidate.version).map_err(|_| FeedMismatch::Version)?;
    if version.cmp_precedence(&offer.version).is_ne() {
        return Err(FeedMismatch::Version);
    }
    let digest = hex::decode_fixed::<32>(&candidate.sha256).ok_or(FeedMismatch::Sha256)?;
    if !digests_equal(&digest, &offer.artifact.sha256) {
        return Err(FeedMismatch::Sha256);
    }
    if candidate.size != offer.artifact.size {
        return Err(FeedMismatch::Size);
    }
    if !is_plain_file_name(&candidate.file_name) {
        return Err(FeedMismatch::FileName);
    }
    Ok(())
}

/// A single path component with no separators, drive letters or parent references.
#[must_use]
pub fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.chars().any(char::is_control)
}

/// File name of a package the service downloads itself.
#[must_use]
pub fn staged_name(version: &Version) -> String {
    let safe: String = version
        .to_string()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("aedst-update-{safe}.pkg")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_cannot_escape_the_package_directory() {
        assert!(is_plain_file_name("Aedst-1.2.0-full.nupkg"));
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:x", "x\0y", "a\nb"] {
            assert!(!is_plain_file_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn staged_names_are_filesystem_safe() {
        let v = Version::parse("1.2.0-beta.1+build.5").unwrap();
        assert_eq!(
            staged_name(&Version::new(1, 2, 0)),
            "aedst-update-1.2.0.pkg"
        );
        assert_eq!(staged_name(&v), "aedst-update-1.2.0-beta.1_build.5.pkg");
    }
}
