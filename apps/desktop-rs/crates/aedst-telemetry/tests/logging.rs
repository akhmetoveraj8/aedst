#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Logging: JSON lines in a rolling file, and nothing sensitive reaches the disk.

use std::fs;
use std::io::Write;

use aedst_telemetry::logging::{LoggingConfig, Redacting, build_subscriber};

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("aedst-telemetry-{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn read_log(dir: &std::path::Path) -> String {
    let mut text = String::new();
    for entry in fs::read_dir(dir).unwrap() {
        text.push_str(&fs::read_to_string(entry.unwrap().path()).unwrap());
    }
    text
}

#[test]
fn log_lines_are_json_and_redacted_on_disk() {
    let dir = temp_dir("redact");
    let (subscriber, guard) = build_subscriber(&LoggingConfig::new(&dir)).unwrap();
    tracing::subscriber::with_default(subscriber, || {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLWJ5dGVz";
        tracing::info!(
            user = "jane@example.com",
            token = jwt,
            "signed in as jane@example.com"
        );
        tracing::warn!(
            upload_url = "https://bucket.s3.amazonaws.com/o/1?X-Amz-Signature=deadbeef",
            "PUT https://bucket.s3.amazonaws.com/o/1?X-Amz-Signature=deadbeef failed"
        );
        tracing::error!(
            path = r"C:\Users\Alice\AppData\x.db",
            "Authorization: Bearer abc123def456"
        );
        tracing::debug!("debug is filtered out by the default `info` filter");
        tracing::info!(count = 3, "kept plain text: version 1.2.3");
    });
    drop(guard);

    let text = read_log(&dir);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 4, "debug line is filtered: {text}");
    for line in &lines {
        serde_json::from_str::<serde_json::Value>(line).expect("each line is JSON");
    }
    for secret in [
        "jane@example.com",
        "eyJhbGci",
        "X-Amz-Signature",
        "deadbeef",
        "Alice",
        "abc123def456",
    ] {
        assert!(
            !text.contains(secret),
            "{secret} leaked into the log: {text}"
        );
    }
    assert!(text.contains("<email>"));
    assert!(text.contains("https://bucket.s3.amazonaws.com/o/1?<redacted>"));
    assert!(text.contains("kept plain text: version 1.2.3"));
    assert!(text.contains(r"Users\\<user>\\AppData") || text.contains("<user>"));
}

#[test]
fn the_file_name_has_the_prefix_and_the_log_suffix() {
    let dir = temp_dir("name");
    let (subscriber, guard) = build_subscriber(&LoggingConfig::new(&dir)).unwrap();
    tracing::subscriber::with_default(subscriber, || tracing::info!("hello"));
    drop(guard);
    let names: Vec<String> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), 1);
    assert!(
        names[0].starts_with("aedst.") && names[0].ends_with(".log"),
        "{names:?}"
    );
}

#[test]
fn an_invalid_default_filter_is_an_error() {
    let dir = temp_dir("filter");
    let mut config = LoggingConfig::new(&dir);
    config.default_filter = "[[[not a filter".into();
    assert!(build_subscriber(&config).is_err());
}

/// The writer redacts even when a line arrives in several `write` calls, or without a newline.
#[test]
fn the_redacting_writer_handles_split_writes_and_a_final_partial_line() {
    use tracing_subscriber::fmt::MakeWriter;

    #[derive(Clone, Default)]
    struct Sink(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl MakeWriter<'_> for Sink {
        type Writer = Sink;
        fn make_writer(&self) -> Sink {
            self.clone()
        }
    }

    let sink = Sink::default();
    let make = Redacting::new(sink.clone());
    {
        let mut writer = make.make_writer();
        writer.write_all(b"mail jane@exa").unwrap();
        writer
            .write_all(b"mple.com today\nsecond: password=hunter2")
            .unwrap();
    }
    let out = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
    assert_eq!(out, "mail <email> today\nsecond: password=<redacted>\n");
}
