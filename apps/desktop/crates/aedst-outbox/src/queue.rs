//! The persistent side of the outbox: a table on the database thread.
//!
//! `last_error` stores an error KIND, never a message. A queue built with [`SqliteOutbox::sealed`]
//! encrypts the payload at rest (AES-256-GCM, [`Sealer`]); still queue only what the operation
//! needs, never tokens or e-mail addresses. An item whose payload cannot be decrypted (the data key
//! was lost with the keychain) is parked as `unreadable` instead of blocking the queue.
//!
//! The number of pending items is published on a `watch` channel
//! ([`SqliteOutbox::subscribe_pending`]) after every change, for the "waiting to sync" banner and
//! for delivering a new item at once.

use std::sync::Arc;

use aedst_persistence::{Database, PersistenceError, Sealer};
use rusqlite::{OptionalExtension, params};
use tokio::sync::watch;

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

/// The associated data that binds a sealed payload to its item: a payload copied to another item
/// (another id or kind) does not open.
fn context(id: &str, kind: &str) -> Vec<u8> {
    [&b"outbox\0"[..], id.as_bytes(), &b"\0"[..], kind.as_bytes()].concat()
}

/// Persistence port of the outbox. Clones share the database, the sealer and the pending count.
#[derive(Clone)]
pub struct SqliteOutbox {
    db: Database,
    sealer: Option<Arc<Sealer>>,
    pending: Arc<watch::Sender<u64>>,
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
    /// Uses the shared database thread; payloads are stored as given (tests).
    #[must_use]
    pub fn new(db: Database) -> Self {
        Self::build(db, None)
    }

    /// Uses the shared database thread and encrypts every payload with `sealer`. Payloads written
    /// before sealing existed are still read.
    #[must_use]
    pub fn sealed(db: Database, sealer: Arc<Sealer>) -> Self {
        Self::build(db, Some(sealer))
    }

    fn build(db: Database, sealer: Option<Arc<Sealer>>) -> Self {
        Self {
            db,
            sealer,
            pending: Arc::new(watch::channel(0).0),
        }
    }

    /// The number of pending items, updated after every enqueue, delivery, park and purge. It
    /// starts at 0; call [`Self::refresh_pending`] once at session start to load the stored count.
    #[must_use]
    pub fn subscribe_pending(&self) -> watch::Receiver<u64> {
        self.pending.subscribe()
    }

    /// Reads the pending count from the database and publishes it (subscribers wake only when it
    /// changed).
    ///
    /// # Errors
    /// Database errors.
    pub async fn refresh_pending(&self) -> Result<u64, PersistenceError> {
        let count = self.pending_count().await?;
        self.pending.send_if_modified(|current| {
            let changed = *current != count;
            *current = count;
            changed
        });
        Ok(count)
    }

    /// [`Self::refresh_pending`] after a change; a failure only delays the banner, so it is logged.
    async fn publish_pending(&self) {
        if let Err(error) = self.refresh_pending().await {
            tracing::warn!(%error, "could not count the pending outbox items");
        }
    }

    /// Decrypts the payload of a stored item (bound to its id and kind).
    fn open(&self, mut item: OutboxItem) -> Result<OutboxItem, PersistenceError> {
        if let Some(sealer) = &self.sealer {
            item.payload = sealer.open(&context(&item.id, &item.kind), &item.payload)?;
        }
        Ok(item)
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
        let payload = match &self.sealer {
            Some(sealer) => sealer.seal(&context(id, kind), payload)?,
            None => payload.to_vec(),
        };
        let (id, kind) = (id.to_owned(), kind.to_owned());
        let inserted = self
            .db
            .call(move |c| {
                let inserted = c.execute(
                    "INSERT OR IGNORE INTO outbox (id, type, payload) VALUES (?1, ?2, ?3)",
                    params![id, kind, payload],
                )?;
                Ok(inserted == 1)
            })
            .await?;
        if inserted {
            self.publish_pending().await;
        }
        Ok(inserted)
    }

    /// The oldest pending item whose payload can be read, if any. An unreadable item (its payload
    /// was sealed with a key that is gone) is parked as `unreadable` and skipped.
    ///
    /// # Errors
    /// Database errors.
    pub async fn next_pending(&self) -> Result<Option<OutboxItem>, PersistenceError> {
        loop {
            let stored = self
                .db
                .call(|c| {
                    let sql = format!(
                        "SELECT {COLUMNS} FROM outbox WHERE status = 0 ORDER BY seq LIMIT 1"
                    );
                    Ok(c.query_row(&sql, [], row_to_item).optional()?)
                })
                .await?;
            let Some(item) = stored else {
                return Ok(None);
            };
            let id = item.id.clone();
            match self.open(item) {
                Ok(item) => return Ok(Some(item)),
                Err(PersistenceError::Sealed) => {
                    tracing::warn!("an outbox payload cannot be decrypted: parking it");
                    self.park(&id, "unreadable").await?;
                }
                Err(error) => return Err(error),
            }
        }
    }

    /// Every item in delivery order (diagnostics and tests), payloads decrypted.
    ///
    /// # Errors
    /// Database errors, or [`PersistenceError::Sealed`] when a payload cannot be decrypted.
    pub async fn all(&self) -> Result<Vec<OutboxItem>, PersistenceError> {
        let stored = self
            .db
            .call(|c| {
                let sql = format!("SELECT {COLUMNS} FROM outbox ORDER BY seq");
                let mut statement = c.prepare(&sql)?;
                let items = statement
                    .query_map([], row_to_item)?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(items)
            })
            .await?;
        stored.into_iter().map(|item| self.open(item)).collect()
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
            .await?;
        self.publish_pending().await;
        Ok(())
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
            .await?;
        self.publish_pending().await;
        Ok(())
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
        self.publish_pending().await;
        self.db.checkpoint_truncate().await
    }
}
