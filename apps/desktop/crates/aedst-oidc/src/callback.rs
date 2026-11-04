//! Judging the loopback redirect request (RFC 8252 section 7.3, RFC 9207). Pure: no I/O.
//!
//! Rules: exact path `/callback`, `Host` equal to the listener's own `ip:port` (DNS rebinding),
//! GET only, head at most 8 KiB, every parameter at most once, `state` compared in constant time,
//! `iss` checked when present (required when the provider announced it), `error` handled only
//! after the state check.

use subtle::ConstantTimeEq;
use url::Url;

/// Largest request head we read.
pub const MAX_HEAD_BYTES: usize = 8 * 1024;
/// The only path that ends the wait.
pub const CALLBACK_PATH: &str = "/callback";

/// Why a callback request was refused. The first request to the callback path ends the wait.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CallbackError {
    /// Not a well-formed `GET <target> HTTP/1.x` head.
    #[error("malformed request")]
    Malformed,
    /// A method other than GET.
    #[error("wrong method")]
    WrongMethod,
    /// `Host` is not the listener's own address.
    #[error("wrong host")]
    WrongHost,
    /// A parameter appeared twice.
    #[error("duplicate parameter")]
    DuplicateParameter,
    /// `state` is missing or differs.
    #[error("state mismatch")]
    StateMismatch,
    /// `iss` differs, or is missing although the provider announced it.
    #[error("issuer mismatch")]
    IssuerMismatch,
    /// The provider reported an error (for example `access_denied`).
    #[error("provider error: {0}")]
    Provider(String),
    /// No `code` parameter.
    #[error("missing code")]
    MissingCode,
}

/// What the listener expects from this sign-in attempt.
#[derive(Clone, Debug)]
pub struct Expectation {
    /// `ip:port` the listener is bound to, as the browser sends it in `Host`.
    pub authority: String,
    /// The `state` value of this attempt.
    pub state: String,
    /// The issuer, compared with `iss` when present.
    pub issuer: String,
    /// True when the discovery document says `iss` is always sent.
    pub iss_required: bool,
}

/// True when the request line targets the callback path (even if the rest is wrong).
#[must_use]
pub fn targets_callback(head: &str) -> bool {
    request_target(head).is_some_and(|t| t.split('?').next() == Some(CALLBACK_PATH))
}

fn request_target(head: &str) -> Option<&str> {
    head.lines().next()?.split_whitespace().nth(1)
}

