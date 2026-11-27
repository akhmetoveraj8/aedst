//! Errors of the local database.

/// Why a database call failed. Messages never include row contents.
#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    /// SQLite reported an error.
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// The file was written by a newer build; this build refuses to touch it.
    #[error("database schema {found} is newer than this build supports ({supported})")]
    TooNew {
        /// `user_version` found in the file.
        found: u32,
        /// Highest version this build knows.
        supported: u32,
    },
    /// The database thread is gone (the handle was closed or the thread panicked).
    #[error("database thread is not running")]
    Closed,
    /// The file could not be opened or prepared.
    #[error("cannot open database: {0}")]
    Open(String),
    /// A sealed value could not be opened: it was changed, truncated or sealed with another key.
    #[error("a stored value cannot be decrypted")]
    Sealed,
}
