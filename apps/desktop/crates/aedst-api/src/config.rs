//! Client configuration and the transport policy.
//!
//! https is required; plain http is accepted only for loopback hosts in debug builds or when
//! `AEDST_ALLOW_INSECURE_LOCALHOST` is set. There is no default API URL in a release build.
//! Every request carries `X-Aedst-Client: desktop/<semver>` (omitted when the version is not semver)
//! so the server can apply its version window. Writes that must be safe to repeat carry an
//! `Idempotency-Key`.

use std::time::Duration;

use connectrpc::client::{CallOptions, ClientConfig};
use url::Url;

const CLIENT_HEADER: &str = "x-aedst-client";
const IDEMPOTENCY_HEADER: &str = "idempotency-key";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Why a base URL or version was refused.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    /// Not a URL.
    #[error("the API base URL is not a URL")]
    NotAUrl,
    /// http outside loopback, or another scheme.
    #[error("the API base URL must be https")]
    Insecure,
}

fn insecure_localhost_allowed() -> bool {
    cfg!(debug_assertions) || std::env::var_os("AEDST_ALLOW_INSECURE_LOCALHOST").is_some()
}

/// Checks the transport policy for `base`.
///
/// # Errors
/// [`ConfigError`] when the URL is unusable or insecure.
pub fn validate_base_url(base: &str) -> Result<Url, ConfigError> {
    let url = Url::parse(base).map_err(|_| ConfigError::NotAUrl)?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    match url.scheme() {
        "https" => Ok(url),
        "http" if loopback && insecure_localhost_allowed() => Ok(url),
        _ => Err(ConfigError::Insecure),
    }
}

/// The client identifier (`desktop/1.2.3`), or `None` when `app_version` is not semver.
#[must_use]
pub fn client_identifier(app_version: &str) -> Option<String> {
    semver::Version::parse(app_version)
        .ok()
        .map(|v| format!("desktop/{v}"))
}

/// A `ClientConfig` for the API at `base` with the identifier header and a default timeout.
///
/// # Errors
/// [`ConfigError`] when `base` breaks the transport policy.
pub fn client_config(base: &str, app_version: &str) -> Result<ClientConfig, ConfigError> {
    let uri = validate_base_url(base)?
        .as_str()
        .parse()
        .map_err(|_| ConfigError::NotAUrl)?;
    let mut config = ClientConfig::new(uri).with_default_timeout(DEFAULT_TIMEOUT);
    if let Some(identifier) = client_identifier(app_version) {
        config = config.with_default_header(CLIENT_HEADER, identifier);
    }
    Ok(config)
}

/// Adds the `Idempotency-Key` of a queued write (the outbox item id).
#[must_use]
pub fn with_idempotency_key(options: CallOptions, key: &str) -> CallOptions {
    options.with_header(IDEMPOTENCY_HEADER, key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_is_accepted_and_plain_http_only_for_loopback() {
        assert!(validate_base_url("https://api.example.com").is_ok());
        assert!(
            validate_base_url("http://127.0.0.1:8080").is_ok(),
            "debug build"
        );
        assert_eq!(
            validate_base_url("http://api.example.com"),
            Err(ConfigError::Insecure)
        );
        assert_eq!(
            validate_base_url("ftp://api.example.com"),
            Err(ConfigError::Insecure)
        );
        assert_eq!(validate_base_url("not a url"), Err(ConfigError::NotAUrl));
    }

    #[test]
    fn the_client_identifier_needs_a_semver_version() {
        assert_eq!(client_identifier("1.4.0").as_deref(), Some("desktop/1.4.0"));
        assert_eq!(
            client_identifier("1.4.0-beta.1").as_deref(),
            Some("desktop/1.4.0-beta.1")
        );
        assert_eq!(client_identifier("dev"), None);
        assert_eq!(client_identifier("1.4"), None);
    }

    #[test]
    fn a_config_builds_for_a_valid_base() {
        assert!(client_config("https://api.example.com", "1.0.0").is_ok());
        assert!(client_config("http://api.example.com", "1.0.0").is_err());
    }
}
