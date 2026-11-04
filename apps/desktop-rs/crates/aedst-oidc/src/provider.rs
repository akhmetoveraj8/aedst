//! Discovery of the identity provider and the checks the C++ app applied to the document:
//! the issuer must match, endpoints must be https, PKCE S256 must be offered when methods are
//! listed. Plain http is accepted only for loopback hosts in debug builds (or when
//! `AEDST_ALLOW_INSECURE_LOCALHOST` is set).

use openidconnect::{
    AdditionalProviderMetadata, ClientId, EndpointMaybeSet, EndpointNotSet, EndpointSet, IssuerUrl,
    ProviderMetadata,
    core::{
        CoreAuthDisplay, CoreClaimName, CoreClaimType, CoreClient, CoreClientAuthMethod,
        CoreGrantType, CoreJsonWebKey, CoreJweContentEncryptionAlgorithm,
        CoreJweKeyManagementAlgorithm, CoreResponseMode, CoreResponseType,
        CoreSubjectIdentifierType,
    },
};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{config::OidcConfig, error::OidcError};

/// Discovery fields beyond the OpenID Connect core set that the sign-in uses.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ExtraMetadata {
    revocation_endpoint: Option<String>,
    end_session_endpoint: Option<String>,
    code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(default)]
    authorization_response_iss_parameter_supported: bool,
}
impl AdditionalProviderMetadata for ExtraMetadata {}

type Metadata = ProviderMetadata<
    ExtraMetadata,
    CoreAuthDisplay,
    CoreClientAuthMethod,
    CoreClaimName,
    CoreClaimType,
    CoreGrantType,
    CoreJweContentEncryptionAlgorithm,
    CoreJweKeyManagementAlgorithm,
    CoreJsonWebKey,
    CoreResponseMode,
    CoreResponseType,
    CoreSubjectIdentifierType,
>;

/// The client type `CoreClient::from_provider_metadata` returns (authorization endpoint set, token and
/// user-info endpoints taken from discovery).
pub type ProviderClient = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// A validated discovery document.
#[derive(Clone, Debug)]
pub struct Provider {
    metadata: Metadata,
    /// RFC 7009 endpoint, when the provider has one.
    pub revocation_endpoint: Option<Url>,
    /// RP-initiated logout endpoint, when the provider has one.
    pub end_session_endpoint: Option<Url>,
    /// True when the provider promises an `iss` parameter on every authorization response (RFC 9207).
    pub iss_required: bool,
}

fn insecure_localhost_allowed() -> bool {
    cfg!(debug_assertions) || std::env::var_os("AEDST_ALLOW_INSECURE_LOCALHOST").is_some()
}

fn transport_ok(url: &Url) -> bool {
    match url.scheme() {
        "https" => true,
        "http" => {
            insecure_localhost_allowed()
                && url
                    .host_str()
                    .is_some_and(|h| matches!(h, "127.0.0.1" | "localhost" | "[::1]"))
        }
        _ => false,
    }
}

fn require_secure(name: &str, url: &Url) -> Result<(), OidcError> {
    if transport_ok(url) {
        Ok(())
    } else {
        Err(OidcError::Config(format!("{name} must be https")))
    }
}

impl Provider {
    /// Fetches and validates the discovery document of `config.issuer`.
    ///
    /// # Errors
    /// [`OidcError::Config`] for an unusable document, [`OidcError::Unavailable`] when it cannot be fetched.
    pub async fn discover(
        config: &OidcConfig,
        http: &openidconnect::reqwest::Client,
    ) -> Result<Self, OidcError> {
        let issuer_url = Url::parse(&config.issuer)
            .map_err(|_| OidcError::Config("issuer is not a URL".into()))?;
        require_secure("issuer", &issuer_url)?;
        // Keep the configured string: `Url` would add a trailing slash to a host-only issuer, and the
        // document's `issuer` must match byte for byte.
        let issuer = IssuerUrl::new(config.issuer.clone())
            .map_err(|_| OidcError::Config("issuer is not a URL".into()))?;
        // The library rejects a document whose `issuer` differs from the one we asked.
        let metadata = Metadata::discover_async(issuer, http)
            .await
            .map_err(|e| match e {
                openidconnect::DiscoveryError::Request(_) => {
                    OidcError::Unavailable("discovery request failed".into())
                }
                other => OidcError::Config(format!("discovery failed: {other}")),
            })?;

        require_secure(
            "authorization endpoint",
            metadata.authorization_endpoint().url(),
        )?;
        if let Some(token) = metadata.token_endpoint() {
            require_secure("token endpoint", token.url())?;
        }
        let extra = metadata.additional_metadata();
        if let Some(methods) = &extra.code_challenge_methods_supported
            && !methods.iter().any(|m| m == "S256")
        {
            return Err(OidcError::Config(
                "provider does not offer PKCE S256".into(),
            ));
        }
        let parse = |name: &str, raw: &Option<String>| -> Result<Option<Url>, OidcError> {
            raw.as_deref()
                .map(|r| {
                    let url = Url::parse(r)
                        .map_err(|_| OidcError::Config(format!("{name} is not a URL")))?;
                    require_secure(name, &url)?;
                    Ok(url)
                })
                .transpose()
        };
        Ok(Self {
            revocation_endpoint: parse("revocation endpoint", &extra.revocation_endpoint)?,
            end_session_endpoint: parse("end-session endpoint", &extra.end_session_endpoint)?,
            iss_required: extra.authorization_response_iss_parameter_supported,
            metadata,
        })
    }

    /// A fresh client for this provider and `config`. No secret: this is a public native client.
    #[must_use]
    pub fn client(&self, config: &OidcConfig) -> ProviderClient {
        CoreClient::from_provider_metadata(
            self.metadata.clone(),
            ClientId::new(config.client_id.clone()),
            None,
        )
    }
}
