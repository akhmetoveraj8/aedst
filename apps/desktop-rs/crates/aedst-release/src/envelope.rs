//! Building the envelope JSON.

use ed25519_dalek::Signature;

use crate::hex;

/// `{payload, signatures:[{keyId, signature}]}` with the payload text exactly as given.
pub(crate) fn build(payload: &str, key_id: &str, signature: &Signature) -> Vec<u8> {
    serde_json::json!({
        "payload": payload,
        "signatures": [{ "keyId": key_id, "signature": hex::encode(&signature.to_bytes()) }],
    })
    .to_string()
    .into_bytes()
}
