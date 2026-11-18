//! Configuration from the environment. OIDC variables mean exactly what they mean for the Go server
//! (`apps/server/internal/platform/config`), so one set of values configures both resource servers.

use std::net::SocketAddr;
use std::time::Duration;

use jsonwebtoken::Algorithm;
use thiserror::Error;

/// A configuration problem, reported once at startup.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// A required variable is missing or a value is invalid.
    #[error("{0}")]
    Invalid(String),
}

/// OIDC resource-server settings (`AEDST_OIDC_*`).
#[derive(Debug, Clone)]
pub struct OidcConfig {
    /// `AEDST_OIDC_ISSUER`.
    pub issuer: String,
    /// `AEDST_OIDC_AUDIENCE`.
    pub audience: String,
    /// `AEDST_OIDC_JWKS_URL`; empty means discovery from the issuer.
    pub jwks_url: Option<String>,
    /// `AEDST_OIDC_ALGORITHMS` (asymmetric only).
    pub algorithms: Vec<Algorithm>,
    /// `AEDST_OIDC_TOKEN_TYPES`: accepted JOSE `typ` values.
    pub token_types: Vec<String>,
    /// `AEDST_OIDC_CLOCK_SKEW_SECONDS`.
    pub clock_skew: Duration,
}

/// The whole gateway configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// `AEDST_GATEWAY_ADDR`.
    pub addr: SocketAddr,
    /// `AEDST_NATS_URL`.
    pub nats_url: String,
    /// `AEDST_NATS_STREAM`.
    pub nats_stream: String,
    /// OIDC settings.
    pub oidc: OidcConfig,
    /// `AEDST_GATEWAY_MAX_CONNS_PER_USER`.
    pub max_conns_per_user: usize,
    /// `AEDST_GATEWAY_SEND_QUEUE`: frames buffered per connection before it is closed as too slow.
    pub send_queue: usize,
    /// `AEDST_GATEWAY_IDLE_TIMEOUT_SECONDS`: no frame or pong from the client for this long closes the socket.
    pub idle_timeout: Duration,
    /// `AEDST_GATEWAY_SHUTDOWN_SECONDS`.
    pub shutdown: Duration,
    /// `AEDST_GATEWAY_ALLOWED_ORIGINS`: browser origins allowed to open a socket (empty = no browser check).
    pub allowed_origins: Vec<String>,
}

impl Config {
    /// Reads the process environment.
    ///
    /// # Errors
    /// Returns [`ConfigError`] when a required value is missing or invalid.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Reads values through `get` (tests pass a map).
    ///
    /// # Errors
    /// Returns [`ConfigError`] when a required value is missing or invalid.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let text = |key: &str| get(key).map(|v| v.trim().to_owned()).filter(|v| !v.is_empty());
        let list = |key: &str, default: &str| -> Vec<String> {
            text(key)
                .unwrap_or_else(|| default.to_owned())
                .split(',')
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
                .collect()
        };
        let number = |key: &str, default: u64| -> Result<u64, ConfigError> {
            match text(key) {
                None => Ok(default),
                Some(v) => v.parse().map_err(|_| ConfigError::Invalid(format!("{key} must be a non-negative integer"))),
            }
        };
        let positive = |key: &str, default: u64| -> Result<u64, ConfigError> {
            let n = number(key, default)?;
            if n == 0 { Err(ConfigError::Invalid(format!("{key} must be positive"))) } else { Ok(n) }
        };
        let require = |key: &str| text(key).ok_or_else(|| ConfigError::Invalid(format!("{key} is required")));

