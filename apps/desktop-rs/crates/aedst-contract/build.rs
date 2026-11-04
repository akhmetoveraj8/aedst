//! Generates message types and Connect clients from the server protos.
//!
//! `buf build` runs in `apps/server` so it uses the server's own `buf.yaml` and `buf.lock`
//! (one source of truth for the protovalidate pin) and produces a descriptor set that
//! `connectrpc-build` turns into Rust. Nothing generated is committed.

use std::{env, error::Error, path::Path, process::Command};

/// Proto files (as they appear in the buf module) the desktop app talks to.
const PROTOS: &[&str] = &[
    "aedst/admin/v1/admin.proto",
    "aedst/capabilities/v1/capabilities.proto",
    "aedst/media/v1/media.proto",
    "aedst/notifications/v1/notifications.proto",
    "aedst/search/v1/search.proto",
    "aedst/tasks/v1/tasks.proto",
];

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR")?;
    let server = Path::new(&manifest_dir)
        .join("../../../server")
        .canonicalize()?;
    let descriptor = Path::new(&env::var("OUT_DIR")?).join("aedst_descriptor_set.bin");

    for rel in ["api/proto", "buf.yaml", "buf.lock"] {
        println!("cargo:rerun-if-changed={}", server.join(rel).display());
    }
    println!("cargo:rerun-if-changed=build.rs");

    let status = Command::new("buf")
        .args(["build", "--as-file-descriptor-set", "-o"])
        .arg(&descriptor)
        .current_dir(&server)
        .status()
        .map_err(|e| format!("cannot run `buf` (install it; see mise.toml): {e}"))?;
    if !status.success() {
        return Err(format!("`buf build` failed in {} ({status})", server.display()).into());
    }

    connectrpc_build::Config::new()
        .descriptor_set(&descriptor)
        .files(PROTOS)
        .emit_rerun_directives(false)
        .include_file("_connectrpc.rs")
        .compile()?;

    Ok(())
}
