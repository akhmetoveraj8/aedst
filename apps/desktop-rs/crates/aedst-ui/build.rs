//! Compiles the design-system gallery so every component is type-checked by `cargo build`.
//! Debug builds carry element debug info, which the UI tests (`i-slint-backend-testing`) need.

fn main() -> Result<(), slint_build::CompileError> {
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-env-changed=PROFILE");
    let debug = std::env::var("PROFILE").is_ok_and(|profile| profile == "debug");
    let config = slint_build::CompilerConfiguration::new().with_debug_info(debug);
    slint_build::compile_with_config("ui/gallery.slint", config)
}
