//! The data key that encrypts local data at rest (queued writes, cached answers).
//!
//! A random 256-bit key is created once and kept in the OS keychain (Windows Credential Manager,
//! Linux Secret Service), built with the same explicit per-platform store as the sign-in session
//! (`aedst_oidc::store::platform_store`). It never touches the database or a file.
//!
//! Without a usable keychain (a headless Linux box with no Secret Service) the key is EPHEMERAL:
//! generated in memory for this run only. Local data is still never written in the clear, but
//! what was queued cannot be decrypted after a restart; the outbox parks such items as
//! `unreadable`. There is deliberately no file fallback (ADR-0001: secrets only in the keychain).
//!
//! Wiring (composition root, on the blocking start-up thread, since the keychain call blocks):
//!
//! ```ignore
//! let data_key = data_key::load_or_create_data_key(data_key::KEYCHAIN_SERVICE);
//! if !data_key.persistent {
//!     tracing::warn!("no keychain: local data uses a key for this run only");
//! }
//! let sealer = Arc::new(aedst_persistence::Sealer::new(data_key.key));
//! let outbox_queue = SqliteOutbox::sealed(db.clone(), Arc::clone(&sealer));
//! let cache = aedst_persistence::KvStore::sealed(db.clone(), Arc::clone(&sealer));
//! ```

use std::sync::Arc;

use aedst_persistence::{DataKey, KEY_LEN};
use keyring_core::{CredentialStore, Entry};
use zeroize::Zeroizing;

/// Keychain service of the data key (the sign-in session uses its own service).
pub const KEYCHAIN_SERVICE: &str = "aedst-desktop-data";
/// Keychain account name of the data key.
const ACCOUNT: &str = "data-key";

/// The key to seal local data with, and whether it survives a restart.
#[derive(Debug)]
pub struct DataKeyOutcome {
    /// The key (redacted in `Debug`, wiped on drop).
    pub key: DataKey,
    /// `true` when the key is stored in the OS keychain; `false` for a key of this run only.
    pub persistent: bool,
}

/// Loads the data key from the OS keychain, creating and storing it on first use. Blocking: call
/// it from `spawn_blocking` or the start-up thread, never on the UI thread or a runtime worker.
///
/// Never fails: without a usable keychain it returns an ephemeral key (`persistent: false`).
#[must_use]
pub fn load_or_create_data_key(service: &str) -> DataKeyOutcome {
    let store = aedst_oidc::store::platform_store().map_err(|e| e.to_string());
    load_or_create_in(store, service)
}

fn ephemeral(reason: &str) -> DataKeyOutcome {
    tracing::warn!(
        reason,
        "the keychain is unavailable: local data is sealed with a key for this run only"
    );
    DataKeyOutcome {
        key: DataKey::generate(),
        persistent: false,
    }
}

/// [`load_or_create_data_key`] against an explicit store (a mock store in tests).
fn load_or_create_in(
    store: Result<Arc<CredentialStore>, String>,
    service: &str,
) -> DataKeyOutcome {
    let built = store.and_then(|s| s.build(service, ACCOUNT, None).map_err(|e| e.to_string()));
    let entry = match built {
        Ok(entry) => entry,
        Err(reason) => return ephemeral(&reason),
    };
    match entry.get_password().map(Zeroizing::new) {
        Ok(stored) => match decode_hex(&stored) {
            Some(bytes) => DataKeyOutcome {
                key: DataKey::from_bytes(*bytes),
                persistent: true,
            },
            None => {
                // Unusable either way; data sealed with it cannot be read, so a new key is stored.
                tracing::warn!("the stored data key is malformed: replacing it");
                create(&entry)
            }
        },
        Err(keyring_core::Error::NoEntry) => create(&entry),
        Err(error) => ephemeral(&error.to_string()),
    }
}

/// Generates a key and stores it; a failed write leaves an ephemeral key.
fn create(entry: &Entry) -> DataKeyOutcome {
    let key = DataKey::generate();
    let encoded = encode_hex(key.expose());
    match entry.set_password(&encoded) {
        Ok(()) => DataKeyOutcome {
            key,
            persistent: true,
        },
        Err(error) => {
            tracing::warn!(%error, "could not store the data key");
            DataKeyOutcome {
                key,
                persistent: false,
            }
        }
    }
}

const HEX: &[u8; 16] = b"0123456789abcdef";

fn encode_hex(bytes: &[u8]) -> Zeroizing<String> {
    let mut out = Zeroizing::new(String::with_capacity(bytes.len() * 2));
    for byte in bytes {
        out.push(char::from(HEX[usize::from(byte >> 4)]));
        out.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    out
}

fn decode_hex(text: &str) -> Option<Zeroizing<[u8; KEY_LEN]>> {
    fn nibble(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    }
    let digits = text.trim().as_bytes();
    if digits.len() != KEY_LEN * 2 {
        return None;
    }
    let mut out = Zeroizing::new([0_u8; KEY_LEN]);
    for (slot, pair) in out.iter_mut().zip(digits.chunks_exact(2)) {
        *slot = (nibble(pair[0])? << 4) | nibble(pair[1])?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

    use super::*;

    fn mock() -> Arc<CredentialStore> {
        keyring_core::mock::Store::new().unwrap()
    }

    #[test]
    fn the_key_is_created_once_and_then_read_back() {
        let store = mock();
        let first = load_or_create_in(Ok(Arc::clone(&store)), "svc");
        assert!(first.persistent);
        let again = load_or_create_in(Ok(store), "svc");
        assert!(again.persistent);
        assert_eq!(first.key.expose(), again.key.expose());
    }

    #[test]
    fn no_keychain_gives_an_ephemeral_key() {
        let outcome = load_or_create_in(Err("no secret service".into()), "svc");
        assert!(!outcome.persistent);
        let other = load_or_create_in(Err("no secret service".into()), "svc");
        assert_ne!(outcome.key.expose(), other.key.expose());
    }

    #[test]
    fn a_locked_keychain_gives_an_ephemeral_key() {
        let store = mock();
        let entry = store.build("svc", ACCOUNT, None).unwrap();
        entry
            .as_any()
            .downcast_ref::<keyring_core::mock::Cred>()
            .unwrap()
            .set_error(keyring_core::Error::NoStorageAccess("locked".into()));
        assert!(!load_or_create_in(Ok(store), "svc").persistent);
    }

    #[test]
    fn a_malformed_stored_key_is_replaced() {
        let store = mock();
        store
            .build("svc", ACCOUNT, None)
            .unwrap()
            .set_password("not hex")
            .unwrap();
        let outcome = load_or_create_in(Ok(Arc::clone(&store)), "svc");
        assert!(outcome.persistent);
        assert_eq!(
            load_or_create_in(Ok(store), "svc").key.expose(),
            outcome.key.expose()
        );
    }

    #[test]
    fn hex_round_trips_and_rejects_bad_input() {
        let bytes = [0x00, 0x7f, 0x80, 0xff].repeat(8);
        let encoded = encode_hex(&bytes);
        assert_eq!(&encoded[..8], "007f80ff");
        assert_eq!(decode_hex(&encoded).unwrap().to_vec(), bytes);
        assert!(decode_hex("abc").is_none());
        assert!(decode_hex(&"zz".repeat(KEY_LEN)).is_none());
    }
}
