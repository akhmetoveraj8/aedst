//! A tiny key-value table for non-secret blobs (for example the cached capabilities answer).
//! Secrets never go here: tokens live in the OS keychain.

use crate::{database::Database, error::PersistenceError};

/// Key-value access on the database thread.
#[derive(Clone)]
pub struct KvStore {
    db: Database,
}

impl KvStore {
    /// Uses `db` for every call.
    #[must_use]
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Reads a value, `None` when the key is absent.
    ///
    /// # Errors
    /// SQLite errors or a closed database.
    pub async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        let key = key.to_owned();
        self.db
            .call(move |c| {
                let mut statement = c.prepare_cached("SELECT value FROM kv WHERE key = ?1")?;
                let mut rows = statement.query([&key])?;
                Ok(rows
                    .next()?
                    .map(|row| row.get::<_, Vec<u8>>(0))
                    .transpose()?)
            })
            .await
    }

    /// Inserts or replaces a value.
    ///
    /// # Errors
    /// SQLite errors or a closed database.
    pub async fn set(&self, key: &str, value: &[u8]) -> Result<(), PersistenceError> {
        let (key, value) = (key.to_owned(), value.to_vec());
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
}
