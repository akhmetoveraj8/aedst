//! The one PII scrubber. Log lines, breadcrumbs, `before_send` and analytics properties all go
//! through [`scrub_pii`] / [`scrub_json`], so there is a single definition of "sensitive".
//!
//! Removed: URL userinfo and the query and fragment of URLs (presigned URLs carry their credentials
//! there), bearer tokens, `key=value` credentials (`password`, `token`, `authorization`, ...), JWTs,
//! e-mail addresses, the account name inside user home paths, and long hex / base64 secrets.
//! Not secrets: version numbers, hyphenated UUIDs, ordinary words and file paths.
//!
//! No regex crate: it is not an approved dependency, and a small scanner keeps every rule testable.

mod credentials;
mod email;
mod json;
mod path;
mod tokens;
mod url;

pub use json::{is_sensitive_key, scrub_json};

/// Replacement for a removed secret.
pub const REDACTED: &str = "<redacted>";
/// Replacement for an e-mail address.
pub const EMAIL: &str = "<email>";
/// Replacement for the account name in a home path.
pub const USER: &str = "<user>";

/// Returns `input` with every sensitive value replaced. Idempotent.
#[must_use]
pub fn scrub_pii(input: &str) -> String {
    let text = url::scrub_urls(input);
    let text = credentials::scrub_bearer(&text);
    let text = credentials::scrub_key_values(&text);
    let text = tokens::scrub_jwts(&text);
    let text = email::scrub_emails(&text);
    let text = path::scrub_home_paths(&text);
    tokens::scrub_long_tokens(&text)
}

/// Index of the first byte at or after `from` for which `stop` is true, or the end. Passes cut
/// strings only next to ASCII bytes, so every cut is on a char boundary.
pub(crate) fn scan_until(bytes: &[u8], from: usize, stop: impl Fn(u8) -> bool) -> usize {
    bytes[from..]
        .iter()
        .position(|&b| stop(b))
        .map_or(bytes.len(), |offset| from + offset)
}
