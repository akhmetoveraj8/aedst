//! Compiles the Slint UI of the spike.

fn main() -> Result<(), slint_build::CompileError> {
    slint_build::compile("ui/spike.slint")
}
