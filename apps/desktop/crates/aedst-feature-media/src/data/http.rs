//! Shared HTTP helpers for the two presigned-URL transfers. Errors become an [`ErrorKind`] here;
//! a `reqwest::Error` formats the request URL, which carries the signature, so it is never
//! displayed, logged or stored.

use std::time::Duration;

use aedst_common::ErrorKind;

/// Time allowed to open a connection.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// The kind a non-success HTTP status stands for.
#[must_use]
pub fn kind_for_status(status: u16) -> ErrorKind {
    match status {
        401 | 403 => ErrorKind::Forbidden, // the presigned URL expired or was refused
        404 => ErrorKind::NotFound,
        408 => ErrorKind::Timeout,
        429 => ErrorKind::RateLimited,
        500..=599 => ErrorKind::Unavailable,
        300..=399 => ErrorKind::Unknown, // a redirect we refused to follow
        _ => ErrorKind::InvalidInput,
    }
}

/// The kind a transport failure stands for. Never formats the error.
#[must_use]
pub fn kind_for_error(error: &reqwest::Error) -> ErrorKind {
    if error.is_timeout() {
        ErrorKind::Timeout
    } else if error.is_connect() {
        ErrorKind::Offline
    } else if error.is_redirect() {
        ErrorKind::Unknown
    } else {
        ErrorKind::Unavailable
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn statuses_map_to_kinds() {
        assert_eq!(kind_for_status(403), ErrorKind::Forbidden);
        assert_eq!(kind_for_status(404), ErrorKind::NotFound);
        assert_eq!(kind_for_status(408), ErrorKind::Timeout);
        assert_eq!(kind_for_status(429), ErrorKind::RateLimited);
        assert_eq!(kind_for_status(503), ErrorKind::Unavailable);
        assert_eq!(kind_for_status(302), ErrorKind::Unknown);
        assert_eq!(kind_for_status(400), ErrorKind::InvalidInput);
    }
}
