//! The signed-in session: access token in memory, refresh token in the keychain.
//!
//! Refresh is single-flight (any number of callers share one token request) and fenced by an
//! epoch: a refresh result that arrives after `sign_out` is discarded, so it cannot resurrect the
//! session. Network failures keep the session; `invalid_grant` and friends end it.

use std::{
    fmt,
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use openidconnect::{
    OAuth2TokenResponse, RefreshToken, RevocationUrl, core::CoreRevocableToken,
    reqwest::redirect::Policy,
};
use tokio::{sync::Mutex as AsyncMutex, task::spawn_blocking, time::Instant};
use url::Url;
use zeroize::Zeroizing;

use crate::{
    config::OidcConfig,
    error::OidcError,
    provider::Provider,
    store::{RefreshTokenStore, StoredSession},
};

/// Refresh this long before the access token expires.
const EXPIRY_SKEW: Duration = Duration::from_secs(60);
/// Token endpoint requests are not retried; this bounds each one.
pub(crate) const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

/// A bearer access token. Wiped on drop, redacted in `Debug`.
#[derive(Clone)]
pub struct AccessToken(Zeroizing<String>);

impl AccessToken {
    /// The token text, for an `Authorization: Bearer` header. Never log it.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AccessToken(<redacted>)")
    }
}

/// What happened to the refresh token at the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Revocation {
    /// The provider has no revocation endpoint, or discovery was not possible.
    #[default]
    NotAttempted,
    /// The provider accepted the revocation.
    Revoked,
    /// The request could not be made or failed (logged); the local session is gone regardless.
    Failed,
}

/// What `sign_out` leaves for the caller: the browser may be sent to the end-session endpoint.
#[derive(Debug, Default)]
pub struct SignOut {
    /// Outcome of the RFC 7009 revocation.
    pub revocation: Revocation,
    /// RP-initiated logout URL (with `client_id`), when the provider has one.
    pub end_session_url: Option<Url>,
}

#[derive(Default)]
pub(crate) struct State {
    access: Option<(AccessToken, Instant)>,
    stored: Option<StoredSession>,
}

pub(crate) struct Inner {
    pub(crate) config: OidcConfig,
    pub(crate) store: Arc<dyn RefreshTokenStore>,
    pub(crate) http: openidconnect::reqwest::Client,
    provider: AsyncMutex<Option<Provider>>,
    state: Mutex<State>,
    gate: AsyncMutex<()>,
    epoch: AtomicU64,
}

/// The OIDC session of one signed-in user. Cheap to clone.
#[derive(Clone)]
pub struct OidcSession {
    pub(crate) inner: Arc<Inner>,
}

