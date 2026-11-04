//! What the client remembers between runs: replay protection, the last check, the skipped and the applied version.
//!
//! One small JSON file replaced atomically. A missing, oversized, unparsable or inconsistent file reads as the
//! default state (a first run); it never makes the updater fail and is overwritten by the next save.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub use crate::fsutil::StateError;
use crate::fsutil::{read_bounded, write_atomic};

/// The persisted update state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedState {
    /// Highest manifest `publishedAt` ever accepted (Unix seconds); 0 = none yet.
    pub last_seen_published_at: i64,
    /// Version of the newest manifest accepted so far.
    pub last_seen_version: Option<String>,
    /// When the last successful check finished (Unix seconds).
    pub last_check: Option<i64>,
    /// A version the user chose to skip (ignored for mandatory updates).
    pub skipped_version: Option<String>,
    /// The version the installer was last told to apply.
    pub applied_version: Option<String>,
}

/// Port: where [`PersistedState`] lives. Implementations must not panic on bad data.
pub trait UpdateStateStore: Send + Sync {
    /// The stored state, or the default when there is none or it is unusable.
    fn load(&self) -> PersistedState;

    /// Replaces the stored state.
    ///
    /// # Errors
    /// [`StateError`] when it cannot be written.
    fn save(&self, state: &PersistedState) -> Result<(), StateError>;
}

/// [`UpdateStateStore`] backed by one file.
#[derive(Debug, Clone)]
pub struct FileUpdateStateStore {
    path: PathBuf,
}

impl FileUpdateStateStore {
    /// A store at `path` (the directory is created on first save).
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl UpdateStateStore for FileUpdateStateStore {
    fn load(&self) -> PersistedState {
        let Some(bytes) = read_bounded(&self.path) else {
            return PersistedState::default();
        };
        serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "ignoring a corrupt update state file");
            PersistedState::default()
        })
    }

    fn save(&self, state: &PersistedState) -> Result<(), StateError> {
        let bytes = serde_json::to_vec(state).map_err(|e| StateError(e.to_string()))?;
        write_atomic(&self.path, &bytes)
    }
}
