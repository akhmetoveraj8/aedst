//! A bearer token on every call, with exactly one refresh and one replay after `unauthenticated`
//! (identical to `docs/contract/behavior/session-refresh.json`).
//!
//! `connectrpc` interceptors are server-side, so the token goes in through the per-call options of
//! the generated clients (`*_with_options`): pass a closure that makes the call.
//!
//! Rules: a rejected request triggers one refresh and one replay; concurrent rejections share one
//! refresh (single flight lives in the token source); `invalid_grant` ends the session and the
//! request fails as `Unauthenticated` without a replay; a transient refresh failure keeps the
//! session and fails as `Retryable`; a replay that is rejected again does not refresh again.

use std::future::Future;

use aedst_oidc::{AccessToken, OidcError, OidcSession};
use connectrpc::{ConnectError, ErrorCode, client::CallOptions};
use futures::future::BoxFuture;

/// Why a token could not be had.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenFailure {
    /// The provider refused the grant: the session is over.
    SessionEnded,
    /// Temporary trouble (network, provider down): the session is kept.
    Transient,
}

/// Where bearer tokens come from. `OidcSession` is the production source.
pub trait TokenSource: Send + Sync {
    /// A usable access token (refreshed when about to expire).
    fn access_token(&self) -> BoxFuture<'_, Result<String, TokenFailure>>;
    /// Forces a refresh after the server rejected the token; concurrent callers share one request.
    fn refresh_after_rejection(&self) -> BoxFuture<'_, Result<String, TokenFailure>>;
}

fn classify(error: &OidcError) -> TokenFailure {
    if error.ends_session() {
        TokenFailure::SessionEnded
    } else {
        TokenFailure::Transient
    }
}

fn expose(token: &AccessToken) -> String {
    token.expose().to_owned()
}

impl TokenSource for OidcSession {
    fn access_token(&self) -> BoxFuture<'_, Result<String, TokenFailure>> {
        Box::pin(async move {
            OidcSession::access_token(self)
                .await
                .map(|t| expose(&t))
                .map_err(|e| classify(&e))
        })
    }

    fn refresh_after_rejection(&self) -> BoxFuture<'_, Result<String, TokenFailure>> {
        Box::pin(async move {
            OidcSession::refresh_after_rejection(self)
                .await
                .map(|t| expose(&t))
                .map_err(|e| classify(&e))
        })
    }
}

/// How an authenticated call failed.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// The session is over or the server still refuses the token: sign in again.
    #[error("unauthenticated")]
    Unauthenticated,
    /// Temporary failure while refreshing the token; try again later.
    #[error("temporarily unavailable")]
    Retryable,
    /// The server (or the transport) answered with an error.
    #[error(transparent)]
    Connect(ConnectError),
}

fn bearer(token: &str) -> CallOptions {
    // The value is never logged. An invalid header value (control characters) drops the header and the
    // server answers unauthenticated, which the caller sees as such.
    CallOptions::default().with_header("authorization", format!("Bearer {token}"))
}

/// Makes `call` with a bearer token, refreshing and replaying once on `unauthenticated`.
///
/// # Errors
/// [`ApiError`]: see the module rules.
pub async fn call_authenticated<T, F, Fut>(tokens: &dyn TokenSource, call: F) -> Result<T, ApiError>
where
    F: Fn(CallOptions) -> Fut,
    Fut: Future<Output = Result<T, ConnectError>>,
{
    let token = tokens.access_token().await.map_err(map_failure)?;
    match call(bearer(&token)).await {
        Err(error) if error.code == ErrorCode::Unauthenticated => {
            let fresh = tokens
                .refresh_after_rejection()
                .await
                .map_err(map_failure)?;
            match call(bearer(&fresh)).await {
                Err(again) if again.code == ErrorCode::Unauthenticated => {
                    Err(ApiError::Unauthenticated)
                }
                other => other.map_err(ApiError::Connect),
            }
        }
        other => other.map_err(ApiError::Connect),
    }
}

impl ApiError {
    /// The shared failure kind. `online` refines `unavailable`: with no connection it is `offline`.
    #[must_use]
    pub fn kind(&self, online: bool) -> aedst_common::ErrorKind {
        use aedst_common::ErrorKind;
        match self {
            Self::Unauthenticated => ErrorKind::Unauthenticated,
            Self::Retryable => ErrorKind::Unavailable,
            Self::Connect(error) => crate::error_kind::kind_of(error, online),
        }
    }
}

fn map_failure(failure: TokenFailure) -> ApiError {
    match failure {
        TokenFailure::SessionEnded => ApiError::Unauthenticated,
        TokenFailure::Transient => ApiError::Retryable,
    }
}
