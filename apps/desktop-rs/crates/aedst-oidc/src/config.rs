//! Provider configuration: issuer, client id and project id are configuration, never constants.

use sha2::{Digest, Sha256};

/// Service name under which the OS keychain entry is stored.
pub const KEYCHAIN_SERVICE: &str = "com.aedst.Desktop";

/// Settings of the OIDC sign-in. OIDC is active exactly when issuer and client id are set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OidcConfig {
    /// Issuer URL, compared with the one the discovery document reports.
    pub issuer: String,
    /// Public client id (no secret exists).
    pub client_id: String,
    /// ZITADEL project id for the audience scope, when the access token must carry it.
    pub project_id: Option<String>,
    /// Ask for ZITADEL's role claims (default on).
    pub request_roles: bool,
    /// Fixed loopback port, for providers that match redirect URIs exactly.
    pub loopback_port: Option<u16>,
}

impl OidcConfig {
    /// Reads `AEDST_OIDC_*` from the process environment.
    #[must_use]
    pub fn from_env() -> Option<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Reads the settings through `get` (a test double or another settings source).
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let non_empty = |key: &str| {
            get(key)
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
        };
        Some(Self {
            issuer: non_empty("AEDST_OIDC_ISSUER")?,
            client_id: non_empty("AEDST_OIDC_CLIENT_ID")?,
            project_id: non_empty("AEDST_OIDC_PROJECT_ID"),
            request_roles: non_empty("AEDST_OIDC_REQUEST_ROLES")
                .is_none_or(|v| v != "0" && v != "false"),
            loopback_port: non_empty("AEDST_OIDC_LOOPBACK_PORT").and_then(|v| v.parse().ok()),
        })
    }

    /// Scopes of the authorization request.
    #[must_use]
    pub fn scopes(&self) -> Vec<String> {
        let mut scopes: Vec<String> = ["profile", "email", "offline_access"]
            .map(str::to_owned)
            .into();
        if let Some(project) = &self.project_id {
            scopes.push(format!("urn:zitadel:iam:org:project:id:{project}:aud"));
        }
        if self.request_roles {
            scopes.push("urn:zitadel:iam:org:projects:roles".to_owned());
        }
        scopes
    }

    /// Keychain entry name: `oidc-<24 hex of SHA-256(issuer \n client id)>`.
    #[must_use]
    pub fn store_key(&self) -> String {
        let digest = Sha256::digest(format!("{}\n{}", self.issuer, self.client_id));
        let hex: String = digest.iter().take(12).map(|b| format!("{b:02x}")).collect();
        format!("oidc-{hex}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| (*v).to_owned())
        }
    }

    #[test]
    fn inactive_without_issuer_and_client_id() {
        assert!(OidcConfig::from_lookup(lookup(&[("AEDST_OIDC_ISSUER", "https://idp")])).is_none());
        assert!(OidcConfig::from_lookup(lookup(&[("AEDST_OIDC_CLIENT_ID", "c")])).is_none());
        assert!(OidcConfig::from_lookup(lookup(&[])).is_none());
    }

    #[test]
    fn scopes_include_audience_and_roles() {
        let cfg = OidcConfig::from_lookup(lookup(&[
            ("AEDST_OIDC_ISSUER", "https://idp"),
            ("AEDST_OIDC_CLIENT_ID", "c"),
            ("AEDST_OIDC_PROJECT_ID", "42"),
        ]))
        .expect("active");
        let scopes = cfg.scopes();
        assert!(scopes.contains(&"urn:zitadel:iam:org:project:id:42:aud".to_owned()));
        assert!(scopes.contains(&"urn:zitadel:iam:org:projects:roles".to_owned()));
        assert!(
            !scopes.contains(&"openid".to_owned()),
            "openid is added by the library"
        );
    }

    #[test]
    fn store_key_is_stable_and_depends_on_both_values() {
        let a = OidcConfig::from_lookup(lookup(&[
            ("AEDST_OIDC_ISSUER", "https://idp"),
            ("AEDST_OIDC_CLIENT_ID", "c"),
        ]))
        .expect("active");
        let mut b = a.clone();
        b.client_id = "d".into();
        assert_eq!(a.store_key(), a.store_key());
        assert_ne!(a.store_key(), b.store_key());
        assert_eq!(a.store_key().len(), "oidc-".len() + 24);
    }
}
