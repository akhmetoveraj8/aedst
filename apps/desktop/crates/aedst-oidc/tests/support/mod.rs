//! A fake identity provider (wiremock) with a signing key generated at test time, and a fake browser
//! that completes the redirect like a user would. No private key is stored in the repository.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use aedst_oidc::{BrowserOpener, OidcConfig};
use chrono::{Duration, Utc};
use openidconnect::{
    AccessToken, Audience, AuthorizationCode, EmptyAdditionalClaims, IssuerUrl, JsonWebKeyId,
    Nonce, PrivateSigningKey, StandardClaims, SubjectIdentifier,
    core::{CoreIdToken, CoreIdTokenClaims, CoreJwsSigningAlgorithm, CoreRsaPrivateSigningKey},
};
use rsa::{RsaPrivateKey, pkcs1::EncodeRsaPrivateKey, pkcs8::LineEnding};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use url::Url;
use wiremock::{
    Mock, MockServer, Request, Respond, ResponseTemplate,
    matchers::{method, path},
};

pub const CLIENT_ID: &str = "desktop-client";

/// What the fake provider should do on the token endpoint.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TokenBehavior {
    Normal,
    /// Sign the ID token with a different nonce than the one the client sent.
    WrongNonce,
    /// Answer the refresh grant with `invalid_grant`.
    RefreshInvalidGrant,
}

pub struct Idp {
    _server: MockServer,
    pub config: OidcConfig,
    pub refresh_calls: Arc<AtomicUsize>,
    nonce: Arc<Mutex<Option<String>>>,
}

struct Token {
    key: Arc<CoreRsaPrivateSigningKey>,
    issuer: String,
    nonce: Arc<Mutex<Option<String>>>,
    refresh_calls: Arc<AtomicUsize>,
    behavior: TokenBehavior,
}

impl Respond for Token {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let form: HashMap<String, String> = url::form_urlencoded::parse(&request.body)
            .into_owned()
            .collect();
        match form.get("grant_type").map(String::as_str) {
            Some("authorization_code") => {
                assert!(
                    form.contains_key("code_verifier"),
                    "PKCE verifier must be sent"
                );
                assert!(
                    !form.contains_key("client_secret"),
                    "a public client sends no secret"
                );
                let nonce = match self.behavior {
                    TokenBehavior::WrongNonce => "not-the-nonce".to_owned(),
                    _ => self.nonce.lock().unwrap().clone().unwrap_or_default(),
                };
                let id_token = sign_id_token(&self.key, &self.issuer, &nonce, "AT1", "CODE1");
                ResponseTemplate::new(200).set_body_json(json!({
                    "access_token": "AT1", "token_type": "Bearer", "expires_in": 3600,
                    "refresh_token": "RT1", "id_token": id_token,
                }))
            }
            Some("refresh_token") => {
                let n = self.refresh_calls.fetch_add(1, Ordering::SeqCst) + 1;
                if self.behavior == TokenBehavior::RefreshInvalidGrant {
                    return ResponseTemplate::new(400)
                        .set_body_json(json!({"error": "invalid_grant"}));
                }
                ResponseTemplate::new(200).set_body_json(json!({
                    "access_token": format!("AT-R{n}"), "token_type": "Bearer", "expires_in": 3600,
                    "refresh_token": format!("RT-R{n}"),
                }))
            }
            _ => {
                ResponseTemplate::new(400).set_body_json(json!({"error": "unsupported_grant_type"}))
            }
        }
    }
}

fn sign_id_token(
    key: &CoreRsaPrivateSigningKey,
    issuer: &str,
    nonce: &str,
    access: &str,
    code: &str,
) -> Value {
    let claims = CoreIdTokenClaims::new(
        IssuerUrl::new(issuer.to_owned()).unwrap(),
        vec![Audience::new(CLIENT_ID.to_owned())],
        Utc::now() + Duration::hours(1),
        Utc::now(),
        StandardClaims::new(SubjectIdentifier::new("user-1".to_owned())),
        EmptyAdditionalClaims {},
    )
    .set_nonce(Some(Nonce::new(nonce.to_owned())));
    let token = CoreIdToken::new(
        claims,
        key,
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
        Some(&AccessToken::new(access.to_owned())),
        Some(&AuthorizationCode::new(code.to_owned())),
    )
    .unwrap();
    serde_json::to_value(token).unwrap()
}

impl Idp {
    pub async fn start(behavior: TokenBehavior) -> Self {
        let pem = RsaPrivateKey::new(&mut rand_core::OsRng, 2048)
            .unwrap()
            .to_pkcs1_pem(LineEnding::LF)
            .unwrap();
        let key = Arc::new(
            CoreRsaPrivateSigningKey::from_pem(&pem, Some(JsonWebKeyId::new("k1".into()))).unwrap(),
        );
        let server = MockServer::start().await;
        let base = server.uri();
        let jwks = json!({ "keys": [serde_json::to_value(key.as_verification_key()).unwrap()] });

        Mock::given(method("GET"))
            .and(path("/.well-known/openid-configuration"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "issuer": base,
                "authorization_endpoint": format!("{base}/authorize"),
                "token_endpoint": format!("{base}/token"),
                "jwks_uri": format!("{base}/jwks"),
                "revocation_endpoint": format!("{base}/revoke"),
                "end_session_endpoint": format!("{base}/logout"),
                "response_types_supported": ["code"],
                "subject_types_supported": ["public"],
                "id_token_signing_alg_values_supported": ["RS256"],
                "code_challenge_methods_supported": ["S256"],
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/jwks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(jwks))
            .mount(&server)
            .await;

        let nonce = Arc::new(Mutex::new(None));
        let refresh_calls = Arc::new(AtomicUsize::new(0));
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(Token {
                key,
                issuer: base.clone(),
                nonce: nonce.clone(),
                refresh_calls: refresh_calls.clone(),
                behavior,
            })
            .mount(&server)
            .await;

        let config = OidcConfig {
            issuer: base,
            client_id: CLIENT_ID.to_owned(),
            project_id: Some("42".into()),
            request_roles: true,
            loopback_port: None,
        };
        Self {
            _server: server,
            config,
            refresh_calls,
            nonce,
        }
    }

    pub fn browser(&self) -> FakeBrowser {
        FakeBrowser {
            nonce: self.nonce.clone(),
            seen: Arc::new(Mutex::new(None)),
        }
    }
}

/// Plays the user: reads the authorization URL and completes the loopback redirect.
pub struct FakeBrowser {
    nonce: Arc<Mutex<Option<String>>>,
    /// The authorization URL the app asked the browser to open.
    pub seen: Arc<Mutex<Option<Url>>>,
}

impl BrowserOpener for FakeBrowser {
    fn open(&self, url: &str) -> Result<(), String> {
        let url = Url::parse(url).map_err(|e| e.to_string())?;
        let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
        *self.nonce.lock().unwrap() = query.get("nonce").cloned();
        *self.seen.lock().unwrap() = Some(url.clone());
        let redirect = Url::parse(&query["redirect_uri"]).map_err(|e| e.to_string())?;
        let authority = format!(
            "{}:{}",
            redirect.host_str().unwrap(),
            redirect.port().unwrap()
        );
        let target = format!("/callback?code=CODE1&state={}", query["state"]);
        tokio::spawn(async move {
            let mut stream = TcpStream::connect(&authority).await.unwrap();
            let request = format!("GET {target} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut sink = String::new();
            let _ = stream.read_to_string(&mut sink).await;
        });
        Ok(())
    }
}
