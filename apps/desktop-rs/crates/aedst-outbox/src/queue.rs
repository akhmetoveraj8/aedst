//! The persistent side of the outbox: a table on the database thread.
//!
//! `last_error` stores an error KIND, never a message. The payload is not encrypted: queue only
//! what the operation needs, never tokens or e-mail addresses.

use aedst_persistence::{Database, PersistenceError};
use rusqlite::{OptionalExtension, params};

/// Delivery state of a queued item.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Waiting for delivery.
    Pending,
    /// Parked: it will not be retried (permanent failure, unknown type, too many attempts).
    Failed,
}

/// One queued write.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutboxItem {
    /// The `Idempotency-Key` of every delivery attempt of this item.
    pub id: String,
    /// Handler key, for example `task.create`.
    pub kind: String,
    /// Operation data, opaque to the queue.
    pub payload: Vec<u8>,
    /// Failed attempts so far.
    pub attempts: u32,
    /// Pending or parked.
    pub status: Status,
}

/// Persistence port of the outbox.
#[derive(Clone)]
pub struct SqliteOutbox {
    db: Database,
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxItem> {
    Ok(OutboxItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        payload: row.get(2)?,
        attempts: row.get(3)?,
        status: if row.get::<_, i64>(4)? == 0 {
            Status::Pending
        } else {
            Status::Failed
        },
    })
}

const COLUMNS: &str = "id, type, payload, attempts, status";

impl SqliteOutbox {
    /// Uses the shared database thread.
    #[must_use]
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Adds an item. Returns `false` (and changes nothing) when the id already exists (double tap).
    ///
    /// # Errors
    /// Database errors.
    pub async fn enqueue(
        &self,
        id: &str,
        kind: &str,
        payload: &[u8],
    ) -> Result<bool, PersistenceError> {
        let (id, kind, payload) = (id.to_owned(), kind.to_owned(), payload.to_vec());
        self.db
            .call(move |c| {
                let inserted = c.execute(
                    "INSERT OR IGNORE INTO outbox (id, type, payload) VALUES (?1, ?2, ?3)",
                    params![id, kind, payload],
                )?;
                Ok(inserted == 1)
            })
            .await
    }

    /// The oldest pending item, if any.
    ///
    /// # Errors
    /// Database errors.
    pub async fn next_pending(&self) -> Result<Option<OutboxItem>, PersistenceError> {
        self.db
            .call(|c| {
                let sql =
                    format!("SELECT {COLUMNS} FROM outbox WHERE status = 0 ORDER BY seq LIMIT 1");
                Ok(c.query_row(&sql, [], row_to_item).optional()?)
            })
            .await
    }

    /// Every item in delivery order (diagnostics and tests).
    ///
    /// # Errors
    /// Database errors.
    pub async fn all(&self) -> Result<Vec<OutboxItem>, PersistenceError> {
        self.db
            .call(|c| {
                let sql = format!("SELECT {COLUMNS} FROM outbox ORDER BY seq");
                let mut statement = c.prepare(&sql)?;
                let items = statement
                    .query_map([], row_to_item)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(items)
            })
            .await
    }

    /// Number of items still waiting for delivery.
    ///
    /// # Errors
    /// Database errors.
    pub async fn pending_count(&self) -> Result<u64, PersistenceError> {
        let count: i64 = self
            .db
            .call(|c| {
                Ok(
                    c.query_row("SELECT count(*) FROM outbox WHERE status = 0", [], |r| {
                        r.get(0)
                    })?,
                )
            })
            .await?;
        Ok(u64::try_from(count).unwrap_or(0))
    }

    /// Removes a delivered item.
    ///
    /// # Errors
    /// Database errors.
    pub async fn remove(&self, id: &str) -> Result<(), PersistenceError> {
        let id = id.to_owned();
        self.db
            .call(move |c| {
                Ok(c.execute("DELETE FROM outbox WHERE id = ?1", [&id])
                    .map(|_| ())?)
            })
            .await
    }

    /// Counts one failed attempt and returns the new total.
    ///
    /// # Errors
    /// Database errors.
    pub async fn record_attempt(
        &self,
        id: &str,
        error_kind: &str,
    ) -> Result<u32, PersistenceError> {
        let (id, kind) = (id.to_owned(), error_kind.to_owned());
        self.db
            .call(move |c| {
                c.execute(
                    "UPDATE outbox SET attempts = attempts + 1, last_error = ?2 WHERE id = ?1",
                    params![id, kind],
                )?;
                Ok(
                    c.query_row("SELECT attempts FROM outbox WHERE id = ?1", [&id], |r| {
                        r.get(0)
                    })?,
                )
            })
            .await
    }

    /// Parks an item: it stays visible but is never delivered again.
    ///
    /// # Errors
    /// Database errors.
    pub async fn park(&self, id: &str, error_kind: &str) -> Result<(), PersistenceError> {
        let (id, kind) = (id.to_owned(), error_kind.to_owned());
        self.db
            .call(move |c| {
                Ok(c.execute(
                    "UPDATE outbox SET status = 1, last_error = ?2 WHERE id = ?1",
                    params![id, kind],
                )
                .map(|_| ())?)
            })
            .await
    }

    /// Drops everything. Called on sign-out and on an interactive sign-in, so queued writes are never
    /// delivered under another account.
    ///
    /// # Errors
    /// Database errors.
    pub async fn purge(&self) -> Result<(), PersistenceError> {
        self.db
            .call(|c| Ok(c.execute("DELETE FROM outbox", []).map(|_| ())?))
            .await?;
        self.db.checkpoint_truncate().await
    }
}
