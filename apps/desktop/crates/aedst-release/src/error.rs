//! The tool's error type. Messages never contain key material.

use std::path::Path;

/// Why a subcommand failed. `Usage` errors are the caller's mistake (exit code 2), the rest exit with 1.
#[derive(Debug, thiserror::Error)]
pub enum ReleaseError {
    /// Wrong command line.
    #[error("{0}")]
    Usage(String),
    /// A file could not be read or written.
    #[error("{what}: {source}")]
    Io {
        /// What was being done, with the path.
        what: String,
        /// The OS error.
        #[source]
        source: std::io::Error,
    },
    /// The private key file or a public key is unusable (the content is never echoed).
    #[error("{0}")]
    Key(String),
    /// The Velopack feed entry is unusable.
    #[error("feed entry: {0}")]
    Feed(String),
    /// The manifest is something the app would refuse, or an input of it is invalid.
    #[error("manifest: {0}")]
    Manifest(String),
    /// The app's own verifier refused the envelope.
    #[error("envelope refused: {0}")]
    Verify(#[from] aedst_update::ManifestError),
}

impl ReleaseError {
    pub(crate) fn usage(text: impl Into<String>) -> Self {
        Self::Usage(text.into())
    }

    pub(crate) fn io(action: &str, path: &Path, source: std::io::Error) -> Self {
        Self::Io {
            what: format!("{action} {}", path.display()),
            source,
        }
    }

    /// Process exit code for this error.
    #[must_use]
    pub fn exit_code(&self) -> u8 {
        if matches!(self, Self::Usage(_)) { 2 } else { 1 }
    }
}
