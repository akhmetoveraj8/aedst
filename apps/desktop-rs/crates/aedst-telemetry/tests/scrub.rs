//! Table-driven tests of the one PII scrubber: what is removed, and what must NOT be.

use aedst_telemetry::{scrub_json, scrub_pii};
use serde_json::json;

const JWT: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWJ5dGVz";
const RANDOM_B64: &str = "q8Zr3KfLw0TnVb7YxP2uHd9GcJeA5sMoIt1RyEi6QpWz";
const HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

#[test]
fn removes_secrets() {
    let cases: Vec<(String, String)> = vec![
        (
            "contact jane.doe+tag@example.com now".into(),
            "contact <email> now".into(),
        ),
        (
            "mail me at a@example.co.uk.".into(),
            "mail me at <email>.".into(),
        ),
        (
            format!("got Bearer {JWT} from the server"),
            "got Bearer <redacted> from the server".into(),
        ),
        (
            "authorization: bearer abc123def456".into(),
            "authorization: <redacted>".into(),
        ),
        (format!("id token {JWT}"), "id token <redacted>".into()),
        (
            "GET https://bucket.s3.amazonaws.com/a/b.png?X-Amz-Signature=abc&X-Amz-Credential=k failed."
                .into(),
            "GET https://bucket.s3.amazonaws.com/a/b.png?<redacted> failed.".into(),
        ),
        (
            "PUT (https://host.example/up?sig=1#top)".into(),
            "PUT (https://host.example/up?<redacted>)".into(),
        ),
        (
            "https://user:pw@host.example/path#frag".into(),
            "https://<redacted>@host.example/path#<redacted>".into(),
        ),
        (
            "wss://realtime.example/socket?ticket=abc".into(),
            "wss://realtime.example/socket?<redacted>".into(),
        ),
        (
            "login password=hunter2 next".into(),
            "login password=<redacted> next".into(),
        ),
        (
            r#"{"token":"abc","n":1}"#.into(),
            r#"{"token":"<redacted>","n":1}"#.into(),
        ),
        (
            "refresh_token: r-1234 done".into(),
            "refresh_token: <redacted> done".into(),
        ),
        (
            "x-api-key=k_live_123&x=1".into(),
            "x-api-key=<redacted>&x=1".into(),
        ),
        (format!("digest {HEX} ok"), "digest <redacted> ok".into()),
        (
            format!("blob {RANDOM_B64} ok"),
            "blob <redacted> ok".into(),
        ),
        (
            r"open C:\Users\Alice\AppData\Local\x.db".into(),
            r"open C:\Users\<user>\AppData\Local\x.db".into(),
        ),
        (
            r"open C:\\Users\\Alice Smith\\x.db".into(),
            r"open C:\\Users\\<user>\\x.db".into(),
        ),
        (
            "read /home/bob/.config/aedst".into(),
            "read /home/<user>/.config/aedst".into(),
        ),
        (
            "cannot open /home/bob failed".into(),
            "cannot open /home/<user> failed".into(),
        ),
        (
            "/Users/carol/Library/Logs".into(),
            "/Users/<user>/Library/Logs".into(),
        ),
    ];
    for (input, expected) in cases {
        assert_eq!(scrub_pii(&input), expected, "input: {input}");
    }
}

#[test]
fn keeps_what_is_not_secret() {
    let keep = [
        "version 1.2.3-beta.4+build.5 started",
        "task 123e4567-e89b-12d3-a456-426614174000 done",
        "TASK 123E4567-E89B-12D3-A456-426614174000 done",
        "bearer of bad news",
        "Bearer authentication is required",
        "see https://example.com/docs/page for details",
        "user@localhost and a@b and @mention",
        "meet at 10:30",
        "aedst-feature-tasks-v2-release-candidate-build-number-forty-two",
        "/usr/lib/x86_64-linux-gnu/libfoo.so.1.2.3",
        "token_count=5 passwords are hashed",
        "the home page of users",
        "12345678901234567890123456789012345",
        "aedst-desktop@1.4.0",
        "/home/",
        "",
    ];
    for input in keep {
        assert_eq!(scrub_pii(input), input, "input: {input}");
    }
}

#[test]
fn is_idempotent() {
    let inputs = [
        format!("Authorization: Bearer {JWT} {HEX}"),
        "https://u:p@h.example/x?y=1#z mail a@b.com C:\\Users\\Al\\x".to_owned(),
        format!("{{\"password\":\"x\",\"u\":\"/home/bob/{RANDOM_B64}\"}}"),
    ];
    for input in inputs {
        let once = scrub_pii(&input);
        assert_eq!(scrub_pii(&once), once, "input: {input}");
    }
}

#[test]
fn survives_non_ascii_text() {
    let text = "ünïcode@例え.jp héllo 日本語 C:\\Users\\Åsa\\x https://例え.jp/ü?q=é";
    let out = scrub_pii(text);
    assert!(out.contains("日本語"));
    assert!(out.contains(r"C:\Users\<user>\x"));
    assert!(out.contains("?<redacted>"));
}

#[test]
fn json_values_are_scrubbed_by_key_and_by_content() {
    let mut value = json!({
        "msg": "user a@b.com failed",
        "password": 12345,
        "nested": {"Authorization": "Bearer x", "list": ["https://h/x?sig=1", 7, null]},
        "api-key": "k",
        "ok": true
    });
    scrub_json(&mut value);
    assert_eq!(
        value,
        json!({
            "msg": "user <email> failed",
            "password": "<redacted>",
            "nested": {"Authorization": "<redacted>", "list": ["https://h/x?<redacted>", 7, null]},
            "api-key": "<redacted>",
            "ok": true
        })
    );
}

#[test]
fn deeply_nested_json_does_not_overflow() {
    let mut value = json!("leaf a@b.com");
    for _ in 0..200 {
        value = json!([value]);
    }
    scrub_json(&mut value);
    assert!(!value.to_string().contains("a@b.com"));
}
