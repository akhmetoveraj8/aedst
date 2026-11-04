//! Compiles the shell window together with the five feature views, in ONE Slint compilation.
//!
//! Two things have to happen here because each feature crate compiles its own `.slint` file:
//!
//! 1. **Catalogs.** Slint bundles translations per compilation, so the strings of every feature view
//!    must be in one catalog per language. This script merges the five feature catalogs under the
//!    shell's own (`i18n/`) into `OUT_DIR/i18n/<lang>/LC_MESSAGES/aedst-desktop.po`. Where two
//!    features translate the same English text differently, the first one wins (order: shell, tasks,
//!    search, notifications, media, admin); a shared-strings catalog is a follow-up.
//! 2. **Glue.** The binding code of a feature (`src/ui_glue.rs`) names the types generated from ITS
//!    `.slint` file. In the shell those types are generated again, in this crate, so the same source
//!    is compiled here with its `mod generated` block replaced by `use crate::generated::*;`. No
//!    glue is copied into the repository.

use std::{
    collections::HashMap,
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
};

const FEATURES: [&str; 5] = ["tasks", "search", "notifications", "media", "admin"];
const LANGUAGES: [&str; 5] = ["en", "ru", "tg", "uz", "ar"];

type Catalog = Vec<(String, String)>;

/// Reads the single-line `msgid`/`msgstr` pairs the catalogs use (header entry excluded).
fn read_catalog(path: &Path) -> Result<Catalog, Box<dyn Error>> {
    let text = fs::read_to_string(path)?;
    let (mut entries, mut id) = (Vec::new(), None::<String>);
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("msgid \"") {
            id = Some(value.strip_suffix('"').unwrap_or(value).to_owned());
        } else if let Some(value) = line.strip_prefix("msgstr \"")
            && let Some(id) = id.take()
            && !id.is_empty()
        {
            entries.push((id, value.strip_suffix('"').unwrap_or(value).to_owned()));
        }
    }
    Ok(entries)
}

fn merge_catalogs(manifest: &Path, out: &Path) -> Result<(), Box<dyn Error>> {
    for language in LANGUAGES {
        let shell = manifest.join(format!("i18n/{language}/LC_MESSAGES/aedst-desktop.po"));
        let header = fs::read_to_string(&shell)?
            .split("\n\n")
            .next()
            .unwrap_or_default()
            .to_owned();
        let mut sources = vec![shell];
        for feature in FEATURES {
            sources.push(manifest.join(format!(
                "../aedst-feature-{feature}/i18n/{language}/LC_MESSAGES/aedst-feature-{feature}.po"
            )));
        }
        let (mut seen, mut merged) = (HashMap::<String, ()>::new(), String::new());
        merged.push_str(&header);
        merged.push_str("\n\n");
        for source in &sources {
            println!("cargo:rerun-if-changed={}", source.display());
            for (id, text) in read_catalog(source)? {
                if seen.insert(id.clone(), ()).is_none() {
                    merged.push_str(&format!("msgid \"{id}\"\nmsgstr \"{text}\"\n\n"));
                }
            }
        }
        let folder = out.join(format!("i18n/{language}/LC_MESSAGES"));
        fs::create_dir_all(&folder)?;
        fs::write(folder.join("aedst-desktop.po"), merged)?;
    }
    Ok(())
}

/// Turns a feature's `ui_glue.rs` into a module body for the shell: its own `crate::` paths point at
/// the feature crate, the `mod generated` block and the `pub use generated::..;` line become a glob
/// import of the shell's generated module, and inner doc comments (not allowed inside `include!`)
/// become plain comments.
fn shell_glue(feature: &str, source: &str) -> Option<String> {
    let start = source.find("/// Slint-generated code.")?;
    let use_at = source.find("pub use generated::")?;
    let end = use_at + source[use_at..].find(';')? + 1;
    let own = format!("aedst_feature_{feature}::");
    let rewrite = |part: &str| {
        part.replace("crate::", &own)
            .lines()
            .map(|l| {
                l.strip_prefix("//!")
                    .map_or_else(|| l.to_owned(), |rest| format!("//{rest}"))
            })
            .collect::<Vec<_>>()
            .join(
                "
",
            )
    };
    Some(format!(
        "{}
// Generated for the shell by build.rs from the feature's own glue.
#[allow(unused_imports)]
use crate::generated::*;
{}",
        rewrite(&source[..start]),
        rewrite(&source[end..])
    ))
}

fn write_glue(manifest: &Path, out: &Path) -> Result<(), Box<dyn Error>> {
    for feature in FEATURES {
        let path = manifest.join(format!("../aedst-feature-{feature}/src/ui_glue.rs"));
        println!("cargo:rerun-if-changed={}", path.display());
        let source = fs::read_to_string(&path)?;
        let glue = shell_glue(feature, &source).ok_or_else(|| {
            format!("{feature}: ui_glue.rs no longer has the expected generated block")
        })?;
        fs::write(out.join(format!("glue_{feature}.rs")), glue)?;
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let out = PathBuf::from(env::var("OUT_DIR")?);
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-changed=i18n");
    println!("cargo:rerun-if-changed=../aedst-ui/ui");
    for feature in FEATURES {
        println!("cargo:rerun-if-changed=../aedst-feature-{feature}/ui");
    }

    merge_catalogs(&manifest, &out)?;
    write_glue(&manifest, &out)?;

    let config = slint_build::CompilerConfiguration::new()
        .with_library_paths(HashMap::from([(
            "aedst-ui".to_owned(),
            manifest.join("../aedst-ui/ui/lib.slint"),
        )]))
        .with_bundled_translations(out.join("i18n"))
        // Element debug info is what the UI tests need; release builds go without it.
        .with_debug_info(std::env::var("PROFILE").is_ok_and(|profile| profile == "debug"));
    slint_build::compile_with_config("ui/shell.slint", config)?;
    Ok(())
}
