//! A tiny key-value table for non-secret blobs (for example the cached capabilities answer).
//! Secrets never go here: tokens live in the OS keychain.
//!
//! A store built with [`KvStore::sealed`] encrypts every value at rest ([`Sealer`]); keys stay
//! plain (they are fixed names such as `capabilities.v1`, never user data).

use std::sync::Arc;

use crate::{database::Database, error::PersistenceError, seal::Sealer};

/// The associated data that binds a sealed value to its key.
fn context(key: &str) -> Vec<u8> {
    [&b"kv\0"[..], key.as_bytes()].concat()
}

/// Key-value access on the database thread.
#[derive(Clone)]
pub struct KvStore {
    db: Database,
    sealer: Option<Arc<Sealer>>,
}

impl KvStore {
    /// Uses `db` for every call; values are stored as given (tests, non-sensitive data).
    #[must_use]
    pub fn new(db: Database) -> Self {
        Self { db, sealer: None }
    }

    /// Uses `db` and encrypts every value with `sealer`, bound to its key; a value that is not
    /// sealed (or was sealed for another key) fails to read.
    #[must_use]
    pub fn sealed(db: Database, sealer: Arc<Sealer>) -> Self {
        Self {
            db,
            sealer: Some(sealer),
        }
    }

    /// Reads a value, `None` when the key is absent.
    ///
    /// # Errors
    /// SQLite errors or a closed database.
    pub async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        let context = context(key);
        let key = key.to_owned();
        let stored = self
            .db
            .call(move |c| {
                let mut statement = c.prepare_cached("SELECT value FROM kv WHERE key = ?1")?;
                let mut rows = statement.query([&key])?;
                Ok(rows
                    .next()?
                    .map(|row| row.get::<_, Vec<u8>>(0))
                    .transpose()?)
            })
            .await?;
        match (stored, &self.sealer) {
            (Some(value), Some(sealer)) => sealer.open(&context, &value).map(Some),
            (stored, _) => Ok(stored),
        }
    }

    /// Inserts or replaces a value.
    ///
    /// # Errors
    /// SQLite errors or a closed database.
    pub async fn set(&self, key: &str, value: &[u8]) -> Result<(), PersistenceError> {
        let value = match &self.sealer {
            Some(sealer) => sealer.seal(&context(key), value)?,
            None => value.to_vec(),
        };
        let key = key.to_owned();
        self.db
            .call(move |c| {
                c.execute(
                    "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, strftime('%s','now'))
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                    rusqlite::params![key, value],
                )?;
                Ok(())
            })
            .await
    }

    /// Removes a key (no error when absent).
    ///
    /// # Errors
    /// SQLite errors or a closed database.
    pub async fn delete(&self, key: &str) -> Result<(), PersistenceError> {
        let key = key.to_owned();
        self.db
            .call(move |c| {
                Ok(c.execute("DELETE FROM kv WHERE key = ?1", [&key])
                    .map(|_| ())?)
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_get_replace_delete() {
        let kv = KvStore::new(Database::open_in_memory().unwrap());
        assert_eq!(kv.get("a").await.unwrap(), None);
        kv.set("a", b"one").await.unwrap();
        assert_eq!(kv.get("a").await.unwrap().as_deref(), Some(&b"one"[..]));
        kv.set("a", b"two").await.unwrap();
        assert_eq!(kv.get("a").await.unwrap().as_deref(), Some(&b"two"[..]));
        kv.delete("a").await.unwrap();
        kv.delete("a").await.unwrap();
        assert_eq!(kv.get("a").await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_sealed_store_encrypts_at_rest_and_still_reads_legacy_rows() {
        let db = Database::open_in_memory().unwrap();
        let sealer = Arc::new(Sealer::new(crate::seal::DataKey::generate()));
        let kv = KvStore::sealed(db.clone(), Arc::clone(&sealer));
        kv.set("a", b"cached answer").await.unwrap();
        assert_eq!(
            kv.get("a").await.unwrap().as_deref(),
            Some(&b"cached answer"[..])
        );
        let raw = KvStore::new(db.clone()).get("a").await.unwrap().unwrap();
        assert!(!raw.windows(6).any(|w| w == b"cached"), "stored in the clear");

        KvStore::new(db.clone()).set("old", b"plain").await.unwrap();
        assert_eq!(
            kv.get("old").await.unwrap().as_deref(),
            Some(&b"plain"[..])
        );

        let other = KvStore::sealed(db, Arc::new(Sealer::new(crate::seal::DataKey::generate())));
        assert!(matches!(other.get("a").await, Err(PersistenceError::Sealed)));
    }
}
