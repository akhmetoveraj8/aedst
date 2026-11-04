//! Signed manifest envelopes and the trusted key set.
//!
//! Envelope (JSON, at most 1 MiB):
//!
//! ```json
//! { "payload": "<the manifest JSON, as a string>",
//!   "signatures": [ { "keyId": "k1", "signature": "<128 hex digits>" } ] }
//! ```
//!
//! **Canonicalisation.** Nothing is re-serialised. The signed message is [`SIGNING_PREFIX`] followed by the exact
//! UTF-8 bytes of the `payload` string (after JSON string unescaping), so signer and verifier cannot disagree about
//! key order or whitespace. The prefix is domain separation: a signature made for another purpose with the same
//! key never verifies as a manifest. (The Qt app signed the bare payload and carried it base64-encoded; this
//! format differs in both, so the release signing tool must be written for it.)
//!
//! The envelope is accepted when at least one signature verifies under the trusted key with the same `keyId`;
//! signatures by unknown keys are ignored, which is what makes rotation possible: ship a build that trusts old and
//! new, sign with the new one, drop the old one later. Verification uses `verify_strict`.

use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;

use crate::hex;
use crate::manifest::{Manifest, parse_manifest};

/// Domain-separation prefix of the signed message.
pub const SIGNING_PREFIX: &[u8] = b"aedst-update-manifest-v1\n";
/// Largest accepted envelope.
pub const MAX_ENVELOPE_BYTES: usize = 1024 * 1024;
const MAX_SIGNATURES: usize = 8;
const MAX_KEY_ID: usize = 32;

/// Why a manifest envelope was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ManifestError {
    /// The build trusts no key, so nothing can be verified (fails closed).
    #[error("no trusted update signing keys are configured")]
    NoTrustedKeys,
    /// Empty or over [`MAX_ENVELOPE_BYTES`].
    #[error("the manifest envelope has an invalid size")]
    BadSize,
    /// Not the envelope JSON.
    #[error("the manifest envelope is malformed: {0}")]
    Malformed(String),
    /// The envelope carries no signature at all.
    #[error("the manifest is unsigned")]
    Unsigned,
    /// Signatures are present but none verifies under a trusted key.
    #[error("no signature of the manifest verifies under a trusted key")]
    BadSignature,
    /// Correctly signed, but the manifest breaks a rule.
    #[error("the signed manifest is invalid: {0}")]
    InvalidManifest(String),
}

/// A configured key is unusable.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum KeyError {
    /// `keyId:hex` expected.
    #[error("trusted keys must be written keyId:<64 hex digits>")]
    Syntax,
    /// 1..=32 characters of `[A-Za-z0-9._-]`.
    #[error("invalid key id")]
    KeyId,
    /// Not a valid Ed25519 point.
    #[error("not a valid Ed25519 public key")]
    PublicKey,
    /// The same id twice.
    #[error("duplicate key id")]
    Duplicate,
}

/// The release-signing keys this build trusts.
#[derive(Debug, Clone, Default)]
pub struct TrustedKeys {
    keys: Vec<(String, VerifyingKey)>,
}

impl TrustedKeys {
    /// A key set from `(key id, 32-byte public key)` pairs.
    ///
    /// # Errors
    /// [`KeyError`] for a bad id, an invalid point or a duplicate id.
    pub fn new(keys: &[(&str, [u8; 32])]) -> Result<Self, KeyError> {
        let mut out: Vec<(String, VerifyingKey)> = Vec::with_capacity(keys.len());
        for (id, bytes) in keys {
            let valid_id = !id.is_empty()
                && id.len() <= MAX_KEY_ID
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
            if !valid_id {
                return Err(KeyError::KeyId);
            }
            if out.iter().any(|(existing, _)| existing == id) {
                return Err(KeyError::Duplicate);
            }
            let key = VerifyingKey::from_bytes(bytes).map_err(|_| KeyError::PublicKey)?;
            out.push(((*id).to_owned(), key));
        }
        Ok(Self { keys: out })
    }

    /// Parses `keyId:<64 hex>,keyId2:<64 hex>` (the compile-time configuration format). Empty = no keys.
    ///
    /// # Errors
    /// [`KeyError`] for the first unusable entry.
    pub fn parse(spec: &str) -> Result<Self, KeyError> {
        let mut pairs: Vec<(String, [u8; 32])> = Vec::new();
        if !spec.is_empty() {
            for entry in spec.split(',') {
                let (id, key_hex) = entry.split_once(':').ok_or(KeyError::Syntax)?;
                let bytes = hex::decode_fixed::<32>(key_hex).ok_or(KeyError::Syntax)?;
                pairs.push((id.to_owned(), bytes));
            }
        }
        let borrowed: Vec<(&str, [u8; 32])> =
            pairs.iter().map(|(id, key)| (id.as_str(), *key)).collect();
        Self::new(&borrowed)
    }

    /// True when no key is trusted (the updater is then disabled).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }
}

#[derive(Deserialize)]
struct Envelope {
    payload: String,
    signatures: Vec<SignatureEntry>,
}

#[derive(Deserialize)]
struct SignatureEntry {
    #[serde(rename = "keyId")]
    key_id: String,
    signature: String,
}

/// The exact bytes a signature must cover for `payload`.
#[must_use]
pub fn signing_input(payload: &str) -> Vec<u8> {
    let mut message = Vec::with_capacity(SIGNING_PREFIX.len() + payload.len());
    message.extend_from_slice(SIGNING_PREFIX);
    message.extend_from_slice(payload.as_bytes());
    message
}

/// Verifies a manifest envelope against the trusted keys and parses the manifest.
///
/// This checks authenticity and syntax only. Channel, freshness, expiry and rollback rules are
/// [`crate::policy::evaluate`].
///
/// # Errors
/// [`ManifestError`], one variant per kind of refusal.
pub fn verify_manifest(envelope: &[u8], keys: &TrustedKeys) -> Result<Manifest, ManifestError> {
    if keys.is_empty() {
        return Err(ManifestError::NoTrustedKeys);
    }
    if envelope.is_empty() || envelope.len() > MAX_ENVELOPE_BYTES {
        return Err(ManifestError::BadSize);
    }
    let parsed: Envelope =
        serde_json::from_slice(envelope).map_err(|e| ManifestError::Malformed(e.to_string()))?;
    if parsed.signatures.is_empty() {
        return Err(ManifestError::Unsigned);
    }
    if parsed.signatures.len() > MAX_SIGNATURES {
        return Err(ManifestError::Malformed("too many signatures".to_owned()));
    }
    let message = signing_input(&parsed.payload);
    let verified = parsed.signatures.iter().any(|entry| {
        let Some(bytes) = hex::decode_fixed::<64>(&entry.signature) else {
            return false;
        };
        let signature = Signature::from_bytes(&bytes);
        keys.keys
            .iter()
            .filter(|(id, _)| *id == entry.key_id)
            .any(|(_, key)| key.verify_strict(&message, &signature).is_ok())
    });
    if !verified {
        return Err(ManifestError::BadSignature);
    }
    parse_manifest(parsed.payload.as_bytes()).map_err(ManifestError::InvalidManifest)
}
