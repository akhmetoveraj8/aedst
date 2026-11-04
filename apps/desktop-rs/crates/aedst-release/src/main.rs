//! `aedst-release` binary: see the library docs for the key-handling rules.

use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut stdout = std::io::stdout().lock();
    let mut stderr = std::io::stderr().lock();
    match aedst_release::run(&args) {
        Ok(output) => {
            for note in &output.notes {
                let _ = writeln!(stderr, "{note}");
            }
            for line in &output.lines {
                if writeln!(stdout, "{line}").is_err() {
                    return ExitCode::from(1);
                }
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            let _ = writeln!(stderr, "error: {error}");
            if matches!(error, aedst_release::ReleaseError::Usage(_)) {
                let _ = writeln!(stderr, "{}", aedst_release::USAGE);
            }
            ExitCode::from(error.exit_code())
        }
    }
}
