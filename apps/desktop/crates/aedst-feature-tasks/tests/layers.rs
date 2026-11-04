//! The layer rules of a feature, checked on the source (the Rust counterpart of
//! `check-feature-boundaries.sh`): `domain` is pure; `data` and `presentation` do not know each
//! other; a feature never depends on another feature.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{fs, path::PathBuf};

fn sources(dir: &str) -> Vec<(String, String)> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join(dir);
    let mut found = Vec::new();
    for entry in fs::read_dir(base).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            found.push((format!("{dir}/{name}"), fs::read_to_string(&path).unwrap()));
        }
    }
    found
}

fn assert_none(layer: &str, forbidden: &[&str]) {
    for (file, text) in sources(layer) {
        // Tests inside the file may use anything; look only at the code above them.
        let code = text.split("#[cfg(test)]").next().unwrap();
        for needle in forbidden {
            assert!(!code.contains(needle), "{file} must not mention `{needle}`");
        }
    }
}

#[test]
fn domain_is_pure() {
    assert_none(
        "domain",
        &[
            "crate::data",
            "crate::presentation",
            "crate::ui_glue",
            "slint",
            "aedst_contract",
            "aedst_api",
            "aedst_outbox",
            "connectrpc",
            "buffa",
            "serde_json",
            "tokio",
        ],
    );
}

#[test]
fn data_and_presentation_do_not_know_each_other() {
    assert_none("data", &["crate::presentation", "crate::ui_glue", "slint"]);
    assert_none(
        "presentation",
        &[
            "crate::data",
            "aedst_contract",
            "aedst_api",
            "connectrpc",
            "buffa",
            "slint",
        ],
    );
}

#[test]
fn a_feature_depends_on_core_crates_only() {
    let manifest =
        fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")).unwrap();
    for line in manifest
        .lines()
        .filter(|l| l.trim_start().starts_with("aedst-"))
    {
        assert!(
            !line.contains("aedst-feature-"),
            "a feature must not depend on another feature: {line}"
        );
    }
}
