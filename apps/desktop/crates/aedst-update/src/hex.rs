//! Strict hexadecimal codec for fixed-size values (SHA-256, Ed25519 keys and signatures).
//!
//! The approved dependency list has no hex crate; this is 20 lines of domain glue, not a general codec.

/// Decodes exactly `2 * N` hex digits (either case) into `N` bytes.
pub(crate) fn decode_fixed<const N: usize>(text: &str) -> Option<[u8; N]> {
    let bytes = text.as_bytes();
    if bytes.len() != N * 2 {
        return None;
    }
    let mut out = [0_u8; N];
    for (slot, pair) in out.iter_mut().zip(bytes.windows(2).step_by(2)) {
        *slot = (nibble(pair[0])? << 4) | nibble(pair[1])?;
    }
    Some(out)
}

/// Lowercase hex of `bytes`.
pub(crate) fn encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    out
}

fn nibble(digit: u8) -> Option<u8> {
    match digit {
        b'0'..=b'9' => Some(digit - b'0'),
        b'a'..=b'f' => Some(digit - b'a' + 10),
        b'A'..=b'F' => Some(digit - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_bad_input() {
        let bytes = [0x00, 0xab, 0xff];
        assert_eq!(encode(&bytes), "00abff");
        assert_eq!(decode_fixed::<3>("00ABff"), Some(bytes));
        assert_eq!(decode_fixed::<3>("00abf"), None);
        assert_eq!(decode_fixed::<3>("00abfg"), None);
        assert_eq!(decode_fixed::<2>("00abff"), None);
        assert_eq!(decode_fixed::<1>("\u{e9}a"), None);
    }
}
