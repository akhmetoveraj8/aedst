//! Where the refresh token lives: the OS keychain only. There is no file fallback; if the
//! keychain is unavailable, sign-in fails with an explicit error and the fresh token is revoked.

use std::{
    fmt,
    sync::{Arc, Mutex},
};

use keyring_core::CredentialStore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{config::KEYCHAIN_SERVICE, error::OidcError};

/// The persisted part of a session: the refresh token and the subject. Access and ID tokens
/// are never stored.
#[derive(Clone, PartialEq, Eq)]
pub struct StoredSession {
    /// Refresh token (wiped on drop, redacted in `Debug`).
    pub refresh_token: Zeroizing<String>,
    /// The `sub` claim of the signed-in user.
    pub subject: String,
}

impl fmt::Debug for StoredSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StoredSession")
            .field("subject", &self.subject)
            .field("refresh_token", &"<redacted>")
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
struct Wire {
    refresh_token: String,
    subject: String,
}

/// Blocking storage; the session calls it from `spawn_blocking`.
pub trait RefreshTokenStore: Send + Sync + 'static {
    /// Reads the stored session, `None` when nothing is stored.
    ///
    /// # Errors
    /// [`OidcError::Keychain`] when the store cannot be read.
    fn load(&self) -> Result<Option<StoredSession>, OidcError>;
    /// Replaces the stored session.
    ///
    /// # Errors
    /// [`OidcError::Keychain`] when the store cannot be written.
    fn save(&self, session: &StoredSession) -> Result<(), OidcError>;
    /// Removes the stored session (no error when nothing is stored).
    ///
    /// # Errors
    /// [`OidcError::Keychain`] when the store cannot be written.
    fn clear(&self) -> Result<(), OidcError>;
}

/// The OS credential store (Windows Credential Manager, Linux Secret Service) through
/// `keyring-core` and one explicitly chosen store crate per platform. No process-wide default store
/// is installed: the entry is built by the store this value owns, so a test can pass a mock store.
pub struct KeychainStore {
    key: String,
    store: Result<Arc<CredentialStore>, String>,
}

impl fmt::Debug for KeychainStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeychainStore")
            .field("key", &self.key)
            .field("store_ready", &self.store.is_ok())
            .finish()
    }
}

/// The platform's credential store: Windows Credential Manager or the Linux Secret Service.
///
/// # Errors
/// [`OidcError::Keychain`] when the store cannot be created or the platform has none.
pub fn platform_store() -> Result<Arc<CredentialStore>, OidcError> {
    #[cfg(windows)]
    {
        let store = windows_native_keyring_store::Store::new().map_err(keychain_error)?;
        Ok(store)
    }
    #[cfg(all(
        unix,
        not(any(target_os = "macos", target_os = "ios", target_os = "android"))
    ))]
    {
        let store = zbus_secret_service_keyring_store::Store::new().map_err(keychain_error)?;
        Ok(store)
    }
    #[cfg(not(any(
        windows,
        all(
            unix,
            not(any(target_os = "macos", target_os = "ios", target_os = "android"))
        )
    )))]
    {
        Err(OidcError::Keychain(
            "no credential store on this platform".into(),
        ))
    }
}

impl KeychainStore {
    /// Uses the platform store. `key` is [`crate::OidcConfig::store_key`]. When the platform store
    /// cannot be created, every operation fails with [`OidcError::Keychain`] (sign-in then says so).
    #[must_use]
    pub fn new(key: String) -> Self {
        let store = platform_store().map_err(|e| e.to_string());
        Self { key, store }
    }

    /// Uses `store` (a mock store in tests).
    #[must_use]
    pub fn with_store(store: Arc<CredentialStore>, key: String) -> Self {
        Self {
            key,
            store: Ok(store),
        }
    }

    fn entry(&self) -> Result<keyring_core::Entry, OidcError> {
        let store = self
            .store
            .as_ref()
            .map_err(|message| OidcError::Keychain(message.clone()))?;
        store
            .build(KEYCHAIN_SERVICE, &self.key, None)
            .map_err(keychain_error)
    }
}

fn keychain_error(error: keyring_core::Error) -> OidcError {
    OidcError::Keychain(error.to_string())
}

impl RefreshTokenStore for KeychainStore {
    fn load(&self) -> Result<Option<StoredSession>, OidcError> {
        let raw = match self.entry()?.get_password() {
            Ok(raw) => Zeroizing::new(raw),
            Err(keyring_core::Error::NoEntry) => return Ok(None),
            Err(e) => return Err(keychain_error(e)),
        };
        let wire: Wire = serde_json::from_str(&raw)
            .map_err(|_| OidcError::Keychain("stored entry is corrupt".into()))?;
        Ok(Some(StoredSession {
            refresh_token: Zeroizing::new(wire.refresh_token),
            subject: wire.subject,
        }))
    }

