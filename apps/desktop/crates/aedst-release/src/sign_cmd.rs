//! `sign` and `verify`.

use std::path::Path;

use chrono::DateTime;
use ed25519_dalek::Signer;

use crate::args::Flags;
use crate::error::ReleaseError;
use crate::{Output, check, envelope, fsio, keys};

const ENVELOPE_LIMIT: u64 = 1024 * 1024;

fn describe(
    envelope_bytes: &[u8],
    trusted: &aedst_update::TrustedKeys,
) -> Result<Output, ReleaseError> {
    let manifest = aedst_update::verify_manifest(envelope_bytes, trusted)?;
    let mut output = Output::default();
    output.line(format!("channel={}", manifest.channel));
    output.line(format!("version={}", manifest.version));
    output.line(format!("published-at={}", manifest.published_at));
    if let Some(time) = DateTime::from_timestamp(manifest.published_at, 0) {
        output.line(format!("published-at-rfc3339={}", time.to_rfc3339()));
    }
    if let Some(expires) = manifest.expires_at {
        output.line(format!("expires-at={expires}"));
    }
    output.line(format!("rollback={}", manifest.rollback));
    output.line(format!("artifacts={}", manifest.artifacts.len()));
    Ok(output)
}

/// `sign ...`.
pub(crate) fn sign(args: &[String]) -> Result<Output, ReleaseError> {
    let flags = Flags::parse(args, &["manifest", "key", "key-id", "out"], &[])?;
    let manifest_path = Path::new(flags.required("manifest")?);
    let key_id = flags.required("key-id")?;
    let out = Path::new(flags.required("out")?);
    // The exact text of the file is the payload; it is not parsed and re-serialised.
    let payload = fsio::read_text(manifest_path, ENVELOPE_LIMIT / 2)?;
    check::manifest_structure(&payload)?;
    let signing_key = keys::load_signing_key(Path::new(flags.required("key")?))?;
    let public = signing_key.verifying_key().to_bytes();
    let trusted = aedst_update::TrustedKeys::new(&[(key_id, public)])
        .map_err(|e| ReleaseError::Key(format!("--key-id: {e}")))?;
    let signature = signing_key.sign(&aedst_update::signing_input(&payload));
    let bytes = envelope::build(&payload, key_id, &signature);
    // Verified in memory BEFORE anything is written, then again from the written file.
    aedst_update::verify_manifest(&bytes, &trusted)?;
    fsio::create_new(out, &bytes, false)?;
    let written = fsio::read_text(out, ENVELOPE_LIMIT)?;
    let described = describe(written.as_bytes(), &trusted)?;
    let mut output = Output::default();
    output.line(format!("envelope={}", out.display()));
    output.line(format!("key-id={key_id}"));
    output.line("verified=true".to_owned());
    output.lines.extend(described.lines);
    Ok(output)
}

/// `verify ...`.
pub(crate) fn verify(args: &[String]) -> Result<Output, ReleaseError> {
    let flags = Flags::parse(args, &["envelope", "keys"], &[])?;
    let envelope = flags.required("envelope")?;
    let keys = flags.required("keys")?;
    let text = fsio::read_text(Path::new(envelope), ENVELOPE_LIMIT)?;
    let trusted = aedst_update::TrustedKeys::parse(keys)
        .map_err(|e| ReleaseError::Key(format!("--keys: {e}")))?;
    describe(text.as_bytes(), &trusted)
}
