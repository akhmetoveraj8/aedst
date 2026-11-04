//! Release tool for the AEDST desktop updater: `keygen`, `manifest`, `sign`, `verify`.
//!
//! It produces and checks exactly the envelope the app's `aedst_update::verify_manifest` accepts
//! (`{payload, signatures:[{keyId, signature}]}`, signed bytes `aedst-update-manifest-v1\n` + the payload text) and
//! uses that verifier itself, so the tool and the app cannot drift apart.
//!
//! # Private key handling (rules)
//!
//! - The key file (64 hex digits, the Ed25519 seed) lives ONLY on the release runner. In CI it is a secret that
//!   is written to a temp file in a directory only the runner user can read, used by one `sign` run, and then
//!   shredded (overwritten and removed, e.g. `shred -u`). It is never committed, never uploaded as a build
//!   artifact, never passed on a command line, never printed, never logged.
//! - `keygen` is the only place a private key is written, and only to its `--out` file. It refuses to overwrite.
//!   On Unix the file is created with mode 0600. On Windows this tool cannot restrict the mode: the file gets the
//!   permissions of its directory, so choose a directory that only the runner can read (or use `icacls`).
//! - Keep the key id and the PUBLIC key (`keygen` prints both) for the app's compile-time trusted key list; for a
//!   rotation ship a build that trusts old and new keys before signing with the new one.
//! - Error messages never contain key material; secrets in memory are zeroized on drop, but the OS may still
//!   have copied them (swap, page cache), which this tool cannot prevent.
//! - No command overwrites an existing file; a rerun needs the old output removed first.

mod args;
mod check;
mod envelope;
mod error;
mod feed;
mod fsio;
mod hex;
mod keys;
mod manifest_cmd;
mod sign_cmd;

pub use error::ReleaseError;

/// What a command printed: machine-readable `key=value` lines for stdout, notes for stderr.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Output {
    /// stdout lines.
    pub lines: Vec<String>,
    /// stderr lines (warnings; not errors).
    pub notes: Vec<String>,
}

impl Output {
    pub(crate) fn line(&mut self, text: String) {
        self.lines.push(text);
    }

    pub(crate) fn warn(&mut self, text: &str) {
        self.notes.push(text.to_owned());
    }

    /// The value of the first `name=value` line.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&str> {
        self.lines
            .iter()
            .find_map(|l| l.strip_prefix(name).and_then(|r| r.strip_prefix('=')))
    }
}

/// Usage text, printed on a usage error.
pub const USAGE: &str = "usage:
  aedst-release keygen --out <private-key-file>
  aedst-release manifest --version <semver> --channel stable|beta --feed-entry <file>
      --published-at <RFC3339|now> --base-url <https url of the package directory>
      --notes-url <https url> --out <file>
      [--expires-in-days N] [--rollback] [--platform windows] [--arch x86_64] [--min-supported <semver>]
  aedst-release sign --manifest <file> --key <private-key-file> --key-id <id> --out <envelope.json>
  aedst-release verify --envelope <file> --keys \"<id>:<hex>[,<id>:<hex>]\"";

/// Runs one command line (without the program name).
///
/// # Errors
/// [`ReleaseError`]; `Usage` for a bad command line.
pub fn run(args: &[String]) -> Result<Output, ReleaseError> {
    let Some((command, rest)) = args.split_first() else {
        return Err(ReleaseError::Usage("no command given".to_owned()));
    };
    match command.as_str() {
        "keygen" => keys::keygen(rest),
        "manifest" => manifest_cmd::run(rest),
        "sign" => sign_cmd::sign(rest),
        "verify" => sign_cmd::verify(rest),
        other => Err(ReleaseError::Usage(format!("unknown command `{other}`"))),
    }
}
