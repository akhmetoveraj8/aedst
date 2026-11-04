//! The one central migration list. `PRAGMA user_version` is the schema version.
//!
//! Shipped migrations are frozen by SHA-256 (see the `schema_history` test): editing one, or
//! appending one without recording its hash, fails the test. A database newer than this build is
//! refused instead of being "downgraded".
//!
//! Custom code, with a documented reason: `rusqlite_migration` 2.6.0 (checked 2026-11-04) still
//! requires `rusqlite ^0.40` while the workspace is on 0.41 (two `libsqlite3-sys` cannot link), and
//! it has no hash freeze. Revisit when it releases support for the current `rusqlite`.

use rusqlite::Connection;

use crate::error::PersistenceError;

/// One schema step.
#[derive(Debug)]
pub struct Migration {
    /// 1-based, dense, the value stored in `user_version` afterwards.
    pub version: u32,
    /// Short name, for logs only (not part of the hash).
    pub name: &'static str,
    /// SQL run in one transaction.
    pub sql: &'static str,
}

/// Every migration, oldest first. Never edit an entry that has shipped; append.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_outbox",
        // `id` is the Idempotency-Key: UNIQUE makes a double enqueue a no-op (INSERT OR IGNORE).
        // `last_error` holds an error KIND, never a message. status: 0 pending, 1 parked.
        sql: "CREATE TABLE outbox (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                payload BLOB NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                status INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
              );",
    },
    Migration {
        version: 2,
        name: "create_kv",
        // Non-secret blobs only (for example the cached capabilities answer).
        sql: "CREATE TABLE kv (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL,
                updated_at INTEGER NOT NULL
              );",
    },
];

/// The schema version of this build.
#[must_use]
pub fn latest_version() -> u32 {
    MIGRATIONS.last().map_or(0, |m| m.version)
}

/// Brings `connection` to [`latest_version`], one transaction per step.
///
/// # Errors
/// [`PersistenceError::TooNew`] when the file was written by a newer build, otherwise SQLite errors.
pub fn migrate(connection: &mut Connection) -> Result<(), PersistenceError> {
    let current: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current > latest_version() {
        return Err(PersistenceError::TooNew {
            found: current,
            supported: latest_version(),
        });
    }
    for migration in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = connection.transaction()?;
        tx.execute_batch(migration.sql)?;
        // PRAGMA does not take bound parameters; the value is a trusted integer.
        tx.execute_batch(&format!("PRAGMA user_version = {}", migration.version))?;
        tx.commit()?;
        tracing::info!(
            version = migration.version,
            name = migration.name,
            "applied migration"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;

    /// SHA-256 of each shipped migration's SQL. Append a line when you append a migration; never
    /// change an existing one.
    const FROZEN: &[(u32, &str)] = &[
        (
            1,
            "17b2644b734704c65e40f3879edf845a663dc796e1f7ab1581f820b2cb699746",
        ),
        (
            2,
            "373531314403cff4c384e7393afb2c11ae250a1ede2baca1fff0d868c9a06d2c",
        ),
    ];

    fn hash(sql: &str) -> String {
        // Hash without carriage returns, so a CRLF checkout gives the same value.
        let normalised: String = sql.chars().filter(|c| *c != '\r').collect();
        Sha256::digest(normalised.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn schema_history_is_frozen() {
        assert_eq!(
            FROZEN.len(),
            MIGRATIONS.len(),
            "record the hash of every new migration in FROZEN"
        );
        for (migration, (version, frozen)) in MIGRATIONS.iter().zip(FROZEN) {
            assert_eq!(migration.version, *version);
            assert_eq!(
                hash(migration.sql),
                *frozen,
                "migration {} ({}) was edited",
                version,
                migration.name
            );
        }
    }

    #[test]
    fn versions_are_dense_and_start_at_one() {
        for (index, migration) in MIGRATIONS.iter().enumerate() {
            assert_eq!(migration.version as usize, index + 1);
        }
    }

    #[test]
    fn every_old_version_upgrades_to_the_latest() {
        for start in 0..latest_version() {
            let mut connection = Connection::open_in_memory().unwrap();
            for migration in MIGRATIONS.iter().filter(|m| m.version <= start) {
                connection.execute_batch(migration.sql).unwrap();
                connection
                    .execute_batch(&format!("PRAGMA user_version = {}", migration.version))
                    .unwrap();
            }
            migrate(&mut connection).unwrap();
            let version: u32 = connection
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(version, latest_version(), "from version {start}");
        }
    }

    #[test]
    fn a_newer_database_is_refused() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA user_version = 999")
            .unwrap();
        assert!(matches!(
            migrate(&mut connection),
            Err(PersistenceError::TooNew { found: 999, .. })
        ));
    }
}
