//! The account name inside user home paths: `C:\Users\<name>\`, `/home/<name>/`, `/Users/<name>/`.

use super::{USER, scan_until};

fn is_sep(byte: u8) -> bool {
    matches!(byte, b'/' | b'\\')
}

fn ends_name(byte: u8) -> bool {
    is_sep(byte)
        || matches!(
            byte,
            b'"' | b'\'' | b'\n' | b'\r' | b'<' | b'>' | b':' | b'*' | b'?' | b'|'
        )
}

pub(super) fn scrub_home_paths(input: &str) -> String {
    let bytes = input.as_bytes();
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut copied = 0;
    let mut i = 0;
    while i < bytes.len() {
        let component = ["users", "home"]
            .into_iter()
            .find(|c| lower.as_bytes()[i..].starts_with(c.as_bytes()));
        let Some(component) = component else {
            i += 1;
            continue;
        };
        let after = i + component.len();
        let preceded = i > 0 && is_sep(bytes[i - 1]);
        let mut name_start = after;
        while name_start < bytes.len() && name_start < after + 2 && is_sep(bytes[name_start]) {
            name_start += 1;
        }
        if !preceded || name_start == after || name_start >= bytes.len() || i < copied {
            i = after;
            continue;
        }
        let mut name_end = scan_until(bytes, name_start, ends_name);
        // Names may hold spaces ("John Smith") when a separator follows; otherwise stop at a space.
        let first_space = scan_until(bytes, name_start, |b| b.is_ascii_whitespace());
        let closes_with_sep = name_end < bytes.len() && is_sep(bytes[name_end]);
        if first_space < name_end && !closes_with_sep {
            name_end = first_space;
        }
        let name = &input[name_start..name_end];
        if name.is_empty() || name.starts_with('<') || name == "." || name == ".." {
            i = name_start;
            continue;
        }
        out.push_str(&input[copied..name_start]);
        out.push_str(USER);
        copied = name_end;
        i = name_end;
    }
    out.push_str(&input[copied..]);
    out
}