impl OidcSession {
    /// # Errors
    /// [`OidcError::Config`] when the HTTP client cannot be built.
    pub fn new(config: OidcConfig, store: Arc<dyn RefreshTokenStore>) -> Result<Self, OidcError> {
        let http = openidconnect::reqwest::ClientBuilder::new()
            // Following redirects opens the client up to SSRF; discovery and token endpoints never redirect.
            .redirect(Policy::none())
            .timeout(HTTP_TIMEOUT)
            .build()
            .map_err(|e| OidcError::Config(e.to_string()))?;
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                store,
                http,
                provider: AsyncMutex::new(None),
                state: Mutex::new(State::default()),
                gate: AsyncMutex::new(()),
                epoch: AtomicU64::new(0),
            }),
        })
    }

    /// The `sub` of the signed-in user, if any.
    #[must_use]
    pub fn subject(&self) -> Option<String> {
        self.with_state(|s| s.stored.as_ref().map(|t| t.subject.clone()))
    }

    pub(crate) fn with_state<T>(&self, f: impl FnOnce(&mut State) -> T) -> T {
        f(&mut self
            .inner
            .state
            .lock()
            .unwrap_or_else(PoisonError::into_inner))
    }

    pub(crate) fn epoch(&self) -> u64 {
        self.inner.epoch.load(Ordering::SeqCst)
    }

    pub(crate) async fn provider(&self) -> Result<Provider, OidcError> {
        let mut slot = self.inner.provider.lock().await;
        if let Some(provider) = slot.as_ref() {
            return Ok(provider.clone());
        }
        let provider = Provider::discover(&self.inner.config, &self.inner.http).await?;
        *slot = Some(provider.clone());
        Ok(provider)
    }

    pub(crate) async fn blocking_store<T: Send + 'static>(
        &self,
        op: impl FnOnce(&dyn RefreshTokenStore) -> Result<T, OidcError> + Send + 'static,
    ) -> Result<T, OidcError> {
        let store = Arc::clone(&self.inner.store);
        spawn_blocking(move || op(store.as_ref()))
            .await
            .map_err(|e| OidcError::Keychain(e.to_string()))?
    }

    /// Installs a fresh access token and (if given) the stored session.
    pub(crate) fn install(
        &self,
        access: &str,
        expires_in: Option<Duration>,
        stored: Option<StoredSession>,
    ) {
        let expires_at = Instant::now() + expires_in.unwrap_or(Duration::from_secs(300));
        self.with_state(|s| {
            s.access = Some((AccessToken(Zeroizing::new(access.to_owned())), expires_at));
            if stored.is_some() {
                s.stored = stored;
            }
        });
    }

    fn fresh_access(&self) -> Option<AccessToken> {
        self.with_state(|s| {
            s.access
                .as_ref()
                .filter(|(_, exp)| Instant::now() + EXPIRY_SKEW < *exp)
                .map(|(t, _)| t.clone())
        })
    }

    /// Loads the stored session at startup and refreshes it. `Ok(None)` when nothing is stored.
    /// A network failure keeps the session and is reported as the error; call again later.
    ///
    /// # Errors
    /// Keychain errors, or the refresh error ([`OidcError::Unavailable`] keeps the stored session).
    pub async fn restore(&self) -> Result<Option<String>, OidcError> {
        let Some(stored) = self.blocking_store(|s| s.load()).await? else {
            return Ok(None);
        };
        let subject = stored.subject.clone();
        self.with_state(|s| s.stored = Some(stored));
        self.refresh(true).await?;
        Ok(Some(subject))
    }

    /// A usable access token, refreshing when it is about to expire (single-flight).
    ///
    /// # Errors
    /// [`OidcError::Rejected`] ends the session; [`OidcError::Unavailable`] keeps it.
    pub async fn access_token(&self) -> Result<AccessToken, OidcError> {
        match self.fresh_access() {
            Some(token) => Ok(token),
            None => self.refresh(false).await,
        }
    }

    /// Forces a refresh after the resource server answered `unauthenticated` (once per rejection).
    ///
    /// # Errors
    /// As [`Self::access_token`].
    pub async fn refresh_after_rejection(&self) -> Result<AccessToken, OidcError> {
        self.refresh(true).await
    }

    async fn refresh(&self, force: bool) -> Result<AccessToken, OidcError> {
        let seen = self.with_state(|s| s.access.as_ref().map(|(t, _)| t.expose().to_owned()));
        let _gate = self.inner.gate.lock().await;
        // Another caller may have refreshed while we waited for the gate.
        if let Some(token) = self.fresh_access() {
            let changed = seen.as_deref() != Some(token.expose());
            if !force || changed {
                return Ok(token);
            }
        }
        let epoch = self.epoch();
        let stored = self
            .with_state(|s| s.stored.clone())
            .ok_or_else(|| OidcError::Rejected("not signed in".into()))?;

        let provider = self.provider().await?;
        let client = provider.client(&self.inner.config);
        let refresh_token = RefreshToken::new(stored.refresh_token.to_string());
        let request = client
            .exchange_refresh_token(&refresh_token)
            .map_err(|e| OidcError::Config(e.to_string()))?;
        let response = request
            .request_async(&self.inner.http)
            .await
            .map_err(crate::signin::map_token_error);
        let response = match response {
            Ok(r) => r,
            Err(e) => {
                if e.ends_session() && self.epoch() == epoch {
                    self.end_local().await;
                }
                return Err(e);
            }
        };
        if self.epoch() != epoch {
            return Err(OidcError::Cancelled); // signed out meanwhile: discard the result
        }
        let rotated = response.refresh_token().map(|t| StoredSession {
            refresh_token: Zeroizing::new(t.secret().clone()),
            subject: stored.subject.clone(),
        });
        if let Some(rotated) = rotated.clone() {
            self.blocking_store(move |s| s.save(&rotated)).await?;
        }
        self.install(
            response.access_token().secret(),
            response.expires_in(),
            rotated,
        );
        self.fresh_access()
            .ok_or_else(|| OidcError::Security("provider issued an already expired token".into()))
    }

    /// Clears memory and the keychain without telling the provider.
    pub(crate) async fn end_local(&self) {
        self.inner.epoch.fetch_add(1, Ordering::SeqCst);
        self.with_state(|s| *s = State::default());
        if let Err(e) = self.blocking_store(|s| s.clear()).await {
            tracing::warn!(error = %e, "could not clear the keychain entry");
        }
    }

    /// Signs out: local state and keychain first, then the refresh token is revoked at the provider
    /// (RFC 7009). Provider-side failures are logged, not surfaced.
    pub async fn sign_out(&self) -> SignOut {
        let stored = self.with_state(|s| s.stored.clone());
        self.end_local().await;
        let Some(stored) = stored else {
            return SignOut::default();
        };
        let Ok(provider) = self.provider().await else {
            return SignOut::default();
        };
        let mut revocation = Revocation::NotAttempted;
        if let Some(endpoint) = provider.revocation_endpoint.clone() {
            revocation = self
                .revoke(&provider, endpoint, &stored.refresh_token)
                .await;
        }
        let end_session_url = provider.end_session_endpoint.map(|mut url| {
            url.query_pairs_mut()
                .append_pair("client_id", &self.inner.config.client_id);
            url
        });
        SignOut {
            revocation,
            end_session_url,
        }
    }

    pub(crate) async fn revoke(
        &self,
        provider: &Provider,
        endpoint: Url,
        refresh_token: &str,
    ) -> Revocation {
        let Ok(url) = RevocationUrl::new(endpoint.to_string()) else {
            return Revocation::Failed;
        };
        let client = provider.client(&self.inner.config).set_revocation_url(url);
        let token = CoreRevocableToken::from(RefreshToken::new(refresh_token.to_owned()));
        match client.revoke_token(token) {
            Ok(request) => match request.request_async(&self.inner.http).await {
                Ok(()) => Revocation::Revoked,
                Err(e) => {
                    tracing::warn!(error = %e, "token revocation failed");
                    Revocation::Failed
                }
            },
            Err(e) => {
                // The library refuses non-https revocation endpoints, so a plain-http test IdP lands here.
                tracing::warn!(error = %e, "token revocation not possible");
                Revocation::Failed
            }
        }
    }
}