    fn save(&self, session: &StoredSession) -> Result<(), OidcError> {
        let wire = Wire {
            refresh_token: session.refresh_token.to_string(),
            subject: session.subject.clone(),
        };
        let raw = Zeroizing::new(
            serde_json::to_string(&wire).map_err(|e| OidcError::Keychain(e.to_string()))?,
        );
        self.entry()?.set_password(&raw).map_err(keychain_error)
    }

    fn clear(&self) -> Result<(), OidcError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error(e)),
        }
    }
}

/// In-memory store for tests and for hosts that deliberately keep no session across runs.
#[derive(Debug, Default)]
pub struct MemoryStore {
    slot: Mutex<Option<StoredSession>>,
    fail: bool,
}

impl MemoryStore {
    /// A store whose every operation fails, like a headless Linux box without a Secret Service.
    #[must_use]
    pub fn unavailable() -> Self {
        Self {
            slot: Mutex::new(None),
            fail: true,
        }
    }

    fn check(&self) -> Result<(), OidcError> {
        if self.fail {
            Err(OidcError::Keychain("no secret service".into()))
        } else {
            Ok(())
        }
    }
}

impl RefreshTokenStore for MemoryStore {
    fn load(&self) -> Result<Option<StoredSession>, OidcError> {
        self.check()?;
        Ok(self
            .slot
            .lock()
            .map_err(|_| OidcError::Keychain("poisoned".into()))?
            .clone())
    }

    fn save(&self, session: &StoredSession) -> Result<(), OidcError> {
        self.check()?;
        *self
            .slot
            .lock()
            .map_err(|_| OidcError::Keychain("poisoned".into()))? = Some(session.clone());
        Ok(())
    }

    fn clear(&self) -> Result<(), OidcError> {
        self.check()?;
        *self
            .slot
            .lock()
            .map_err(|_| OidcError::Keychain("poisoned".into()))? = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> StoredSession {
        StoredSession {
            refresh_token: Zeroizing::new("r-token".into()),
            subject: "u1".into(),
        }
    }

    #[test]
    fn debug_never_prints_the_token() {
        assert!(!format!("{:?}", session()).contains("r-token"));
    }

    #[test]
    fn memory_store_round_trips_and_clears() {
        let store = MemoryStore::default();
        assert_eq!(store.load().unwrap(), None);
        store.save(&session()).unwrap();
        assert_eq!(store.load().unwrap(), Some(session()));
        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }

    #[test]
    fn unavailable_store_reports_a_keychain_error() {
        assert!(matches!(
            MemoryStore::unavailable().save(&session()),
            Err(OidcError::Keychain(_))
        ));
    }

    fn mock_store() -> KeychainStore {
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new().unwrap();
        KeychainStore::with_store(store, "oidc-test".into())
    }

    #[test]
    fn keychain_store_round_trips_on_a_mock_store() {
        let store = mock_store();
        assert_eq!(store.load().unwrap(), None);
        store.save(&session()).unwrap();
        assert_eq!(store.load().unwrap(), Some(session()));
        store
            .save(&StoredSession {
                refresh_token: Zeroizing::new("rotated".into()),
                subject: "u1".into(),
            })
            .unwrap();
        assert_eq!(
            store.load().unwrap().map(|s| s.refresh_token.to_string()),
            Some("rotated".to_owned())
        );
        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
        store.clear().unwrap();
    }

    #[test]
    fn a_corrupt_entry_is_a_keychain_error_not_a_session() {
        let store = mock_store();
        store.entry().unwrap().set_password("not json").unwrap();
        assert!(matches!(store.load(), Err(OidcError::Keychain(_))));
    }

    #[test]
    fn a_failing_store_reports_a_keychain_error_on_every_operation() {
        let store = mock_store();
        // The mock fails the next call only, so arm it before each operation.
        let fail_next = |message: &str| {
            let entry = store.entry().unwrap();
            let cred = entry
                .as_any()
                .downcast_ref::<keyring_core::mock::Cred>()
                .unwrap();
            cred.set_error(keyring_core::Error::NoStorageAccess(message.into()));
        };
        fail_next("locked");
        assert!(matches!(store.load(), Err(OidcError::Keychain(_))));
        fail_next("locked");
        assert!(matches!(
            store.save(&session()),
            Err(OidcError::Keychain(_))
        ));
        fail_next("locked");
        assert!(matches!(store.clear(), Err(OidcError::Keychain(_))));
    }

    #[test]
    fn a_missing_platform_store_fails_closed() {
        let store = KeychainStore {
            key: "k".into(),
            store: Err("no store".into()),
        };
        assert!(matches!(store.load(), Err(OidcError::Keychain(m)) if m == "no store"));
    }

    /// Touches the real OS credential store (Windows Credential Manager, Secret Service):
    /// `cargo test -p aedst-oidc -- --ignored`. The entry is removed at the end.
    #[test]
    #[ignore = "touches the OS keychain"]
    fn keychain_store_round_trips_in_the_os_credential_store() {
        let store = KeychainStore::new("oidc-aedst-test-entry".into());
        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
        store.save(&session()).unwrap();
        assert_eq!(store.load().unwrap(), Some(session()));
        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }
}
