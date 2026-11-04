#![allow(clippy::unwrap_used, clippy::expect_used)]
//! End-to-end tests. All keys are generated at run time in a temp directory; none exists in the repository.

use std::path::{Path, PathBuf};

use aedst_release::{Output, ReleaseError, run};
use aedst_update::{TrustedKeys, verify_manifest};

struct Dir(PathBuf);

impl Dir {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("aedst-release-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn p(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn cmd(args: &[&str]) -> Result<Output, ReleaseError> {
    let owned: Vec<String> = args.iter().map(|a| (*a).to_owned()).collect();
    run(&owned)
}

const SHA: &str = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";

fn write_feed(dir: &Dir) {
    let feed = format!(
        r#"{{"Assets":[
        {{"PackageId":"Aedst","Version":"1.0.0","Type":"Full","FileName":"Aedst-1.0.0-full.nupkg","SHA256":"{}","Size":5}},
        {{"PackageId":"Aedst","Version":"1.2.0","Type":"Delta","FileName":"Aedst-1.2.0-delta.nupkg","SHA256":"{SHA}","Size":7}},
        {{"PackageId":"Aedst","Version":"1.2.0","Type":"Full","FileName":"Aedst-1.2.0-full.nupkg","SHA256":"{SHA}","Size":1234}}
        ]}}"#,
        "00".repeat(32)
    );
    std::fs::write(dir.path("feed.json"), feed).unwrap();
}

fn make_manifest(dir: &Dir, name: &str, extra: &[&str]) -> Result<Output, ReleaseError> {
    let out = dir.p(name);
    let feed = dir.p("feed.json");
    let mut args = vec![
        "manifest",
        "--version",
        "1.2.0",
        "--channel",
        "stable",
        "--feed-entry",
        &feed,
        "--published-at",
        "2026-11-01T12:00:00Z",
        "--base-url",
        "https://updates.example.com/win",
        "--notes-url",
        "https://example.com/notes/1.2.0",
        "--out",
        &out,
    ];
    args.extend_from_slice(extra);
    cmd(&args)
}

/// keygen + manifest + sign; returns (key-id, public key hex).
fn signed(dir: &Dir) -> (String, String) {
    write_feed(dir);
    let key = cmd(&["keygen", "--out", &dir.p("release.key")]).unwrap();
    let id = key.get("key-id").unwrap().to_owned();
    let public = key.get("public-key").unwrap().to_owned();
    make_manifest(dir, "manifest.json", &["--expires-in-days", "30"]).unwrap();
    let out = cmd(&[
        "sign",
        "--manifest",
        &dir.p("manifest.json"),
        "--key",
        &dir.p("release.key"),
        "--key-id",
        &id,
        "--out",
        &dir.p("envelope.json"),
    ])
    .unwrap();
    assert_eq!(out.get("verified"), Some("true"));
    (id, public)
}

#[test]
fn full_round_trip_is_accepted_by_the_apps_verifier() {
    let dir = Dir::new();
    let (id, public) = signed(&dir);
    assert_eq!(id.len(), 16);
    assert_eq!(public.len(), 64);

    let key_text = std::fs::read_to_string(dir.path("release.key")).unwrap();
    assert_eq!(key_text.trim().len(), 64);

    let spec = format!("{id}:{public}");
    let out = cmd(&[
        "verify",
        "--envelope",
        &dir.p("envelope.json"),
        "--keys",
        &spec,
    ])
    .unwrap();
    assert_eq!(out.get("channel"), Some("stable"));
    assert_eq!(out.get("version"), Some("1.2.0"));
    assert_eq!(
        out.get("published-at-rfc3339"),
        Some("2026-11-01T12:00:00+00:00")
    );

    // The app's own call, independent of the tool's command.
    let bytes = std::fs::read(dir.path("envelope.json")).unwrap();
    let manifest = verify_manifest(&bytes, &TrustedKeys::parse(&spec).unwrap()).unwrap();
    let artifact = manifest.artifact_for("windows", "x86_64").unwrap();
    assert_eq!(artifact.size, 1234);
    assert_eq!(artifact.sha256[0], 0xab);
    assert_eq!(
        artifact.url.as_str(),
        "https://updates.example.com/win/Aedst-1.2.0-full.nupkg"
    );
    assert_eq!(
        manifest.expires_at,
        Some(manifest.published_at + 30 * 86_400)
    );
    assert!(!manifest.rollback);
}

#[test]
fn the_payload_is_the_files_exact_text() {
    let dir = Dir::new();
    signed(&dir);
    let manifest = std::fs::read_to_string(dir.path("manifest.json")).unwrap();
    let envelope: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path("envelope.json")).unwrap()).unwrap();
    assert_eq!(envelope["payload"].as_str(), Some(manifest.as_str()));
}

