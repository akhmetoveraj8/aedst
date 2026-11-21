//! Access-token verification: the gateway is an OIDC resource server, like `apps/server`
//! (`internal/platform/auth`). It checks signature (JWKS of the issuer), `iss`, `aud`, `exp`/`nbf`
//! with the configured skew, the algorithm allow-list and the JOSE `typ` allow-list, and maps
//! `(iss, sub)` to the owner id exactly as `ids.FromExternal` does in Go, because events are routed
//! by that id. It issues no tokens and keeps no sessions.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{DecodingKey, Validation, decode, decode_header};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::config::OidcConfig;

/// Minimum time between two JWKS fetches caused by an unknown `kid` (keeps a flood of bad tokens
/// from turning into a flood of requests to the identity provider).
const MIN_REFRESH: Duration = Duration::from_secs(30);
/// A cached key set is refreshed in the background of a request after this long.
const MAX_AGE: Duration = Duration::from_secs(3600);

/// Why a token was refused. The reason is logged, never sent to the client.
#[derive(Debug, Error)]
pub enum AuthError {
    /// The token is malformed, expired, for another audience/issuer, or badly signed.
    #[error("invalid token: {0}")]
    Invalid(String),
    /// The identity provider's keys could not be fetched.
    #[error("jwks unavailable: {0}")]
    Keys(String),
}

fn invalid<E: std::fmt::Display>(error: E) -> AuthError {
    AuthError::Invalid(error.to_string())
}

fn keys<E: std::fmt::Display>(error: E) -> AuthError {
    AuthError::Keys(error.to_string())
}

/// The authenticated caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    /// The owner id events are addressed to (`ids.FromExternal(issuer, sub)`).
    pub user_id: String,
    /// `exp` as seconds since the Unix epoch; the socket is closed at this instant.
    pub expires_at: u64,
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    exp: u64,
}

#[derive(Debug, Deserialize)]
struct Discovery {
    jwks_uri: String,
}

struct CachedKeys {
    set: JwkSet,
    fetched: Instant,
}

/// Verifies access tokens against the issuer's JWKS.
pub struct Verifier {
    cfg: OidcConfig,
    http: reqwest::Client,
    keys: RwLock<Option<CachedKeys>>,
    refresh: Mutex<()>,
}

impl Verifier {
    /// Builds a verifier; no network call happens until the first token.
    ///
    /// # Errors
    /// Fails when the HTTP client cannot be built.
    pub fn new(cfg: OidcConfig) -> Result<Self, AuthError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(keys)?;
        Ok(Self {
            cfg,
            http,
            keys: RwLock::new(None),
            refresh: Mutex::new(()),
        })
    }

    /// Verifies `token` and returns the caller.
    ///
    /// # Errors
    /// [`AuthError::Invalid`] for a bad token, [`AuthError::Keys`] when the issuer's keys are unreachable.
    pub async fn verify(&self, token: &str) -> Result<Principal, AuthError> {
        let kid = decode_header(token).map_err(invalid)?.kid;
        if let Some(principal) = self.try_cached(token, kid.as_deref()).await? {
            return Ok(principal);
        }
        self.refresh_keys().await?;
        match self.try_cached(token, kid.as_deref()).await? {
            Some(principal) => Ok(principal),
            None => Err(AuthError::Invalid("no key for the token's kid".into())),
        }
    }

    async fn try_cached(
        &self,
        token: &str,
        kid: Option<&str>,
    ) -> Result<Option<Principal>, AuthError> {
        let guard = self.keys.read().await;
        let Some(cached) = guard.as_ref() else {
            return Ok(None);
        };
        if cached.fetched.elapsed() > MAX_AGE {
            return Ok(None);
        }
        verify_with(&self.cfg, token, kid, &cached.set)
    }

    async fn refresh_keys(&self) -> Result<(), AuthError> {
        let _serialize = self.refresh.lock().await;
        if let Some(cached) = self.keys.read().await.as_ref()
            && cached.fetched.elapsed() < MIN_REFRESH
        {
            return Ok(());
        }
        let url = match &self.cfg.jwks_url {
            Some(url) => url.clone(),
            None => {
                let issuer = self.cfg.issuer.trim_end_matches('/');
                let discovery = format!("{issuer}/.well-known/openid-configuration");
                let doc: Discovery = self.get_json(&discovery).await?;
                doc.jwks_uri
            }
        };
        let set: JwkSet = self.get_json(&url).await?;
        *self.keys.write().await = Some(CachedKeys {
            set,
            fetched: Instant::now(),
        });
        Ok(())
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, AuthError> {
        self.http
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(keys)?
            .json()
            .await
            .map_err(keys)
    }
}

/// Verifies `token` against `set`. `Ok(None)` means the key id is not in the set (the caller may
/// refresh the set once); every other failure is final.
///
/// # Errors
/// [`AuthError::Invalid`] for any token problem.
pub fn verify_with(
    cfg: &OidcConfig,
    token: &str,
    kid: Option<&str>,
    set: &JwkSet,
) -> Result<Option<Principal>, AuthError> {
    let header = decode_header(token).map_err(invalid)?;
    if !cfg.algorithms.contains(&header.alg) {
        return Err(AuthError::Invalid(format!(
            "algorithm {:?} is not allowed",
            header.alg
        )));
    }
    let typ_ok = header.typ.as_deref().is_some_and(|typ| {
        cfg.token_types
            .iter()
            .any(|t| t.eq_ignore_ascii_case(typ))
    });
    if !typ_ok {
        return Err(AuthError::Invalid(
            "token type (typ) is not an access token".into(),
        ));
    }
    let jwk = match kid {
        Some(kid) => set.find(kid),
        // A token without a kid is accepted only when the set has exactly one key.
        None if set.keys.len() == 1 => set.keys.first(),
        None => None,
    };
    let Some(jwk) = jwk else {
        return Ok(None);
    };
    let key = DecodingKey::from_jwk(jwk).map_err(invalid)?;

    let mut validation = Validation::new(header.alg);
    validation.set_audience(&[cfg.audience.as_str()]);
    validation.set_issuer(&[cfg.issuer.as_str()]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = cfg.clock_skew.as_secs();
    validation.validate_nbf = true;
    let data = decode::<Claims>(token, &key, &validation).map_err(invalid)?;
    if data.claims.sub.is_empty() {
        return Err(AuthError::Invalid("empty subject".into()));
    }
    Ok(Some(Principal {
        user_id: user_id_for(&cfg.issuer, &data.claims.sub),
        expires_at: data.claims.exp,
    }))
}

/// Mirrors `ids.FromExternal` in `apps/server/internal/shared/ids`: a UUID subject is used as is;
/// any other subject is hashed with the issuer into a deterministic version-8 UUID.
#[must_use]
pub fn user_id_for(issuer: &str, subject: &str) -> String {
    if let Ok(id) = Uuid::parse_str(subject) {
        return id.hyphenated().to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(issuer.as_bytes());
    hasher.update([0u8]);
    hasher.update(subject.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).hyphenated().to_string()
}

/// Seconds since the Unix epoch (0 if the clock is before it).
#[must_use]
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
