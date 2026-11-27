//! The one place that decides whether a URL coming out of the UI may be opened in the system
//! browser. `AedstAiSources::opened(url)` and `AedstAiInlineCitation::opened(url)` hand the
//! feature a string that originates in model output or a web page, so it is hostile input: the
//! feature must pass it through [`validate`] (or [`open_with`]) and never to `webbrowser`, a shell
//! or an OS "open" call directly.
//!
//! Allowed: `http`, `https` (with a host and without credentials) and `mailto` (with an address).
//! Rejected: every other scheme (`javascript`, `data`, `file`, `vbscript`, `ms-*`, custom handlers),
//! relative references, control characters (including tab and line breaks, which URL parsers drop
//! silently and which are used to smuggle a scheme), invisible and bidirectional-override characters,
//! surrounding whitespace, user information (`https://trusted.example@evil.example`) and URLs
//! longer than [`MAX_LEN`] bytes.

use url::Url;

/// The longest accepted URL, in bytes (the de-facto browser limit is 2 MiB; 2048 covers every link
/// a citation or a source list needs).
pub const MAX_LEN: usize = 2048;

/// Why a URL was refused. Carries no part of the input, so it is safe to log.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejection {
    /// Empty or longer than [`MAX_LEN`].
    Length,
    /// A control, invisible or bidirectional-override character, or surrounding whitespace.
    ForbiddenCharacter,
    /// Not an absolute URL.
    Malformed,
    /// A scheme other than `http`, `https` or `mailto`.
    Scheme,
    /// `http(s)` without a host.
    MissingHost,
    /// `http(s)` with a user name or password.
    Credentials,
    /// `mailto:` without an address.
    MissingAddress,
}

fn forbidden(c: char) -> bool {
    c.is_control()
        || c.is_whitespace()
        || matches!(
            c,
            '\u{00AD}'
                | '\u{061C}'
                | '\u{180E}'
                | '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2060}'..='\u{2064}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}'
        )
}

/// Checks `input` and returns the normalised URL, which is what may be opened.
///
/// # Errors
/// A [`Rejection`] naming the first rule the input broke.
pub fn validate(input: &str) -> Result<Url, Rejection> {
    if input.is_empty() || input.len() > MAX_LEN {
        return Err(Rejection::Length);
    }
    // Whitespace is refused anywhere: a space does not occur in a valid absolute URL (it is %20).
    if input.chars().any(forbidden) {
        return Err(Rejection::ForbiddenCharacter);
    }
    let url = Url::parse(input).map_err(|_| Rejection::Malformed)?;
    match url.scheme() {
        "http" | "https" => {
            if url.host_str().is_none_or(str::is_empty) {
                return Err(Rejection::MissingHost);
            }
            if !url.username().is_empty() || url.password().is_some() {
                return Err(Rejection::Credentials);
            }
        }
        "mailto" => {
            if url.path().is_empty() {
                return Err(Rejection::MissingAddress);
            }
        }
        _ => return Err(Rejection::Scheme),
    }
    Ok(url)
}

/// Validates `input` and passes the normalised URL to `open` (the platform's "open in browser"
/// call, for example `webbrowser::open`). `open` is not called for a rejected URL.
///
/// # Errors
/// The [`Rejection`], or whatever `open` returns, as `Err(Failure::Open)`.
pub fn open_with<E>(
    input: &str,
    open: impl FnOnce(&str) -> Result<(), E>,
) -> Result<(), Failure<E>> {
    let url = validate(input).map_err(Failure::Rejected)?;
    open(url.as_str()).map_err(Failure::Open)
}

