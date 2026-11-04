//! JSON values: every string is scrubbed, and values under credential-like keys are replaced.

use serde_json::Value;

use super::{REDACTED, scrub_pii};

const MAX_DEPTH: usize = 64;

/// A key whose value is a credential no matter what the value looks like.
#[must_use]
pub fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace('-', "_");
    const EXACT: [&str; 11] = [
        "password",
        "passwd",
        "pwd",
        "secret",
        "token",
        "authorization",
        "proxy_authorization",
        "cookie",
        "set_cookie",
        "credential",
        "credentials",
    ];
    const SUFFIXES: [&str; 8] = [
        "_token",
        "_secret",
        "_password",
        "_passwd",
        "api_key",
        "secret_key",
        "private_key",
        "access_key",
    ];
    EXACT.contains(&key.as_str()) || SUFFIXES.iter().any(|s| key.ends_with(s))
}

/// Scrubs every string in `value` in place. Structures nested deeper than 64 levels are replaced.
pub fn scrub_json(value: &mut Value) {
    scrub_at(value, 0);
}

fn scrub_at(value: &mut Value, depth: usize) {
    if depth > MAX_DEPTH {
        *value = Value::String(REDACTED.to_owned());
        return;
    }
    match value {
        Value::String(text) => *text = scrub_pii(text),
        Value::Array(items) => items.iter_mut().for_each(|v| scrub_at(v, depth + 1)),
        Value::Object(map) => {
            for (key, inner) in map.iter_mut() {
                if is_sensitive_key(key) {
                    *inner = Value::String(REDACTED.to_owned());
                } else {
                    scrub_at(inner, depth + 1);
                }
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}
