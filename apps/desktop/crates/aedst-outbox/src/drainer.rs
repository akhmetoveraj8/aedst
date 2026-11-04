//! The delivery state machine (identical to `docs/contract/behavior/offline-outbox.json` and to
//! the Android client).
//!
//! Items go out in creation order and the item id is the `Idempotency-Key` of every attempt.
//! Success removes the item. A retryable failure records an attempt and stops the run. A permanent
//! failure, an unhandled type, a handler that panics, or the 8th failed attempt parks the item and
//! the run continues. `Blocked` (signed out, upgrade required) stops the run without counting.

use std::{collections::HashMap, panic::AssertUnwindSafe, sync::Arc};

use aedst_persistence::PersistenceError;
use futures::{FutureExt, future::BoxFuture};

use crate::queue::{OutboxItem, SqliteOutbox};

/// A failed attempt parks the item on the 8th failure.
pub const MAX_ATTEMPTS: u32 = 8;

/// What a handler reports for one delivery attempt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
    /// The server applied it (or had already applied it, same key).
    Delivered,
    /// Network or server trouble: try again later.
    Retryable,
    /// The server refused it for good (validation, not found).
    Permanent,
    /// Cannot deliver now and it is not the item's fault (`unauthenticated`, `upgrade_required`).
    Blocked,
}

/// Delivers one kind of item. The item id is the `Idempotency-Key`.
pub trait OutboxHandler: Send + Sync {
    /// Sends `item` to the server.
    fn deliver<'a>(&'a self, item: &'a OutboxItem) -> BoxFuture<'a, Delivery>;
}

/// Handlers by item kind, contributed per feature.
#[derive(Clone, Default)]
pub struct Handlers(HashMap<String, Arc<dyn OutboxHandler>>);

impl Handlers {
    /// Registers (or replaces) the handler of `kind`.
    pub fn register(&mut self, kind: &str, handler: Arc<dyn OutboxHandler>) {
        self.0.insert(kind.to_owned(), handler);
    }
}

/// How a run ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunResult {
    /// Nothing pending is left.
    Complete,
    /// A retryable failure stopped the run: schedule another one with backoff.
    Retry {
        /// Failed attempts of the item that stopped the run (drives the backoff).
        attempts: u32,
    },
    /// The run stopped without counting an attempt; wait for a sign-in or an update.
    Blocked,
}

/// Runs the queue once.
///
/// # Errors
/// Database errors (the run stops; nothing is lost).
pub async fn run(queue: &SqliteOutbox, handlers: &Handlers) -> Result<RunResult, PersistenceError> {
    while let Some(item) = queue.next_pending().await? {
        let Some(handler) = handlers.0.get(&item.kind) else {
            tracing::warn!(kind = %item.kind, "no outbox handler: parking");
            queue.park(&item.id, "unhandled_type").await?;
            continue;
        };
        let outcome = match AssertUnwindSafe(handler.deliver(&item))
            .catch_unwind()
            .await
        {
            Ok(outcome) => outcome,
            Err(_) => {
                tracing::error!(kind = %item.kind, "outbox handler panicked: parking");
                queue.park(&item.id, "handler_panic").await?;
                continue;
            }
        };
        match outcome {
            Delivery::Delivered => queue.remove(&item.id).await?,
            Delivery::Permanent => queue.park(&item.id, "permanent").await?,
            Delivery::Blocked => return Ok(RunResult::Blocked),
            Delivery::Retryable if item.attempts + 1 >= MAX_ATTEMPTS => {
                queue.park(&item.id, "too_many_attempts").await?
            }
            Delivery::Retryable => {
                let attempts = queue.record_attempt(&item.id, "retryable").await?;
                return Ok(RunResult::Retry { attempts });
            }
        }
    }
    Ok(RunResult::Complete)
}
