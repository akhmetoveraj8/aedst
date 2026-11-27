//! Encryption at rest for values the app keeps in SQLite (queued writes, cached answers).
//!
//! AES-256-GCM with a fresh random 96-bit nonce per value. A sealed value is
//! `0x01 || nonce (12 bytes) || ciphertext with tag`. The key comes from the OS keychain (the shell
//! creates it once); it never touches the database or a file.
//!
//! Every value is bound to its place by the GCM associated data (`context`: the key-value key, or
//! the outbox item's id and kind), so a sealed value copied into another row does not open. There
//! is no plaintext fallback: a value that is not sealed is rejected like a tampered one, so nobody
//! with write access to the database file can plant a queued write that the app would deliver
//! under the user's token. (No build that wrote plaintext was ever released.)

use std::fmt;

use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, Nonce, Payload},
};
use zeroize::Zeroizing;

use crate::error::PersistenceError;

/// First byte of every sealed value.
const VERSION: u8 = 0x01;
/// AES-GCM nonce length in bytes (96 bits).
const NONCE_LEN: usize = 12;
/// Key length in bytes (AES-256).
pub const KEY_LEN: usize = 32;

/// A 256-bit data key. Wiped from memory on drop; `Debug` never prints it.
#[derive(Clone)]
pub struct DataKey(Zeroizing<[u8; KEY_LEN]>);

impl DataKey {
    /// Wraps raw key bytes (from the keychain).
    #[must_use]
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    /// A fresh random key from the operating system's CSPRNG (through `rand`'s thread RNG).
    #[must_use]
    pub fn generate() -> Self {
        Self::from_bytes(rand::random::<[u8; KEY_LEN]>())
    }

    /// The raw bytes, to store the key in the keychain.
    #[must_use]
    pub fn expose(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

impl fmt::Debug for DataKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DataKey(<redacted>)")
    }
}

/// Seals and opens values with one [`DataKey`]. Cheap to share behind an `Arc`.
///
/// Only the key bytes are kept (zeroized on drop); the cipher is built per call, so no expanded
/// key schedule stays in memory.
#[derive(Debug, Clone)]
pub struct Sealer {
    key: DataKey,
}

impl Sealer {
    /// A sealer over `key`.
    #[must_use]
    pub fn new(key: DataKey) -> Self {
        Self { key }
    }

    fn cipher(&self) -> Result<Aes256Gcm, PersistenceError> {
        Aes256Gcm::new_from_slice(&self.key.expose()[..]).map_err(|_| PersistenceError::Sealed)
    }

    /// Encrypts `plain` under a fresh random nonce, bound to `context` (where the value is kept).
    ///
    /// # Errors
    /// [`PersistenceError::Sealed`] if the cipher fails (it does not for valid input).
    pub fn seal(&self, context: &[u8], plain: &[u8]) -> Result<Vec<u8>, PersistenceError> {
        let nonce_bytes = rand::random::<[u8; NONCE_LEN]>();
        let nonce = Nonce::<Aes256Gcm>::from(nonce_bytes);
        let ciphertext = self
            .cipher()?
            .encrypt(
                &nonce,
                Payload {
                    msg: plain,
                    aad: context,
                },
            )
            .map_err(|_| PersistenceError::Sealed)?;
        let mut sealed = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
        sealed.push(VERSION);
        sealed.extend_from_slice(&nonce_bytes);
        sealed.extend_from_slice(&ciphertext);
        Ok(sealed)
    }

    /// Decrypts a value written by [`Self::seal`] with the same `context`.
    ///
    /// # Errors
    /// [`PersistenceError::Sealed`] when the value is not sealed, was changed or truncated, was
    /// sealed with another key, or belongs to another context.
    pub fn open(&self, context: &[u8], stored: &[u8]) -> Result<Vec<u8>, PersistenceError> {
        let Some((&VERSION, rest)) = stored.split_first() else {
            return Err(PersistenceError::Sealed);
        };
        if rest.len() < NONCE_LEN {
            return Err(PersistenceError::Sealed);
        }
        let (nonce_bytes, ciphertext) = rest.split_at(NONCE_LEN);
        let nonce_bytes: [u8; NONCE_LEN] =
            nonce_bytes.try_into().map_err(|_| PersistenceError::Sealed)?;
        let nonce = Nonce::<Aes256Gcm>::from(nonce_bytes);
        self.cipher()?
            .decrypt(
                &nonce,
                Payload {
                    msg: ciphertext,
                    aad: context,
                },
            )
            .map_err(|_| PersistenceError::Sealed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CTX: &[u8] = b"kv\0capabilities.v1";

    fn sealer() -> Sealer {
        Sealer::new(DataKey::generate())
    }

    #[test]
    fn a_sealed_value_round_trips_and_hides_the_plaintext() {
        let sealer = sealer();
        let sealed = sealer.seal(CTX, b"buy milk").unwrap();
        assert_eq!(sealed[0], VERSION);
        assert!(!sealed.windows(8).any(|w| w == b"buy milk"));
        assert_eq!(sealer.open(CTX, &sealed).unwrap(), b"buy milk");
    }

    #[test]
    fn every_seal_uses_a_new_nonce() {
        let sealer = sealer();
        assert_ne!(
            sealer.seal(CTX, b"x").unwrap(),
            sealer.seal(CTX, b"x").unwrap()
        );
    }

    #[test]
    fn a_changed_or_truncated_value_is_rejected() {
        let sealer = sealer();
        let sealed = sealer.seal(CTX, b"payload").unwrap();
        for index in 0..sealed.len() {
            let mut tampered = sealed.clone();
            tampered[index] ^= 0x01;
            assert!(matches!(
                sealer.open(CTX, &tampered),
                Err(PersistenceError::Sealed)
            ));
        }
        assert!(matches!(
            sealer.open(CTX, &sealed[..sealed.len() - 1]),
            Err(PersistenceError::Sealed)
        ));
        assert!(matches!(
            sealer.open(CTX, &sealed[..5]),
            Err(PersistenceError::Sealed)
        ));
    }

    #[test]
    fn another_key_cannot_open_the_value() {
        let sealed = sealer().seal(CTX, b"secret").unwrap();
        assert!(matches!(
            sealer().open(CTX, &sealed),
            Err(PersistenceError::Sealed)
        ));
    }

    #[test]
    fn a_plaintext_or_empty_value_is_rejected() {
        let sealer = sealer();
        let planted: [&[u8]; 3] = [b"{\"title\":\"a\"}", b"", b"\x01"];
        for planted in planted {
            assert!(matches!(
                sealer.open(CTX, planted),
                Err(PersistenceError::Sealed)
            ));
        }
    }

    #[test]
    fn a_value_moved_to_another_context_does_not_open() {
        let sealer = sealer();
        let sealed = sealer.seal(b"outbox\0a\0task.create", b"{}").unwrap();
        assert!(matches!(
            sealer.open(b"outbox\0b\0task.create", &sealed),
            Err(PersistenceError::Sealed)
        ));
    }

    #[test]
    fn debug_never_prints_the_key() {
        let key = DataKey::from_bytes([0xAB; KEY_LEN]);
        let text = format!("{key:?} {:?}", Sealer::new(key.clone()));
        assert!(!text.to_lowercase().contains("ab, "));
        assert!(!text.contains("171"));
        assert!(text.contains("redacted"));
    }
}
