//! Compiles the Media screen against the `aedst-ui` library and bundles the five locale catalogs.

use std::{collections::HashMap, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Without `standalone` the shell compiles this view in its own Slint compilation (one compile, not two).
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_STANDALONE");
    if std::env::var_os("CARGO_FEATURE_STANDALONE").is_none() {
        return Ok(());
    }
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-changed=i18n");
    println!("cargo:rerun-if-changed=../aedst-ui/ui");

    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let library = manifest.join("../aedst-ui/ui/lib.slint");
    let config = slint_build::CompilerConfiguration::new()
        .with_library_paths(HashMap::from([("aedst-ui".to_owned(), library)]))
        .with_bundled_translations(manifest.join("i18n"));
    slint_build::compile_with_config("ui/media.slint", config)?;
    Ok(())
}
