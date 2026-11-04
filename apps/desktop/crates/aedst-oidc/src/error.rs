//! Errors of the sign-in flow. Messages never carry tokens, codes, states or verifiers.

/// Why a sign-in, refresh or sign-out failed.
#[derive(Debug, thiserror::Error)]
pub enum OidcError {
    /// The identity provider (or the network) could not be reached: the session is kept.
    #[error("identity provider unavailable: {0}")]
    Unavailable(String),
    /// The provider refused the grant (`invalid_grant` and friends): the session is over.
    #[error("sign-in rejected: {0}")]
    Rejected(String),
    /// The user cancelled the browser step.
    #[error("sign-in cancelled")]
    Cancelled,
    /// Nobody completed the browser step in time.
    #[error("sign-in timed out")]
    TimedOut,
    /// The provider configuration is unusable (not https, wrong issuer, no PKCE).
    #[error("invalid provider configuration: {0}")]
    Config(String),
    /// The OS keychain is unavailable. There is no file fallback.
    #[error("secure storage unavailable: {0}")]
    Keychain(String),
    /// A security check failed (forged callback, bad ID token, nonce mismatch).
    #[error("security check failed: {0}")]
    Security(String),
}

impl OidcError {
    /// True when the stored session must be dropped (the provider said the grant is dead).
    #[must_use]
    pub fn ends_session(&self) -> bool {
        matches!(self, Self::Rejected(_))
    }
}