/// The error of [`open_with`].
#[derive(Debug, PartialEq, Eq)]
pub enum Failure<E> {
    /// The URL was refused before anything was opened.
    Rejected(Rejection),
    /// The URL was fine but the platform could not open it.
    Open(E),
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn plain_web_and_mail_links_pass() {
        for ok in [
            "https://example.com",
            "http://example.com/a?b=c#d",
            "HTTPS://Example.COM/Path",
            "https://xn--bcher-kva.example/",
            "https://bücher.example/",
            "https://[2001:db8::1]:8443/x",
            "mailto:someone@example.com",
            "mailto:someone@example.com?subject=Hi%20there",
        ] {
            assert!(validate(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn the_scheme_and_host_are_normalised_to_lower_case() {
        let url = validate("HTTPS://Example.COM/Path").unwrap();
        assert_eq!(url.as_str(), "https://example.com/Path");
    }

    #[test]
    fn dangerous_schemes_are_refused() {
        for bad in [
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///C:/Windows/System32/calc.exe",
            "file://server/share/payload.exe",
            "vbscript:msgbox(1)",
            "ms-msdt:/id%20PCWDiagnostic",
            "ftp://example.com/file",
            "ssh://host",
            "tel:+123456",
            "about:blank",
            "blob:https://example.com/uuid",
            "custom-handler://run?cmd=calc",
        ] {
            assert_eq!(validate(bad), Err(Rejection::Scheme), "{bad}");
        }
    }

    #[test]
    fn control_characters_are_refused_before_the_parser_can_drop_them() {
        for bad in [
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "java\rscript:alert(1)",
            "https://example.com/\u{0}",
            "https://example.com/\u{7f}",
            "https://example.com/\u{1b}[31m",
            "https://exa\tmple.com",
            "\u{0}https://example.com",
        ] {
            assert_eq!(validate(bad), Err(Rejection::ForbiddenCharacter), "{bad:?}");
        }
    }

    #[test]
    fn whitespace_and_invisible_characters_are_refused() {
        for bad in [
            " https://example.com",
            "https://example.com ",
            "https://exa mple.com",
            "https://example.com/a b",
            "\u{a0}https://example.com",
            "https://example.com/\u{202e}txt.exe",
            "https://example.com/\u{200b}",
            "https://exam\u{ad}ple.com",
            "\u{feff}https://example.com",
            "https://example.com/\u{2066}",
        ] {
            assert_eq!(validate(bad), Err(Rejection::ForbiddenCharacter), "{bad:?}");
        }
    }

    #[test]
    fn credentials_in_the_url_are_refused() {
        for bad in [
            "https://trusted.example@evil.example/",
            "https://user:pass@example.com/",
            "http://:pass@example.com/",
        ] {
            assert_eq!(validate(bad), Err(Rejection::Credentials), "{bad}");
        }
    }

    #[test]
    fn hostless_and_relative_urls_are_refused() {
        assert_eq!(validate("https://"), Err(Rejection::Malformed));
        for bad in ["/relative/path", "//example.com/x", "example.com", "www.example.com", "?q=1", "#frag"] {
            assert_eq!(validate(bad), Err(Rejection::Malformed), "{bad}");
        }
    }

    #[test]
    fn an_empty_mailto_is_refused() {
        assert_eq!(validate("mailto:"), Err(Rejection::MissingAddress));
    }

    #[test]
    fn empty_and_oversized_input_is_refused() {
        assert_eq!(validate(""), Err(Rejection::Length));
        let long = format!("https://example.com/{}", "a".repeat(MAX_LEN));
        assert_eq!(validate(&long), Err(Rejection::Length));
        let at_limit = format!("https://example.com/{}", "a".repeat(MAX_LEN - 20));
        assert!(validate(&at_limit).is_ok());
    }

    #[test]
    fn open_with_never_calls_the_opener_for_a_rejected_url() {
        let mut calls = 0;
        let refused = open_with("javascript:alert(1)", |_| {
            calls += 1;
            Ok::<(), ()>(())
        });
        assert_eq!(refused, Err(Failure::Rejected(Rejection::Scheme)));
        assert_eq!(calls, 0);
    }

    #[test]
    fn open_with_passes_the_normalised_url_and_reports_an_opener_failure() {
        let mut seen = String::new();
        let opened = open_with("HTTPS://Example.com", |url| {
            seen = url.to_owned();
            Ok::<(), ()>(())
        });
        assert_eq!(opened, Ok(()));
        assert_eq!(seen, "https://example.com/");

        let failed = open_with("https://example.com", |_| Err("no browser"));
        assert_eq!(failed, Err(Failure::Open("no browser")));
    }
}
