//! Structural check of a manifest with the app's own parser, without any real key.
//!
//! `aedst_update` exposes the parser only through `verify_manifest`, so the document is signed with a throw-away
//! key and verified against it: the result is exactly what the app would decide about the structure.

use ed25519_dalek::{Signer, SigningKey};

use crate::envelope;
use crate::error::ReleaseError;

/// Refuses a payload the app's manifest parser refuses.
pub(crate) fn manifest_structure(payload: &str) -> Result<(), ReleaseError> {
    let throwaway = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
    let public = throwaway.verifying_key().to_bytes();
    let keys = aedst_update::TrustedKeys::new(&[("check", public)])
        .map_err(|e| ReleaseError::Key(e.to_string()))?;
    let signature = throwaway.sign(&aedst_update::signing_input(payload));
    let bytes = envelope::build(payload, "check", &signature);
    match aedst_update::verify_manifest(&bytes, &keys) {
        Ok(_) => Ok(()),
        Err(aedst_update::ManifestError::InvalidManifest(why)) => Err(ReleaseError::Manifest(
            format!("the app would refuse it: {why}"),
        )),
        Err(other) => Err(ReleaseError::Verify(other)),
    }
}
