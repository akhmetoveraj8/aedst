//! Crash-loop detection ("safe mode").
//!
//! Every start counts as unhealthy until the application says otherwise: [`StartupHealthGuard::mark_healthy`]
//! after it has been up and usable for a while, or on a clean exit. After [`CRASH_LOOP_THRESHOLD`] starts in a row
//! that never became healthy the report says `crash_loop`: the owner then stops applying ordinary updates and
//! reports it; only a signed rollback manifest moves the user off the broken build.
//!
//! A start under a different version than the stored one (an update, or a rollback) begins with a clean count,
//! but remembers the last version that proved itself healthy. The state is one small JSON file replaced atomically;
//! a corrupt file reads as "no history". Not safe for two processes at once (the app is single-instance).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::fsutil::{StateError, read_bounded, write_atomic};

/// Unhealthy starts in a row that mean "the build is broken".
pub const CRASH_LOOP_THRESHOLD: u32 = 3;
const COUNTER_CAP: u32 = 1000;

/// What earlier runs say about this one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthReport {
    /// Starts of this version in a row that never became healthy, this one included.
    pub unhealthy_starts: u32,
    /// [`CRASH_LOOP_THRESHOLD`] or more: start in safe mode.
    pub crash_loop: bool,
    /// First start since this version was installed.
    pub first_start_of_this_version: bool,
    /// The last version that reached "healthy" (the rollback target an operator would pick).
    pub last_known_good: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct HealthState {
    version: String,
    unhealthy_starts: u32,
    last_known_good: Option<String>,
}

/// See the module documentation.
#[derive(Debug, Clone)]
pub struct StartupHealthGuard {
    path: PathBuf,
    current_version: String,
}

impl StartupHealthGuard {
    /// A guard for the running `current_version`, keeping its state in `path`.
    #[must_use]
    pub fn new(path: PathBuf, current_version: impl Into<String>) -> Self {
        Self {
            path,
            current_version: current_version.into(),
        }
    }

    fn load(&self) -> HealthState {
        read_bounded(&self.path)
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, state: &HealthState) -> Result<(), StateError> {
        let bytes = serde_json::to_vec(state).map_err(|e| StateError(e.to_string()))?;
        write_atomic(&self.path, &bytes)
    }

    /// Counts this start; call it first thing in `main`.
    ///
    /// # Errors
    /// [`StateError`] when the count cannot be stored (the caller logs it and carries on).
    pub fn record_start(&self) -> Result<HealthReport, StateError> {
        let mut state = self.load();
        let first = state.version != self.current_version;
        if first {
            state.version.clone_from(&self.current_version);
            state.unhealthy_starts = 0;
        }
        state.unhealthy_starts = state.unhealthy_starts.saturating_add(1).min(COUNTER_CAP);
        let report = HealthReport {
            unhealthy_starts: state.unhealthy_starts,
            crash_loop: state.unhealthy_starts >= CRASH_LOOP_THRESHOLD,
            first_start_of_this_version: first,
            last_known_good: state.last_known_good.clone(),
        };
        self.save(&state)?;
        Ok(report)
    }

    /// The running version works: resets the count and remembers it as the last known good one.
    /// Call it once the window has been usable for a while, or on a clean exit; never from a crash path.
    ///
    /// # Errors
    /// [`StateError`] when the state cannot be stored.
    pub fn mark_healthy(&self) -> Result<(), StateError> {
        self.save(&HealthState {
            version: self.current_version.clone(),
            unhealthy_starts: 0,
            last_known_good: Some(self.current_version.clone()),
        })
    }
}
