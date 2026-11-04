//! The thirteen error kinds every client classifies a failure into
//! (`docs/contract/behavior/error-kinds.json`).
//!
//! UI, retry policy and crash reporting decide by kind, never by parsing a message. The UI shows
//! the translated message of the KIND, never the raw server message.

/// One of the shared failure kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ErrorKind {
    /// The session is over or the token was refused.
    Unauthenticated,
    /// Signed in but not allowed.
    Forbidden,
    /// The thing does not exist (or is not visible).
    NotFound,
    /// The request was refused as invalid.
    InvalidInput,
    /// A concurrent change won (version mismatch, duplicate).
    Conflict,
    /// Too many requests.
    RateLimited,
    /// The server could not answer now.
    Unavailable,
    /// No usable connection.
    Offline,
    /// A client-side deadline passed.
    Timeout,
    /// The user (or the caller) cancelled: never shown as an error.
    Cancelled,
    /// This build is too old for the server.
    UpgradeRequired,
    /// A local database failure.
    Storage,
    /// Anything else.
    Unknown,
}

/// What an outbox handler derives from a kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutboxVerdict {
    /// Record an attempt and stop the run.
    Retry,
    /// Park the item and continue.
    Permanent,
    /// Stop the run without counting an attempt.
    Blocked,
}

/// A failure with no Connect code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    /// No connection.
    Offline,
    /// A client-side deadline.
    Timeout,
    /// The caller aborted.
    Aborted,
    /// A local database failure.
    Storage,
}

/// The reason string of `google.rpc.ErrorInfo` that means "update the app".
pub const UPGRADE_REQUIRED_REASON: &str = "CLIENT_UPGRADE_REQUIRED";

impl ErrorKind {
    /// Maps a Connect error code name (`permission_denied`, `canceled`, ...) and the optional
    /// `ErrorInfo` reason. `failed_precondition` with `CLIENT_UPGRADE_REQUIRED` is
    /// [`ErrorKind::UpgradeRequired`]; unknown names are [`ErrorKind::Unknown`].
    #[must_use]
    pub fn from_code(code: &str, reason: Option<&str>) -> Self {
        match code {
            "canceled" => Self::Cancelled,
            "invalid_argument" | "out_of_range" => Self::InvalidInput,
            "failed_precondition" if reason == Some(UPGRADE_REQUIRED_REASON) => {
                Self::UpgradeRequired
            }
            "failed_precondition" => Self::InvalidInput,
            "deadline_exceeded" => Self::Timeout,
            "not_found" => Self::NotFound,
            "already_exists" | "aborted" => Self::Conflict,
            "permission_denied" => Self::Forbidden,
            "resource_exhausted" => Self::RateLimited,
            "unavailable" => Self::Unavailable,
            "unauthenticated" => Self::Unauthenticated,
            _ => Self::Unknown, // unknown, unimplemented, internal, data_loss and anything new
        }
    }

    /// Maps a failure that carries no Connect code.
    #[must_use]
    pub fn from_transport(transport: Transport) -> Self {
        match transport {
            Transport::Offline => Self::Offline,
            Transport::Timeout => Self::Timeout,
            Transport::Aborted => Self::Cancelled,
            Transport::Storage => Self::Storage,
        }
    }

    /// The same request may succeed later, so backoff or the outbox may try again.
    #[must_use]
    pub fn retryable(self) -> bool {
        matches!(
            self,
            Self::RateLimited | Self::Unavailable | Self::Offline | Self::Timeout
        )
    }

    /// Worth a crash-reporter event (a bug or a storage fault). Expected states are control flow.
    #[must_use]
    pub fn reportable(self) -> bool {
        matches!(self, Self::Storage | Self::Unknown)
    }

    /// The verdict an offline-outbox handler derives from this kind.
    #[must_use]
    pub fn outbox_verdict(self) -> OutboxVerdict {
        match self {
            Self::Unauthenticated | Self::UpgradeRequired => OutboxVerdict::Blocked,
            Self::RateLimited
            | Self::Unavailable
            | Self::Offline
            | Self::Timeout
            | Self::Cancelled => OutboxVerdict::Retry,
            Self::Forbidden
            | Self::NotFound
            | Self::InvalidInput
            | Self::Conflict
            | Self::Storage
            | Self::Unknown => OutboxVerdict::Permanent,
        }
    }

    /// The camelCase name used by the shared fixture and the translation keys
    /// (`common.errors.kinds.<name>`).
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Unauthenticated => "unauthenticated",
            Self::Forbidden => "forbidden",
            Self::NotFound => "notFound",
            Self::InvalidInput => "invalidInput",
            Self::Conflict => "conflict",
            Self::RateLimited => "rateLimited",
            Self::Unavailable => "unavailable",
            Self::Offline => "offline",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
            Self::UpgradeRequired => "upgradeRequired",
            Self::Storage => "storage",
            Self::Unknown => "unknown",
        }
    }

    /// Every kind, for exhaustive tests and pickers.
    pub const ALL: [Self; 13] = [
        Self::Unauthenticated,
        Self::Forbidden,
        Self::NotFound,
        Self::InvalidInput,
        Self::Conflict,
        Self::RateLimited,
        Self::Unavailable,
        Self::Offline,
        Self::Timeout,
        Self::Cancelled,
        Self::UpgradeRequired,
        Self::Storage,
        Self::Unknown,
    ];
}
