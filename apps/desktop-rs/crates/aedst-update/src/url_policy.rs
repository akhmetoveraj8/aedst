//! Transport policy for every URL that comes from configuration or from a manifest.
//!
//! https only; plain http only for loopback hosts in debug builds (or with `AEDST_ALLOW_INSECURE_LOCALHOST`),
//! the same rule as `aedst_api::validate_base_url`. No userinfo, no control characters or backslashes (the URL
//! parser would silently rewrite them), and a redirect may never leave the host it started from.

use url::Url;

const MAX_URL_BYTES: usize = 2048;
/// Redirects followed before a download is abandoned.
pub const MAX_REDIRECTS: usize = 5;

/// Why a URL was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UrlError {
    /// Not a URL, too long, or contains characters that are never legitimate.
    #[error("the URL is malformed")]
    Malformed,
    /// Not https (and not allowed loopback http).
    #[error("the URL must be https")]
    Insecure,
    /// `user:password@host`.
    #[error("the URL carries credentials")]
    Userinfo,
    /// A redirect to another host, or from https to http.
    #[error("a redirect would leave the original host or downgrade the scheme")]
    RedirectOffHost,
}

fn insecure_localhost_allowed() -> bool {
    cfg!(debug_assertions) || std::env::var_os("AEDST_ALLOW_INSECURE_LOCALHOST").is_some()
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Parses and checks a URL taken from configuration or from a manifest.
///
/// # Errors
/// [`UrlError`] when the URL breaks the policy.
pub fn validate_url(text: &str) -> Result<Url, UrlError> {
    let clean = text.len() <= MAX_URL_BYTES
        && text
            .bytes()
            .all(|b| b > 0x20 && b < 0x7f && !matches!(b, b'\\' | b'"' | b'<' | b'>'));
    if !clean {
        return Err(UrlError::Malformed);
    }
    let url = Url::parse(text).map_err(|_| UrlError::Malformed)?;
    if url.host().is_none() {
        return Err(UrlError::Malformed);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UrlError::Userinfo);
    }
    match url.scheme() {
        "https" => Ok(url),
        "http" if is_loopback(&url) && insecure_localhost_allowed() => Ok(url),
        _ => Err(UrlError::Insecure),
    }
}

/// Checks one redirect hop: same host and port, and never https -> http.
///
/// # Errors
/// [`UrlError`] when `target` breaks the policy or is not the same host as `original`.
pub fn check_redirect(original: &Url, target: &Url) -> Result<(), UrlError> {
    validate_url(target.as_str())?;
    let same_host = original.host_str().map(str::to_ascii_lowercase)
        == target.host_str().map(str::to_ascii_lowercase)
        && original.port_or_known_default() == target.port_or_known_default();
    let downgrade = original.scheme() == "https" && target.scheme() != "https";
    if same_host && !downgrade {
        Ok(())
    } else {
        Err(UrlError::RedirectOffHost)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_and_loopback_http_pass() {
        assert!(validate_url("https://updates.example.com/stable.json").is_ok());
        assert_eq!(
            validate_url("http://updates.example.com/a"),
            Err(UrlError::Insecure)
        );
        assert_eq!(
            validate_url("ftp://updates.example.com/a"),
            Err(UrlError::Insecure)
        );
        assert!(
            validate_url("http://127.0.0.1:8080/a").is_ok(),
            "debug build"
        );
        assert!(validate_url("http://localhost/a").is_ok(), "debug build");
        assert_eq!(
            validate_url("http://127.0.0.1.evil.com/a"),
            Err(UrlError::Insecure)
        );
    }

    #[test]
    fn userinfo_and_odd_characters_are_refused() {
        assert_eq!(
            validate_url("https://user:pw@example.com/a"),
            Err(UrlError::Userinfo)
        );
        assert_eq!(
            validate_url("https://user@example.com/a"),
            Err(UrlError::Userinfo)
        );
        assert_eq!(
            validate_url("https://example.com\\evil.com/a"),
            Err(UrlError::Malformed)
        );
        assert_eq!(
            validate_url("https://exa mple.com/"),
            Err(UrlError::Malformed)
        );
        assert_eq!(
            validate_url("https://example.com/\u{e9}"),
            Err(UrlError::Malformed)
        );
        assert_eq!(validate_url("not a url"), Err(UrlError::Malformed));
        assert_eq!(validate_url(""), Err(UrlError::Malformed));
        let long = format!("https://example.com/{}", "a".repeat(3000));
        assert_eq!(validate_url(&long), Err(UrlError::Malformed));
    }

    #[test]
    fn redirects_stay_on_the_host() {
        let from = Url::parse("https://updates.example.com/a").unwrap();
        let same = Url::parse("https://UPDATES.example.com/b").unwrap();
        let other = Url::parse("https://cdn.example.com/b").unwrap();
        let port = Url::parse("https://updates.example.com:8443/b").unwrap();
        let plain = Url::parse("http://updates.example.com/b").unwrap();
        assert_eq!(check_redirect(&from, &same), Ok(()));
        assert_eq!(
            check_redirect(&from, &other),
            Err(UrlError::RedirectOffHost)
        );
        assert_eq!(check_redirect(&from, &port), Err(UrlError::RedirectOffHost));
        assert!(check_redirect(&from, &plain).is_err());
    }
}
