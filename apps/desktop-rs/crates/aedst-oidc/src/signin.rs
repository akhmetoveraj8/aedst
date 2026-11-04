//! Browser sign-in: Authorization Code + PKCE (S256) with a loopback redirect.
//!
//! The library generates `state`, `nonce` and the PKCE verifier from the OS CSPRNG, exchanges the
//! code, and verifies the ID token (signature against the provider's keys, issuer, audience,
//! expiry and the nonce we sent). We add the loopback receiver, the keychain write and the
//! rule that a keychain failure revokes the fresh token instead of falling back to a file.

use std::time::Duration;

use openidconnect::{
    AuthenticationFlow, AuthorizationCode, CsrfToken, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, RedirectUrl, RequestTokenError, Scope, StandardErrorResponse,
    core::{CoreErrorResponseType, CoreResponseType},
};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

use crate::{
    error::OidcError, loopback::LoopbackListener, session::OidcSession, store::StoredSession,
};

/// How long the user has to finish the browser step.
const SIGN_IN_DEADLINE: Duration = Duration::from_secs(5 * 60);

/// Opens the authorization URL in the user's browser. Tests substitute a fake.
pub trait BrowserOpener: Send + Sync {
    /// # Errors
    /// A short reason (no URL, it holds `state`) when no browser could be started.
    fn open(&self, url: &str) -> Result<(), String>;
}

/// The system default browser (RFC 8252: never an embedded web view).
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemBrowser;

impl BrowserOpener for SystemBrowser {
    fn open(&self, url: &str) -> Result<(), String> {
        webbrowser::open(url).map_err(|e| e.kind().to_string())
    }
}

/// Maps a token-endpoint failure. Only a dead grant ends the session; everything else keeps it.
pub(crate) fn map_token_error<E: std::error::Error + 'static>(
    error: RequestTokenError<E, StandardErrorResponse<CoreErrorResponseType>>,
) -> OidcError {
    match error {
        RequestTokenError::ServerResponse(response) => match response.error() {
            CoreErrorResponseType::InvalidGrant
            | CoreErrorResponseType::InvalidClient
            | CoreErrorResponseType::UnauthorizedClient => {
                OidcError::Rejected(response.error().to_string())
            }
            CoreErrorResponseType::Extension(name) if name == "invalid_token" => {
                OidcError::Rejected(name.clone())
            }
            other => OidcError::Unavailable(other.to_string()),
        },
        RequestTokenError::Request(_) => OidcError::Unavailable("token request failed".into()),
        RequestTokenError::Parse(..) | RequestTokenError::Other(_) => {
            OidcError::Unavailable("unreadable token response".into())
        }
    }
}

impl OidcSession {
    /// Runs the browser sign-in and returns the subject. Cancel through `cancel`.
    ///
    /// # Errors
    /// [`OidcError::Cancelled`], [`OidcError::TimedOut`], [`OidcError::Security`] (forged callback,
    /// bad ID token), [`OidcError::Keychain`] (no secure storage: the new token is revoked),
    /// [`OidcError::Unavailable`] / [`OidcError::Config`] for provider problems.
    pub async fn sign_in(
        &self,
        browser: &dyn BrowserOpener,
        cancel: &CancellationToken,
    ) -> Result<String, OidcError> {
        let provider = self.provider().await?;
        let listener = LoopbackListener::bind(self.inner.config.loopback_port).await?;
        let redirect = RedirectUrl::new(listener.redirect_uri())
            .map_err(|e| OidcError::Config(e.to_string()))?;
        let client = provider
            .client(&self.inner.config)
            .set_redirect_uri(redirect);

        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let mut request = client
            .authorize_url(
                AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .set_pkce_challenge(challenge);
        for scope in self.inner.config.scopes() {
            request = request.add_scope(Scope::new(scope));
        }
        let (auth_url, state, nonce) = request.url();

        browser
            .open(auth_url.as_str())
            .map_err(|e| OidcError::Unavailable(format!("cannot open the browser: {e}")))?;
        let issuer = self.inner.config.issuer.clone();
        let code = listener
            .wait_for_code(
                state.secret().clone(),
                issuer,
                provider.iss_required,
                SIGN_IN_DEADLINE,
                cancel,
            )
            .await?;

        let epoch = self.epoch();
        let response = client
            .exchange_code(AuthorizationCode::new(code))
            .map_err(|e| OidcError::Config(e.to_string()))?
            .set_pkce_verifier(verifier)
            .request_async(&self.inner.http)
            .await
            .map_err(map_token_error)?;

        let id_token = response
            .extra_fields()
            .id_token()
            .ok_or_else(|| OidcError::Security("no ID token".into()))?;
        let claims = id_token
            .claims(&client.id_token_verifier(), &nonce)
            .map_err(|e| OidcError::Security(format!("ID token rejected: {e}")))?;
        let subject = claims.subject().as_str().to_owned();
        let refresh = response
            .refresh_token()
            .ok_or_else(|| {
                OidcError::Config("provider issued no refresh token (offline_access)".into())
            })?
            .secret()
            .clone();

        let stored = StoredSession {
            refresh_token: Zeroizing::new(refresh.clone()),
            subject: subject.clone(),
        };
        let to_save = stored.clone();
        if let Err(error) = self.blocking_store(move |s| s.save(&to_save)).await {
            // No file fallback: give the token back instead of keeping a session we cannot protect.
            if let Some(endpoint) = provider.revocation_endpoint.clone() {
                self.revoke(&provider, endpoint, &refresh).await;
            }
            return Err(error);
        }
        if self.epoch() != epoch {
            return Err(OidcError::Cancelled);
        }
        self.install(
            response.access_token().secret(),
            response.expires_in(),
            Some(stored),
        );
        Ok(subject)
    }
}
