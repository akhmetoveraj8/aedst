//! The HTTP client for the API: TLS with the OS trust store (so enterprise roots and proxies work, the
//! transport policy of the Qt app), plain HTTP only for the loopback addresses the policy allows.

use std::sync::Arc;

use connectrpc::client::HttpClient;
use rustls::{ClientConfig, RootCertStore, crypto::ring};
use url::Url;

/// Builds a rustls config from the operating system's trust anchors.
///
/// # Errors
/// A short reason when no usable root certificate exists or the provider rejects the protocol set.
pub fn native_tls_config() -> Result<Arc<ClientConfig>, String> {
    let loaded = rustls_native_certs::load_native_certs();
    let mut roots = RootCertStore::empty();
    let (added, _ignored) = roots.add_parsable_certificates(loaded.certs);
    if added == 0 {
        return Err("no usable root certificate in the OS trust store".to_owned());
    }
    // The provider is passed explicitly: both `ring` and `aws-lc-rs` are in the dependency tree, so
    // there is no process-wide default to rely on.
    let config = ClientConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

/// The client for `base`: TLS for https, cleartext for http (already limited to loopback by
/// `aedst_api::validate_base_url`).
///
/// # Errors
/// A short reason when TLS cannot be set up.
pub fn http_client(base: &Url) -> Result<HttpClient, String> {
    if base.scheme() == "https" {
        Ok(HttpClient::with_tls(native_tls_config()?))
    } else {
        Ok(HttpClient::plaintext())
    }
}
