//! The five locale catalogs stay in parity with the strings of the screen (`@tr(...)` in the
//! `.slint` file): no missing, stale, empty or placeholder-changed entry. This is the Slint
//! counterpart of the Qt `check-i18n-extract` gate.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

const LOCALES: [&str; 5] = ["en", "ru", "tg", "uz", "ar"];

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Every `@tr("" => "text"` source string of the screen, as written in the catalogs.
fn source_strings() -> BTreeSet<String> {
    let source = std::fs::read_to_string(root().join("ui/search.slint")).unwrap();
    let marker = "@tr(\"\" => \"";
    let mut found = BTreeSet::new();
    let mut rest = source.as_str();
    while let Some(start) = rest.find(marker) {
        rest = &rest[start + marker.len()..];
        let mut end = 0;
        let bytes = rest.as_bytes();
        while end < bytes.len() && !(bytes[end] == b'"' && (end == 0 || bytes[end - 1] != b'\\')) {
            end += 1;
        }
        found.insert(rest[..end].to_owned());
        rest = &rest[end..];
    }
    found
}

/// Minimal `.po` reader for single-line `msgid` / `msgstr` pairs (what the extractor writes).
fn catalog(locale: &str) -> BTreeMap<String, String> {
    let path = root().join(format!("i18n/{locale}/LC_MESSAGES/aedst-feature-search.po"));
    let text = std::fs::read_to_string(path).unwrap();
    let mut entries = BTreeMap::new();
    let mut id: Option<String> = None;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("msgid \"") {
            id = Some(value.strip_suffix('"').unwrap().to_owned());
        } else if let Some(value) = line.strip_prefix("msgstr \"")
            && let Some(id) = id.take()
        {
            entries.insert(id, value.strip_suffix('"').unwrap().to_owned());
        }
    }
    entries.remove(""); // the header
    entries
}

#[test]
fn every_locale_has_exactly_the_strings_of_the_screen() {
    let source = source_strings();
    assert!(
        source.len() > 20,
        "the extractor found only {} strings",
        source.len()
    );
    for locale in LOCALES {
        let keys: BTreeSet<String> = catalog(locale).into_keys().collect();
        let missing: Vec<_> = source.difference(&keys).collect();
        let stale: Vec<_> = keys.difference(&source).collect();
        assert!(missing.is_empty(), "{locale}: missing {missing:?}");
        assert!(stale.is_empty(), "{locale}: stale {stale:?}");
    }
}

#[test]
fn no_translation_is_empty_and_placeholders_are_kept() {
    for locale in LOCALES {
        for (id, translated) in catalog(locale) {
            assert!(
                !translated.trim().is_empty(),
                "{locale}: empty translation of {id:?}"
            );
            assert_eq!(
                id.matches("{}").count(),
                translated.matches("{}").count(),
                "{locale}: placeholders changed in {id:?}"
            );
        }
    }
}

#[test]
fn english_is_the_source_text() {
    for (id, translated) in catalog("en") {
        assert_eq!(id, translated);
    }
}

#[test]
fn only_arabic_is_right_to_left() {
    assert!(aedst_feature_search::ui_glue::language_is_rtl("ar"));
    for locale in ["en", "ru", "tg", "uz"] {
        assert!(!aedst_feature_search::ui_glue::language_is_rtl(locale));
    }
}
