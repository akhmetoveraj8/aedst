//! Configuration from the environment. The gateway has no OIDC settings: it asks the Go server who a
//! client is (`AEDST_GATEWAY_API_URL`, ADR-0026).

use std::net::SocketAddr;
use std::time::Duration;

use thiserror::Error;

/// A configuration problem, reported once at startup.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// A required variable is missing or a value is invalid.
    #[error("{0}")]
    Invalid(String),
}

fn invalid(message: impl Into<String>) -> ConfigError {
    ConfigError::Invalid(message.into())
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
    /// `AEDST_GATEWAY_API_URL`: base URL of the Go server, whose `RealtimeService` authenticates
    /// every connecting client. Plain `http://` inside the cluster (TLS is the service mesh's job).
    pub api_url: String,
    /// `AEDST_GATEWAY_API_TIMEOUT_SECONDS`: bound on one authentication call.
    pub api_timeout: Duration,
    /// `AEDST_GATEWAY_MAX_CONNS`: open sockets of this replica, all users together.
    pub max_conns: usize,
    /// `AEDST_GATEWAY_MAX_CONNS_PER_USER`.
    pub max_conns_per_user: usize,
    /// `AEDST_GATEWAY_MAX_HANDSHAKES`: connections that have not finished the HTTP upgrade yet.
    pub max_handshakes: usize,
    /// `AEDST_GATEWAY_HEADER_TIMEOUT_SECONDS`: time a client has to send its request headers.
    pub header_timeout: Duration,
    /// `AEDST_GATEWAY_SEND_QUEUE`: frames buffered per connection before it is closed as too slow.
    pub send_queue: usize,
    /// `AEDST_GATEWAY_IDLE_TIMEOUT_SECONDS`: no frame or pong from the client for this long closes the socket.
    pub idle_timeout: Duration,
    /// `AEDST_GATEWAY_SHUTDOWN_SECONDS`.
    pub shutdown: Duration,
    /// `AEDST_GATEWAY_ALLOWED_ORIGINS`: browser origins allowed to open a socket. Empty means no
    /// browser may connect (a request carrying `Origin` is refused); clients that send no `Origin`
    /// are authenticated by their token alone.
    pub allowed_origins: Vec<String>,
    /// `AEDST_GATEWAY_ALLOW_ANY_ORIGIN`: local development only, refused in staging and production.
    pub allow_any_origin: bool,
}

/// Typed access to the variables.
struct Env<F>(F);

impl<F: Fn(&str) -> Option<String>> Env<F> {
    fn text(&self, key: &str) -> Option<String> {
        (self.0)(key)
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    }

    fn require(&self, key: &str) -> Result<String, ConfigError> {
        self.text(key)
            .ok_or_else(|| invalid(format!("{key} is required")))
    }

    fn list(&self, key: &str, default: &str) -> Vec<String> {
        self.text(key)
            .unwrap_or_else(|| default.to_owned())
            .split(',')
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
            .collect()
    }

    fn number(&self, key: &str, default: u64) -> Result<u64, ConfigError> {
        match self.text(key) {
            None => Ok(default),
            Some(v) => v
                .parse()
                .map_err(|_| invalid(format!("{key} must be a non-negative integer"))),
        }
    }

    fn positive(&self, key: &str, default: u64) -> Result<u64, ConfigError> {
        match self.number(key, default)? {
            0 => Err(invalid(format!("{key} must be positive"))),
            n => Ok(n),
        }
    }

    fn size(&self, key: &str, default: u64) -> Result<usize, ConfigError> {
        usize::try_from(self.positive(key, default)?)
            .map_err(|_| invalid(format!("{key} is too large")))
    }

    fn seconds(&self, key: &str, default: u64) -> Result<Duration, ConfigError> {
        Ok(Duration::from_secs(self.positive(key, default)?))
    }