/// Returns the authorization code, or the reason the request must fail the sign-in.
///
/// # Errors
/// Any [`CallbackError`]; the caller treats every one as a failed sign-in (fail closed).
pub fn parse_callback(head: &str, expect: &Expectation) -> Result<String, CallbackError> {
    let mut lines = head.split("\r\n");
    let mut parts = lines.next().ok_or(CallbackError::Malformed)?.split(' ');
    let (method, target, version) = (parts.next(), parts.next(), parts.next());
    if parts.next().is_some() || !version.is_some_and(|v| v.starts_with("HTTP/1.")) {
        return Err(CallbackError::Malformed);
    }
    if method != Some("GET") {
        return Err(CallbackError::WrongMethod);
    }
    let target = target.ok_or(CallbackError::Malformed)?;
    let host = lines
        .by_ref()
        .take_while(|l| !l.is_empty())
        .find_map(|l| {
            l.split_once(':')
                .filter(|(n, _)| n.eq_ignore_ascii_case("host"))
        })
        .map(|(_, v)| v.trim());
    if host != Some(expect.authority.as_str()) {
        return Err(CallbackError::WrongHost);
    }

    let url = Url::parse(&format!("http://{}{target}", expect.authority))
        .map_err(|_| CallbackError::Malformed)?;
    if url.path() != CALLBACK_PATH {
        return Err(CallbackError::Malformed);
    }
    let (mut code, mut state, mut iss, mut error) = (None, None, None, None);
    for (name, value) in url.query_pairs() {
        let slot = match name.as_ref() {
            "code" => &mut code,
            "state" => &mut state,
            "iss" => &mut iss,
            "error" => &mut error,
            _ => continue,
        };
        if slot.replace(value.into_owned()).is_some() {
            return Err(CallbackError::DuplicateParameter);
        }
    }

    let state_ok = state
        .as_deref()
        .is_some_and(|s| s.as_bytes().ct_eq(expect.state.as_bytes()).into());
    if !state_ok {
        return Err(CallbackError::StateMismatch);
    }
    match iss.as_deref() {
        Some(i) if i != expect.issuer => return Err(CallbackError::IssuerMismatch),
        None if expect.iss_required => return Err(CallbackError::IssuerMismatch),
        _ => {}
    }
    if let Some(error) = error {
        return Err(CallbackError::Provider(error));
    }
    code.filter(|c| !c.is_empty())
        .ok_or(CallbackError::MissingCode)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expect() -> Expectation {
        Expectation {
            authority: "127.0.0.1:5000".into(),
            state: "s3cret".into(),
            issuer: "https://idp.example".into(),
            iss_required: false,
        }
    }

    fn get(target: &str, host: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n\r\n")
    }

    #[test]
    fn accepts_a_well_formed_callback() {
        let head = get("/callback?code=abc&state=s3cret", "127.0.0.1:5000");
        assert_eq!(parse_callback(&head, &expect()), Ok("abc".into()));
    }

    #[test]
    fn rejects_a_foreign_host() {
        let head = get("/callback?code=abc&state=s3cret", "evil.example:5000");
        assert_eq!(
            parse_callback(&head, &expect()),
            Err(CallbackError::WrongHost)
        );
    }

    #[test]
    fn rejects_wrong_state_and_missing_state() {
        let head = get("/callback?code=abc&state=nope", "127.0.0.1:5000");
        assert_eq!(
            parse_callback(&head, &expect()),
            Err(CallbackError::StateMismatch)
        );
        let head = get("/callback?code=abc", "127.0.0.1:5000");
        assert_eq!(
            parse_callback(&head, &expect()),
            Err(CallbackError::StateMismatch)
        );
    }

    #[test]
    fn rejects_duplicate_parameters() {
        let head = get("/callback?code=a&code=b&state=s3cret", "127.0.0.1:5000");
        assert_eq!(
            parse_callback(&head, &expect()),
            Err(CallbackError::DuplicateParameter)
        );
    }

    #[test]
    fn rejects_post() {
        let head = "POST /callback?code=a&state=s3cret HTTP/1.1\r\nHost: 127.0.0.1:5000\r\n\r\n";
        assert_eq!(
            parse_callback(head, &expect()),
            Err(CallbackError::WrongMethod)
        );
    }

    #[test]
    fn issuer_is_checked_when_present_and_required_when_announced() {
        let head = get(
            "/callback?code=a&state=s3cret&iss=https://other",
            "127.0.0.1:5000",
        );
        assert_eq!(
            parse_callback(&head, &expect()),
            Err(CallbackError::IssuerMismatch)
        );
        let mut strict = expect();
        strict.iss_required = true;
        let head = get("/callback?code=a&state=s3cret", "127.0.0.1:5000");
        assert_eq!(
            parse_callback(&head, &strict),
            Err(CallbackError::IssuerMismatch)
        );
    }

    #[test]
    fn provider_error_is_reported_only_after_the_state_check() {
        let head = get(
            "/callback?error=access_denied&state=s3cret",
            "127.0.0.1:5000",
        );
        assert_eq!(
            parse_callback(&head, &expect()),
            Err(CallbackError::Provider("access_denied".into()))
        );
        let head = get("/callback?error=access_denied&state=bad", "127.0.0.1:5000");
        assert_eq!(
            parse_callback(&head, &expect()),
            Err(CallbackError::StateMismatch)
        );
    }

    #[test]
    fn other_paths_do_not_target_the_callback() {
        assert!(targets_callback(&get("/callback?x=1", "h")));
        assert!(!targets_callback(&get("/favicon.ico", "h")));
        assert!(!targets_callback(&get("/callback/extra", "h")));
    }
}
