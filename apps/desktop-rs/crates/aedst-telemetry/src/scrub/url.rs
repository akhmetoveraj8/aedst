//! URLs: userinfo is replaced, query and fragment are dropped (presigned URLs).

use super::{REDACTED, scan_until};

fn ends_url(byte: u8) -> bool {
    byte.is_ascii_whitespace()
        || matches!(byte, b'"' | b'\'' | b'<' | b'>' | b'`' | b')' | b']' | b'}')
}

fn is_scheme_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-')
}

pub(super) fn scrub_urls(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut copied = 0;
    let mut search = 0;
    while let Some(found) = input[search..].find("://") {
        let marker = search + found;
        let body_start = marker + 3;
        let mut start = marker;
        while start > copied && is_scheme_byte(bytes[start - 1]) {
            start -= 1;
        }
        if start == marker || !bytes[start].is_ascii_alphabetic() {
            search = body_start;
            continue;
        }
        let mut end = scan_until(bytes, body_start, ends_url);
        while end > body_start && matches!(bytes[end - 1], b'.' | b',' | b';' | b':' | b'!' | b'?')
        {
            end -= 1;
        }
        out.push_str(&input[copied..body_start]);
        out.push_str(&clean_body(&input[body_start..end]));
        copied = end;
        search = end.max(body_start);
    }
    out.push_str(&input[copied..]);
    out
}

/// `authority/path?query#fragment` without the credentials.
fn clean_body(body: &str) -> String {
    let bytes = body.as_bytes();
    let authority_end = scan_until(bytes, 0, |b| matches!(b, b'/' | b'?' | b'#'));
    let authority = &body[..authority_end];
    let mut out = String::with_capacity(body.len());
    match authority.rfind('@') {
        Some(at) => {
            out.push_str(REDACTED);
            out.push_str(&authority[at..]);
        }
        None => out.push_str(authority),
    }
    let rest = &body[authority_end..];
    let tail = scan_until(rest.as_bytes(), 0, |b| matches!(b, b'?' | b'#'));
    out.push_str(&rest[..tail]);
    if let Some(marker) = rest[tail..].chars().next() {
        out.push(marker);
        out.push_str(REDACTED);
    }
    out
}