    fn flag(&self, key: &str) -> Result<bool, ConfigError> {
        match self.text(key).as_deref() {
            None | Some("false" | "0") => Ok(false),
            Some("true" | "1") => Ok(true),
            Some(_) => Err(invalid(format!("{key} must be true or false"))),
        }
    }
}

/// True for `scheme://host[:port]` with an http(s) scheme and nothing after the authority, which
/// is the only form a browser sends in `Origin`.
fn is_origin(value: &str) -> bool {
    ["https://", "http://"]
        .iter()
        .filter_map(|scheme| value.strip_prefix(scheme))
        .any(|host| !host.is_empty() && !host.contains(['/', '?', '#', '*', ' ']))
}

/// True for `http://host[:port]` with nothing after the authority. The Go server is reached inside
/// the cluster; `https` would need a TLS client the gateway deliberately does not carry.
fn is_http_base(value: &str) -> bool {
    value
        .strip_prefix("http://")
        .is_some_and(|host| !host.is_empty() && !host.contains(['/', '?', '#', '@', ' ']))
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
        let env = Env(get);
        let deployed = matches!(
            env.text("AEDST_ENV").as_deref(),
            Some("staging" | "production")
        );
        let api_url = env.require("AEDST_GATEWAY_API_URL")?;
        if !is_http_base(&api_url) {
            return Err(invalid(format!(
                "AEDST_GATEWAY_API_URL {api_url:?} must be http://host[:port] (the Go server inside the cluster)"
            )));
        }
        let addr = env
            .text("AEDST_GATEWAY_ADDR")
            .unwrap_or_else(|| "0.0.0.0:8090".to_owned());
        let addr = addr.parse().map_err(|_| {
            invalid(format!(
                "AEDST_GATEWAY_ADDR {addr:?} is not a socket address"
            ))
        })?;
        let allowed_origins = env.list("AEDST_GATEWAY_ALLOWED_ORIGINS", "");
        if let Some(bad) = allowed_origins.iter().find(|origin| !is_origin(origin)) {
            return Err(invalid(format!(
                "AEDST_GATEWAY_ALLOWED_ORIGINS: {bad:?} is not an origin (scheme://host[:port])"
            )));
        }
        // Fail closed: without this switch an empty list refuses every browser. The switch itself
        // is refused where real users are.
        let allow_any_origin = env.flag("AEDST_GATEWAY_ALLOW_ANY_ORIGIN")?;
        if allow_any_origin && deployed {
            return Err(invalid(
                "AEDST_GATEWAY_ALLOW_ANY_ORIGIN is for local development only; set AEDST_GATEWAY_ALLOWED_ORIGINS",
            ));
        }

        Ok(Self {
            addr,
            nats_url: env.require("AEDST_NATS_URL")?,
            nats_stream: env
                .text("AEDST_NATS_STREAM")
                .unwrap_or_else(|| "AEDST_EVENTS".to_owned()),
            api_url,
            api_timeout: env.seconds("AEDST_GATEWAY_API_TIMEOUT_SECONDS", 3)?,
            max_conns: env.size("AEDST_GATEWAY_MAX_CONNS", 10_000)?,
            max_conns_per_user: env.size("AEDST_GATEWAY_MAX_CONNS_PER_USER", 8)?,
            max_handshakes: env.size("AEDST_GATEWAY_MAX_HANDSHAKES", 1024)?,
            header_timeout: env.seconds("AEDST_GATEWAY_HEADER_TIMEOUT_SECONDS", 5)?,
            send_queue: env.size("AEDST_GATEWAY_SEND_QUEUE", 256)?,
            idle_timeout: env.seconds("AEDST_GATEWAY_IDLE_TIMEOUT_SECONDS", 60)?,
            shutdown: env.seconds("AEDST_GATEWAY_SHUTDOWN_SECONDS", 20)?,
            allowed_origins,
            allow_any_origin,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn load(pairs: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        Config::from_lookup(|k| map.get(k).cloned())
    }

    fn with(extra: &[(&'static str, &'static str)]) -> Result<Config, ConfigError> {
        let mut pairs = BASE.to_vec();
        pairs.extend_from_slice(extra);
        load(&pairs)
    }

    const BASE: [(&str, &str); 2] = [
        ("AEDST_GATEWAY_API_URL", "http://aedst-server:8080"),
        ("AEDST_NATS_URL", "nats://localhost:4222"),
    ];

    #[test]
    fn defaults() {
        let cfg = load(&BASE).unwrap();
        assert_eq!(cfg.api_url, "http://aedst-server:8080");
        assert_eq!(cfg.api_timeout, Duration::from_secs(3));
        assert_eq!(cfg.nats_stream, "AEDST_EVENTS");
    }

    #[test]
    fn limits_have_safe_defaults_and_must_be_positive() {
        let cfg = load(&BASE).unwrap();
        assert_eq!(cfg.max_conns, 10_000);
        assert_eq!(cfg.max_conns_per_user, 8);
        assert_eq!(cfg.max_handshakes, 1024);
        assert_eq!(cfg.header_timeout, Duration::from_secs(5));
        for key in [
            "AEDST_GATEWAY_MAX_CONNS",
            "AEDST_GATEWAY_MAX_HANDSHAKES",
            "AEDST_GATEWAY_HEADER_TIMEOUT_SECONDS",
        ] {
            assert!(with(&[(key, "0")]).is_err(), "{key}");
        }
    }

    #[test]
    fn missing_api_url_or_nats_is_an_error() {
        for skip in ["AEDST_GATEWAY_API_URL", "AEDST_NATS_URL"] {
            let pairs: Vec<_> = BASE.iter().copied().filter(|(k, _)| *k != skip).collect();
            assert!(
                load(&pairs).unwrap_err().to_string().contains(skip),
                "{skip}"
            );
        }
    }

    #[test]
    fn the_api_url_is_a_plain_http_base() {
        assert!(with(&[("AEDST_GATEWAY_API_URL", "http://127.0.0.1:8080")]).is_ok());
        for bad in [
            "https://api.example",
            "http://",
            "http://host/path",
            "http://user@host",
            "aedst-server:8080",
        ] {
            assert!(with(&[("AEDST_GATEWAY_API_URL", bad)]).is_err(), "{bad}");
        }
    }

    #[test]
    fn origins_fail_closed_and_are_validated() {
        let cfg = load(&BASE).unwrap();
        assert!(cfg.allowed_origins.is_empty());
        assert!(!cfg.allow_any_origin, "no browser is allowed by default");

        let origins = "https://app.example, http://localhost:3000";
        let cfg = with(&[("AEDST_GATEWAY_ALLOWED_ORIGINS", origins)]).unwrap();
        assert_eq!(
            cfg.allowed_origins,
            ["https://app.example", "http://localhost:3000"]
        );

        for bad in ["*", "app.example", "https://app.example/", "https://"] {
            assert!(
                with(&[("AEDST_GATEWAY_ALLOWED_ORIGINS", bad)]).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_any_origin_switch_is_for_development_only() {
        assert!(
            with(&[("AEDST_GATEWAY_ALLOW_ANY_ORIGIN", "true")])
                .unwrap()
                .allow_any_origin
        );
        assert!(with(&[("AEDST_GATEWAY_ALLOW_ANY_ORIGIN", "yes")]).is_err());
        for env in ["staging", "production"] {
            let deployed = [
                ("AEDST_ENV", env),
                ("AEDST_GATEWAY_API_URL", "http://aedst-server:8080"),
                ("AEDST_NATS_URL", "nats://nats:4222"),
            ];
            assert!(load(&deployed).is_ok(), "{env}");
            let mut pairs = deployed.to_vec();
            pairs.push(("AEDST_GATEWAY_ALLOW_ANY_ORIGIN", "true"));
            assert!(load(&pairs).is_err(), "{env}");
        }
    }
}
