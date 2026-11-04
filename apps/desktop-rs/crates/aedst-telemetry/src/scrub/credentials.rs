//! Bearer tokens and `key=value` credentials.

use super::json::is_sensitive_key;
use super::{REDACTED, scan_until};

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'+' | b'/' | b'=' | b'-')
}

fn is_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
}

/// A word like "authentication" after "Bearer" is prose; a token has digits, symbols or mixed case.
fn looks_like_token(word: &str) -> bool {
    let has_digit = word.bytes().any(|b| b.is_ascii_digit());
    let has_symbol = word.bytes().any(|b| !b.is_ascii_alphanumeric());
    let has_upper = word.bytes().any(|b| b.is_ascii_uppercase());
    let has_lower = word.bytes().any(|b| b.is_ascii_lowercase());
    has_digit || has_symbol || (has_upper && has_lower)
}

/// `Bearer <token>` anywhere in the text.
pub(super) fn scrub_bearer(input: &str) -> String {
    let bytes = input.as_bytes();
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut copied = 0;
    for (at, _) in lower.match_indices("bearer") {
        if at < copied || (at > 0 && bytes[at - 1].is_ascii_alphanumeric()) {
            continue;
        }
        let mut start = at + "bearer".len();
        let spaces_from = start;
        while start < bytes.len() && matches!(bytes[start], b' ' | b'\t') {
            start += 1;
        }
        if start == spaces_from {
            continue;
        }
        let end = scan_until(bytes, start, |b| !is_token_byte(b));
        let token = &input[start..end];
        if token.len() >= 8 && looks_like_token(token) {
            out.push_str(&input[copied..start]);
            out.push_str(REDACTED);
            copied = end;
        }
    }
    out.push_str(&input[copied..]);
    out
}

/// Headers whose value is the rest of the line (the scheme word comes first, or a list follows).
fn is_line_valued(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "authorization" | "proxy-authorization" | "cookie" | "set-cookie"
    )
}

/// `password=...`, `"token": "..."`, `Authorization: ...` and similar.
pub(super) fn scrub_key_values(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut copied = 0;
    for (sep, &byte) in bytes.iter().enumerate() {
        if (byte != b':' && byte != b'=') || sep < copied {
            continue;
        }
        let mut key_end = sep;
        while key_end > copied && bytes[key_end - 1] == b' ' {
            key_end -= 1;
        }
        if key_end > copied && matches!(bytes[key_end - 1], b'"' | b'\'') {
            key_end -= 1;
        }
        let mut key_start = key_end;
        while key_start > copied && is_ident_byte(bytes[key_start - 1]) {
            key_start -= 1;
        }
        let key = &input[key_start..key_end];
        if key.is_empty() || !is_sensitive_key(key) {
            continue;
        }
        let mut value = sep + 1;
        while value < bytes.len() && bytes[value] == b' ' {
            value += 1;
        }
        let quote = bytes
            .get(value)
            .copied()
            .filter(|b| matches!(b, b'"' | b'\''));
        if quote.is_some() {
            value += 1;
        }
        let end = match quote {
            Some(q) => scan_until(bytes, value, |b| b == q),
            None if is_line_valued(key) => {
                scan_until(bytes, value, |b| matches!(b, b'\n' | b'\r' | b'"'))
            }
            None => scan_until(bytes, value, |b| {
                b.is_ascii_whitespace()
                    || matches!(b, b'&' | b',' | b';' | b')' | b']' | b'}' | b'"' | b'\'')
            }),
        };
        if end == value || input[value..end].starts_with('<') {
            continue;
        }
        out.push_str(&input[copied..value]);
        out.push_str(REDACTED);
        copied = end;
    }
    out.push_str(&input[copied..]);
    out
}