#[test]
fn rollback_flag_is_carried_into_the_manifest() {
    let dir = Dir::new();
    write_feed(&dir);
    make_manifest(&dir, "m.json", &["--rollback"]).unwrap();
    let text = std::fs::read_to_string(dir.path("m.json")).unwrap();
    assert!(text.contains(r#""rollback":true"#));
}

#[test]
fn an_existing_key_file_is_never_overwritten() {
    let dir = Dir::new();
    std::fs::write(dir.path("k"), "precious").unwrap();
    let error = cmd(&["keygen", "--out", &dir.p("k")]).unwrap_err();
    assert!(error.to_string().contains("already exists"), "{error}");
    assert_eq!(std::fs::read_to_string(dir.path("k")).unwrap(), "precious");
}

#[test]
fn a_tampered_envelope_is_refused() {
    let dir = Dir::new();
    let (id, public) = signed(&dir);
    let text = std::fs::read_to_string(dir.path("envelope.json")).unwrap();
    let tampered = text.replace("1.2.0", "9.9.9");
    assert_ne!(text, tampered);
    std::fs::write(dir.path("tampered.json"), tampered).unwrap();
    let error = cmd(&[
        "verify",
        "--envelope",
        &dir.p("tampered.json"),
        "--keys",
        &format!("{id}:{public}"),
    ])
    .unwrap_err();
    assert!(matches!(
        error,
        ReleaseError::Verify(aedst_update::ManifestError::BadSignature)
    ));
    assert_eq!(error.exit_code(), 1);
}

#[test]
fn a_wrong_key_is_refused() {
    let dir = Dir::new();
    let (id, _) = signed(&dir);
    let other = cmd(&["keygen", "--out", &dir.p("other.key")]).unwrap();
    let error = cmd(&[
        "verify",
        "--envelope",
        &dir.p("envelope.json"),
        "--keys",
        &format!("{id}:{}", other.get("public-key").unwrap()),
    ])
    .unwrap_err();
    assert!(matches!(
        error,
        ReleaseError::Verify(aedst_update::ManifestError::BadSignature)
    ));
}

#[test]
fn a_manifest_the_app_would_refuse_is_not_signed() {
    let dir = Dir::new();
    cmd(&["keygen", "--out", &dir.p("release.key")]).unwrap();
    let bad = r#"{"version":"1.0.0","channel":"stable","releaseNotesUrl":"http://example.com/n","publishedAt":1000,"artifacts":[]}"#;
    std::fs::write(dir.path("bad.json"), bad).unwrap();
    let error = cmd(&[
        "sign",
        "--manifest",
        &dir.p("bad.json"),
        "--key",
        &dir.p("release.key"),
        "--key-id",
        "k1",
        "--out",
        &dir.p("env.json"),
    ])
    .unwrap_err();
    assert!(matches!(error, ReleaseError::Manifest(_)), "{error}");
    assert!(!Path::new(&dir.p("env.json")).exists());
}

#[test]
fn manifest_refuses_a_bad_feed_or_url() {
    let dir = Dir::new();
    write_feed(&dir);
    let error = make_manifest(&dir, "m.json", &["--platform", "Win!"]).unwrap_err();
    assert!(matches!(error, ReleaseError::Manifest(_)), "{error}");
    std::fs::write(dir.path("feed.json"), "abc 1.2.0.nupkg 12").unwrap();
    let error = make_manifest(&dir, "m2.json", &[]).unwrap_err();
    assert!(matches!(error, ReleaseError::Feed(_)), "{error}");
}

#[test]
fn a_key_file_that_is_not_a_key_is_refused_without_echoing_it() {
    let dir = Dir::new();
    write_feed(&dir);
    make_manifest(&dir, "manifest.json", &[]).unwrap();
    std::fs::write(dir.path("junk.key"), "hunter2-not-hex").unwrap();
    let error = cmd(&[
        "sign",
        "--manifest",
        &dir.p("manifest.json"),
        "--key",
        &dir.p("junk.key"),
        "--key-id",
        "k1",
        "--out",
        &dir.p("env.json"),
    ])
    .unwrap_err();
    assert!(matches!(error, ReleaseError::Key(_)));
    assert!(!error.to_string().contains("hunter2"));
}

#[test]
fn argument_errors_are_usage_errors() {
    let dir = Dir::new();
    for args in [
        vec![],
        vec!["bogus"],
        vec!["keygen"],
        vec!["keygen", "--out"],
        vec!["keygen", "--out", "a", "--out", "b"],
        vec!["keygen", "positional"],
        vec!["keygen", "--out", "a", "--nope", "x"],
        vec!["verify", "--envelope", "e"],
    ] {
        let error = cmd(&args).unwrap_err();
        assert!(matches!(error, ReleaseError::Usage(_)), "{args:?}: {error}");
        assert_eq!(error.exit_code(), 2);
    }
    write_feed(&dir);
    let error = make_manifest(&dir, "m.json", &["--expires-in-days", "0"]).unwrap_err();
    assert!(matches!(error, ReleaseError::Usage(_)));
}

#[test]
fn the_binary_exits_non_zero_and_prints_errors_to_stderr_only() {
    let exe = env!("CARGO_BIN_EXE_aedst-release");
    let dir = Dir::new();
    let bad = std::process::Command::new(exe)
        .arg("bogus")
        .output()
        .unwrap();
    assert_eq!(bad.status.code(), Some(2));
    assert!(bad.stdout.is_empty());
    assert!(String::from_utf8_lossy(&bad.stderr).contains("unknown command"));

    let ok = std::process::Command::new(exe)
        .args(["keygen", "--out", &dir.p("b.key")])
        .output()
        .unwrap();
    assert!(ok.status.success());
    let stdout = String::from_utf8_lossy(&ok.stdout);
    assert!(stdout.starts_with("key-id="));
    let key_text = std::fs::read_to_string(dir.path("b.key")).unwrap();
    assert!(!stdout.contains(key_text.trim()), "stdout leaked the key");
}
