//! E-mail addresses.

use super::EMAIL;

fn is_local(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'%' | b'+' | b'-')
}

fn is_domain(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')
}

pub(super) fn scrub_emails(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut copied = 0;
    for (at, _) in input.match_indices('@') {
        if at < copied {
            continue;
        }
        let mut start = at;
        while start > copied && is_local(bytes[start - 1]) {
            start -= 1;
        }
        let mut end = at + 1;
        while end < bytes.len() && is_domain(bytes[end]) {
            end += 1;
        }
        // Trailing dots belong to the sentence, not the domain.
        while end > at + 1 && bytes[end - 1] == b'.' {
            end -= 1;
        }
        let domain = &input[at + 1..end];
        let tld_ok = domain
            .rsplit('.')
            .next()
            .is_some_and(|tld| tld.len() >= 2 && tld.bytes().all(|b| b.is_ascii_alphabetic()));
        if start < at && domain.contains('.') && tld_ok {
            out.push_str(&input[copied..start]);
            out.push_str(EMAIL);
            copied = end;
        }
    }
    out.push_str(&input[copied..]);
    out
}
