//! The transport policy for presigned URLs: https only, plain http for loopback in debug builds
//! (the same rule as `aedst_api::validate_base_url`), no embedded credentials, and a redirect may
//! only stay on the scheme and policy of the request that started it.
//!
//! A presigned URL carries its signature in the query string, so nothing here formats a URL into
//! an error or a log line.

use aedst_common::ErrorKind;
use url::Url;

use crate::domain::SecretUrl;

/// Redirects followed for an image download. Uploads follow none (the body must not be re-sent).
pub const MAX_REDIRECTS: usize = 3;

/// Parses and checks a presigned URL. The query string is allowed (it is the signature).
///
/// # Errors
/// [`ErrorKind::Unknown`] when the URL is unusable, insecure or carries user info: the server
/// sent something this client must not use, which is not the user's input.
pub fn check_transfer_url(url: &SecretUrl) -> Result<Url, ErrorKind> {
    let mut without_query = Url::parse(url.expose()).map_err(|_| ErrorKind::Unknown)?;
    without_query.set_query(None);
    without_query.set_fragment(None);
    aedst_api::validate_base_url(without_query.as_str()).map_err(|_| ErrorKind::Unknown)?;
    let parsed = Url::parse(url.expose()).map_err(|_| ErrorKind::Unknown)?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ErrorKind::Unknown);
    }
    Ok(parsed)
}

/// True when a redirect from `from` to `to` may be followed: same scheme, and `to` passes the
/// same policy (an https download is never bounced to http, nor to another scheme).
#[must_use]
pub fn redirect_allowed(from: &Url, to: &Url) -> bool {
    from.scheme() == to.scheme() && check_transfer_url(&SecretUrl::new(to.as_str())).is_ok()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn check(url: &str) -> Result<Url, ErrorKind> {
        check_transfer_url(&SecretUrl::new(url))
    }

    #[test]
    fn https_with_a_signature_query_is_accepted() {
        assert!(check("https://bucket.example.com/media/x?X-Amz-Signature=abc").is_ok());
    }

    #[test]
    fn plain_http_is_accepted_for_loopback_only() {
        assert!(
            check("http://127.0.0.1:9000/o?sig=1").is_ok(),
            "debug build"
        );
        assert!(check("http://localhost:9000/o").is_ok());
        assert_eq!(
            check("http://bucket.example.com/o?sig=1"),
            Err(ErrorKind::Unknown)
        );
    }

    #[test]
    fn other_schemes_garbage_and_user_info_are_refused() {
        assert!(check("ftp://bucket.example.com/o").is_err());
        assert!(check("file:///etc/passwd").is_err());
        assert!(check("not a url").is_err());
        assert!(check("").is_err());
        assert!(check("https://user:pw@bucket.example.com/o").is_err());
    }

    #[test]
    fn a_redirect_may_not_change_scheme_or_leave_the_policy() {
        let https = Url::parse("https://a.example.com/o?s=1").unwrap();
        let other = Url::parse("https://b.example.com/o").unwrap();
        let plain = Url::parse("http://127.0.0.1/o").unwrap();
        let insecure = Url::parse("http://b.example.com/o").unwrap();
        assert!(redirect_allowed(&https, &other));
        assert!(
            !redirect_allowed(&https, &plain),
            "https to http is refused"
        );
        assert!(
            !redirect_allowed(&plain, &https),
            "http to https is also a scheme change"
        );
        assert!(!redirect_allowed(&plain, &insecure));
    }
}
