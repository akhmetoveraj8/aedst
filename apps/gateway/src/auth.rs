//! Who a connecting client is. The gateway verifies no token itself (ADR-0026): it calls the Go
//! server's `RealtimeService.GetConnectionAccess` with the client's own token as the bearer. The
//! Go server checks it with its usual OIDC interceptor and answers with the owner id events are
//! addressed to and the instant the token expires. So there is one OIDC resource server (Go), and
//! no issuer, audience, key or algorithm setting here can drift from it.
//!
//! The token is a credential: it is only forwarded, never logged and never stored.
//!
//! The client's `X-Forwarded-For` is forwarded unchanged, so the gateway is a transparent hop for
//! the API: the Go server's failed-authentication budget (per client address, derived with
//! `AEDST_TRUSTED_PROXY_HOPS`) stays per client instead of being shared by everyone behind the
//! gateway. This holds when the same number of trusted proxies stands in front of the gateway as in
//! front of the API.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use connectrpc::client::{CallOptions, ClientConfig, HttpClient};
use connectrpc::{ConnectError, ErrorCode};
use thiserror::Error;

use crate::proto::aedst::realtime::v1::{
    GetConnectionAccessRequest, GetConnectionAccessResponse, RealtimeServiceClient,
};

/// Why a connection was not authenticated. The reason is logged, never sent to the client.
#[derive(Debug, Error)]
pub enum AuthError {
    /// The Go server refused the token (`unauthenticated` or `permission_denied`).
    #[error("token refused: {0}")]
    Refused(String),
    /// The client's address used up its failed-authentication budget (`resource_exhausted`).
    #[error("throttled: {0}")]
    Throttled(String),
    /// The Go server could not answer (down, timeout, an unexpected answer).
    #[error("api unavailable: {0}")]
    Unavailable(String),
}

/// The authenticated caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    /// The owner id events are addressed to (the recipient part of the NATS subject).
    pub user_id: String,
    /// The token's `exp` as seconds since the Unix epoch; the socket is closed at this instant.
    pub expires_at: u64,
}

/// Asks the Go server who the bearer of a token is.
pub struct Authenticator {
    client: RealtimeServiceClient<HttpClient>,
}

impl Authenticator {
    /// Builds the client for the API at `api_url`; no network call happens until the first socket.
    ///
    /// # Errors
    /// [`AuthError::Unavailable`] when `api_url` is not a URI.
    pub fn new(api_url: &str, timeout: Duration) -> Result<Self, AuthError> {
        let uri = api_url
            .parse()
            .map_err(|_| AuthError::Unavailable(format!("{api_url:?} is not a URI")))?;
        let config = ClientConfig::new(uri).with_default_timeout(timeout);
        Ok(Self {
            client: RealtimeServiceClient::new(HttpClient::plaintext(), config),
        })
    }

    /// Returns the caller that `token` belongs to. `forwarded_for` is the client request's
    /// `X-Forwarded-For`, passed on unchanged.
    ///
    /// # Errors
    /// [`AuthError::Refused`] when the Go server rejects the token, [`AuthError::Throttled`] when the
    /// client is over its failure budget, [`AuthError::Unavailable`] when the server cannot be asked.
    pub async fn authenticate(
        &self,
        token: &str,
        forwarded_for: Option<&str>,
    ) -> Result<Principal, AuthError> {
        let mut options =
            CallOptions::default().with_header("authorization", format!("Bearer {token}"));
        if let Some(value) = forwarded_for {
            options = options.with_header("x-forwarded-for", value);
        }
        let response = self
            .client
            .get_connection_access_with_options(GetConnectionAccessRequest::default(), options)
            .await
            .map_err(|error| classify(&error))?;
        principal_from(&response.into_owned())
    }
}

/// Maps a failed call: a refused token (401) and a used-up failure budget (429) are the client's;
/// anything else is ours (503).
#[must_use]
pub fn classify(error: &ConnectError) -> AuthError {
    match error.code {
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied => {
            AuthError::Refused(error.to_string())
        }
        ErrorCode::ResourceExhausted => AuthError::Throttled(error.to_string()),
        _ => AuthError::Unavailable(error.to_string()),
    }
}

/// Reads the caller from the answer. An answer without a user id or expiry is a server fault.
///
/// # Errors
/// [`AuthError::Unavailable`] for an incomplete answer.
pub fn principal_from(response: &GetConnectionAccessResponse) -> Result<Principal, AuthError> {
    if response.user_id.is_empty() {
        return Err(AuthError::Unavailable("the answer has no user id".into()));
    }
    let expires_at = response
        .expires_at
        .as_option()
        .and_then(|at| u64::try_from(at.seconds).ok())
        .filter(|seconds| *seconds > 0)
        .ok_or_else(|| AuthError::Unavailable("the answer has no expiry".into()))?;
    Ok(Principal {
        user_id: response.user_id.clone(),
        expires_at,
    })
}

/// Seconds since the Unix epoch (0 if the clock is before it).
#[must_use]
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
