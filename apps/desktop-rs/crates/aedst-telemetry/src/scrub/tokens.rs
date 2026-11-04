//! JWTs and long hex / base64 secrets.

use super::{REDACTED, scan_until};

const HEX_MIN: usize = 32;
const BASE64_MIN: usize = 40;
const ENTROPY_MIN: f64 = 4.0;

fn is_jwt_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
}

/// `eyJ...` with at least two dots: a JWS or JWE compact serialisation.
pub(super) fn scrub_jwts(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut copied = 0;
    for (at, _) in input.match_indices("eyJ") {
        if at < copied || (at > 0 && bytes[at - 1].is_ascii_alphanumeric()) {
            continue;
        }
        let end = scan_until(bytes, at, |b| !is_jwt_byte(b));
        let token = &input[at..end];
        let dots = token.bytes().filter(|&b| b == b'.').count();
        let segments_ok = token.split('.').take(2).all(|s| s.len() >= 2);
        if dots >= 2 && segments_ok {
            out.push_str(&input[copied..at]);
            out.push_str(REDACTED);
            copied = end;
        }
    }
    out.push_str(&input[copied..]);
    out
}

fn is_run_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'_' | b'-')
}

fn is_hex_secret(segment: &str) -> bool {
    segment.len() >= HEX_MIN
        && segment.bytes().all(|b| b.is_ascii_hexdigit())
        && segment.bytes().any(|b| b.is_ascii_alphabetic())
}

/// Shannon entropy in bits per byte.
fn entropy(text: &str) -> f64 {
    let mut counts = [0_u32; 256];
    for byte in text.bytes() {
        counts[usize::from(byte)] += 1;
    }
    let len = f64::from(u32::try_from(text.len()).unwrap_or(u32::MAX));
    counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = f64::from(c) / len;
            -p * p.log2()
        })
        .sum()
}

/// `kebab-case-identifiers`: several short pieces between separators.
fn is_word_chain(run: &str) -> bool {
    let pieces: Vec<&str> = run.split(['-', '_']).collect();
    pieces.len() > 3 && pieces.iter().all(|p| p.len() <= 12)
}

fn is_base64_secret(run: &str) -> bool {
    run.len() >= BASE64_MIN
        && !is_word_chain(run)
        && run.bytes().any(|b| b.is_ascii_digit())
        && run.bytes().any(|b| b.is_ascii_alphabetic())
        && entropy(run) >= ENTROPY_MIN
}

/// Runs of base64 / base64url characters that are hex digests (32+ digits) or high-entropy blobs
/// (40+ characters). Hyphenated UUIDs are 36 characters and stay. A `/` ends a run, so file paths
/// are not mistaken for secrets (a standard-base64 secret is then only caught piecewise).
pub(super) fn scrub_long_tokens(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut copied = 0;
    let mut i = 0;
    while i < bytes.len() {
        if !is_run_byte(bytes[i]) {
            i += 1;
            continue;
        }
        let end = scan_until(bytes, i, |b| !is_run_byte(b));
        let run = &input[i..end];
        let hex = run.split(['-', '_']).any(is_hex_secret);
        if hex || is_base64_secret(run) {
            out.push_str(&input[copied..i]);
            out.push_str(REDACTED);
            copied = end;
        }
        i = end;
    }
    out.push_str(&input[copied..]);
    out
}
