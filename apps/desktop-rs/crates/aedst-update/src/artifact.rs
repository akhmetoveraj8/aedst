//! Verifying a downloaded package against what the signed manifest promised.
//!
//! The file is read in 64 KiB chunks (constant memory), the size is capped while streaming so a file that grows
//! during hashing is caught, and the SHA-256 is compared in constant time. Nothing is installed from a file that
//! has not passed [`verify_file`].

use std::fs::File;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::hex;
use crate::manifest::{Artifact, MAX_ARTIFACT_BYTES};

const CHUNK: usize = 64 * 1024;

/// What the manifest says about the package file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Expected {
    /// SHA-256 of the file.
    pub sha256: [u8; 32],
    /// Exact size in bytes.
    pub size: u64,
}

impl From<&Artifact> for Expected {
    fn from(artifact: &Artifact) -> Self {
        Self {
            sha256: artifact.sha256,
            size: artifact.size,
        }
    }
}

/// Why a package was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArtifactError {
    /// The expected size is zero or above [`MAX_ARTIFACT_BYTES`].
    #[error("the expected package size is out of range")]
    SizeCap,
    /// The file is smaller or larger than the manifest says.
    #[error("the package size is {actual} bytes, the manifest says {expected}")]
    SizeMismatch {
        /// Size from the manifest.
        expected: u64,
        /// Size found.
        actual: u64,
    },
    /// The SHA-256 differs from the manifest.
    #[error("the package SHA-256 does not match the manifest")]
    HashMismatch,
    /// The file could not be read.
    #[error("cannot read the package: {0}")]
    Io(String),
}

/// Constant-time equality of two digests.
#[must_use]
pub fn digests_equal(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a.ct_eq(b).into()
}

/// Streams `reader` and checks size and SHA-256.
///
/// # Errors
/// [`ArtifactError`]; a size mismatch is reported before the hash is looked at.
pub fn verify_reader<R: Read>(mut reader: R, expected: &Expected) -> Result<(), ArtifactError> {
    if expected.size == 0 || expected.size > MAX_ARTIFACT_BYTES {
        return Err(ArtifactError::SizeCap);
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; CHUNK];
    let mut total: u64 = 0;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| ArtifactError::Io(e.to_string()))?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > expected.size {
            return Err(ArtifactError::SizeMismatch {
                expected: expected.size,
                actual: total,
            });
        }
        hasher.update(&buffer[..read]);
    }
    if total != expected.size {
        return Err(ArtifactError::SizeMismatch {
            expected: expected.size,
            actual: total,
        });
    }
    let digest: [u8; 32] = hasher.finalize().into();
    if digests_equal(&digest, &expected.sha256) {
        Ok(())
    } else {
        Err(ArtifactError::HashMismatch)
    }
}

/// [`verify_reader`] on a file; the length on disk is checked first so an oversized file is never read.
///
/// # Errors
/// [`ArtifactError`].
pub fn verify_file(path: &Path, expected: &Expected) -> Result<(), ArtifactError> {
    if expected.size == 0 || expected.size > MAX_ARTIFACT_BYTES {
        return Err(ArtifactError::SizeCap);
    }
    let file = File::open(path).map_err(|e| ArtifactError::Io(e.to_string()))?;
    let length = file
        .metadata()
        .map_err(|e| ArtifactError::Io(e.to_string()))?
        .len();
    if length != expected.size {
        return Err(ArtifactError::SizeMismatch {
            expected: expected.size,
            actual: length,
        });
    }
    verify_reader(file, expected)
}

/// Hex form of a digest for logs and messages.
#[must_use]
pub fn digest_hex(digest: &[u8; 32]) -> String {
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected_for(data: &[u8]) -> Expected {
        Expected {
            sha256: Sha256::digest(data).into(),
            size: data.len() as u64,
        }
    }

    #[test]
    fn matching_bytes_pass_and_any_change_fails() {
        let data = vec![7_u8; 200_000];
        let expected = expected_for(&data);
        assert_eq!(verify_reader(data.as_slice(), &expected), Ok(()));

        let mut flipped = data.clone();
        flipped[150_000] ^= 1;
        assert_eq!(
            verify_reader(flipped.as_slice(), &expected),
            Err(ArtifactError::HashMismatch)
        );
        assert!(matches!(
            verify_reader(&data[..data.len() - 1], &expected),
            Err(ArtifactError::SizeMismatch { .. })
        ));
        let mut longer = data.clone();
        longer.push(0);
        assert!(matches!(
            verify_reader(longer.as_slice(), &expected),
            Err(ArtifactError::SizeMismatch { .. })
        ));
    }

    #[test]
    fn the_size_cap_is_enforced_before_reading() {
        let too_big = Expected {
            sha256: [0; 32],
            size: MAX_ARTIFACT_BYTES + 1,
        };
        assert_eq!(
            verify_reader(&b""[..], &too_big),
            Err(ArtifactError::SizeCap)
        );
        let zero = Expected {
            sha256: [0; 32],
            size: 0,
        };
        assert_eq!(verify_reader(&b""[..], &zero), Err(ArtifactError::SizeCap));
    }
}
