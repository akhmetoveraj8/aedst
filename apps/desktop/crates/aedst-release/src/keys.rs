//! Key generation and loading. The seed exists as a `Zeroizing` buffer and in the key file, nowhere else.

use std::path::Path;

use ed25519_dalek::SigningKey;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::Output;
use crate::args::Flags;
use crate::error::ReleaseError;
use crate::fsio;
use crate::hex;

/// First 16 hex digits of the SHA-256 of the public key.
pub(crate) fn key_id_of(public: &[u8; 32]) -> String {
    hex::encode(&Sha256::digest(public)[..8])
}

/// Reads a key file: 64 hex digits (surrounding whitespace allowed). The content is never echoed in errors.
pub(crate) fn load_signing_key(path: &Path) -> Result<SigningKey, ReleaseError> {
    let text = Zeroizing::new(fsio::read_text(path, 1024)?);
    let seed = hex::decode_fixed::<32>(text.trim())
        .map(Zeroizing::new)
        .ok_or_else(|| {
            ReleaseError::Key(format!(
                "{} is not a private key file (expected 64 hex digits)",
                path.display()
            ))
        })?;
    Ok(SigningKey::from_bytes(&seed))
}

/// `keygen --out <file>`.
pub(crate) fn keygen(args: &[String]) -> Result<Output, ReleaseError> {
    let flags = Flags::parse(args, &["out"], &[])?;
    let out = Path::new(flags.required("out")?);
    // `rand::random` is the thread-local ChaCha CSPRNG, seeded from the operating system.
    let seed = Zeroizing::new(rand::random::<[u8; 32]>());
    let key = SigningKey::from_bytes(&seed);
    let public = key.verifying_key().to_bytes();
    let file_text = Zeroizing::new(format!("{}\n", hex::encode(&*seed)));
    fsio::create_new(out, file_text.as_bytes(), true)?;
    let mut output = Output::default();
    output.line(format!("key-id={}", key_id_of(&public)));
    output.line(format!("public-key={}", hex::encode(&public)));
    if cfg!(unix) {
        output.warn("private key file created with mode 0600");
    } else {
        output.warn(
            "warning: on Windows this tool cannot restrict the file mode; the key file has the permissions \
             of its directory. Keep it in a directory only the release runner can read (or restrict it with \
             icacls) and delete it after use",
        );
    }
    Ok(output)
}