        let env = text("AEDST_ENV").unwrap_or_else(|| "development".to_owned());
        let deployed = env == "staging" || env == "production";
        let issuer = require("AEDST_OIDC_ISSUER")?;
        if !issuer.starts_with("https://") && (deployed || !issuer.starts_with("http://")) {
            return Err(ConfigError::Invalid("AEDST_OIDC_ISSUER must use https (http is allowed only outside staging/production)".into()));
        }
        let mut algorithms = Vec::new();
        for name in list("AEDST_OIDC_ALGORITHMS", "RS256,ES256,EdDSA") {
            let alg: Algorithm = name
                .parse()
                .map_err(|_| ConfigError::Invalid(format!("AEDST_OIDC_ALGORITHMS: unknown algorithm {name:?}")))?;
            if matches!(alg, Algorithm::HS256 | Algorithm::HS384 | Algorithm::HS512) {
                return Err(ConfigError::Invalid(format!("AEDST_OIDC_ALGORITHMS must not include {name:?} (asymmetric algorithms only)")));
            }
            algorithms.push(alg);
        }
        let addr = text("AEDST_GATEWAY_ADDR").unwrap_or_else(|| "0.0.0.0:8090".to_owned());
        let addr = addr
            .parse()
            .map_err(|_| ConfigError::Invalid(format!("AEDST_GATEWAY_ADDR {addr:?} is not a socket address")))?;

        Ok(Self {
            addr,
            nats_url: require("AEDST_NATS_URL")?,
            nats_stream: text("AEDST_NATS_STREAM").unwrap_or_else(|| "AEDST_EVENTS".to_owned()),
            oidc: OidcConfig {
                issuer,
                audience: require("AEDST_OIDC_AUDIENCE")?,
                jwks_url: text("AEDST_OIDC_JWKS_URL"),
                algorithms,
                token_types: list("AEDST_OIDC_TOKEN_TYPES", "at+jwt,JWT"),
                clock_skew: Duration::from_secs(number("AEDST_OIDC_CLOCK_SKEW_SECONDS", 30)?),
            },
            max_conns_per_user: usize::try_from(positive("AEDST_GATEWAY_MAX_CONNS_PER_USER", 8)?)
                .map_err(|_| ConfigError::Invalid("AEDST_GATEWAY_MAX_CONNS_PER_USER is too large".into()))?,
            send_queue: usize::try_from(positive("AEDST_GATEWAY_SEND_QUEUE", 256)?)
                .map_err(|_| ConfigError::Invalid("AEDST_GATEWAY_SEND_QUEUE is too large".into()))?,
            idle_timeout: Duration::from_secs(positive("AEDST_GATEWAY_IDLE_TIMEOUT_SECONDS", 60)?),
            shutdown: Duration::from_secs(positive("AEDST_GATEWAY_SHUTDOWN_SECONDS", 20)?),
            allowed_origins: list("AEDST_GATEWAY_ALLOWED_ORIGINS", ""),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn load(pairs: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        Config::from_lookup(|k| map.get(k).cloned())
    }

    const BASE: [(&str, &str); 3] = [
        ("AEDST_OIDC_ISSUER", "http://localhost:8085"),
        ("AEDST_OIDC_AUDIENCE", "1"),
        ("AEDST_NATS_URL", "nats://localhost:4222"),
    ];

    #[test]
    fn defaults_match_the_go_server() {
        let cfg = load(&BASE).unwrap();
        assert_eq!(cfg.oidc.clock_skew, Duration::from_secs(30));
        assert_eq!(cfg.oidc.token_types, ["at+jwt", "JWT"]);
        assert_eq!(cfg.oidc.algorithms, [Algorithm::RS256, Algorithm::ES256, Algorithm::EdDSA]);
        assert_eq!(cfg.nats_stream, "AEDST_EVENTS");
    }

    #[test]
    fn missing_issuer_audience_or_nats_is_an_error() {
        for skip in ["AEDST_OIDC_ISSUER", "AEDST_OIDC_AUDIENCE", "AEDST_NATS_URL"] {
            let pairs: Vec<_> = BASE.iter().copied().filter(|(k, _)| *k != skip).collect();
            assert!(load(&pairs).unwrap_err().to_string().contains(skip), "{skip}");
        }
    }

    #[test]
    fn symmetric_algorithms_and_plain_http_in_production_are_refused() {
        let mut pairs = BASE.to_vec();
        pairs.push(("AEDST_OIDC_ALGORITHMS", "HS256"));
        assert!(load(&pairs).is_err());
        let mut pairs = BASE.to_vec();
        pairs.push(("AEDST_ENV", "production"));
        assert!(load(&pairs).is_err());
    }
}
