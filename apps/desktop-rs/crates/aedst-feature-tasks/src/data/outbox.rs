//! The Tasks side of the offline outbox: the queue adapter and the two delivery handlers.
//!
//! Types are `task.create` and `task.update` (checked against `knownTypes` in
//! `offline-outbox.json`). The payload holds only what the operation needs (title, description,
//! priority, due date; for an update the id and the flag): no tokens, no e-mail. The outbox item id is
//! the `Idempotency-Key` of every delivery attempt.

use std::sync::Arc;

use aedst_common::{ErrorKind, OutboxVerdict};
use aedst_outbox::{Delivery, Handlers, OutboxHandler, OutboxItem, SqliteOutbox};
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::domain::{NewTask, PendingWrites, TaskPriority, TaskRepository};

/// Outbox type of a queued create.
pub const KIND_CREATE: &str = "task.create";
/// Outbox type of a queued complete/reopen.
pub const KIND_UPDATE: &str = "task.update";

#[derive(Serialize, Deserialize)]
struct CreatePayload {
    title: String,
    description: String,
    priority: String,
    due_date: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct UpdatePayload {
    id: String,
    done: bool,
}

/// Queues writes in the shared SQLite outbox.
#[derive(Clone)]
pub struct OutboxPendingWrites {
    queue: SqliteOutbox,
}

impl OutboxPendingWrites {
    /// Over the shared outbox table.
    #[must_use]
    pub fn new(queue: SqliteOutbox) -> Self {
        Self { queue }
    }
}

fn storage<E>(_: E) -> ErrorKind {
    ErrorKind::Storage
}

impl PendingWrites for OutboxPendingWrites {
    fn enqueue_create<'a>(
        &'a self,
        key: &'a str,
        new: &'a NewTask,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            let payload = serde_json::to_vec(&CreatePayload {
                title: new.title.clone(),
                description: new.description.clone(),
                priority: new.priority.key().to_owned(),
                due_date: new.due_date,
            })
            .map_err(storage)?;
            // `false` means the key is already queued (double tap): nothing to do.
            self.queue
                .enqueue(key, KIND_CREATE, &payload)
                .await
                .map(|_| ())
                .map_err(storage)
        })
    }

    fn enqueue_set_done<'a>(
        &'a self,
        key: &'a str,
        id: &'a str,
        done: bool,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            let payload = serde_json::to_vec(&UpdatePayload {
                id: id.to_owned(),
                done,
            })
            .map_err(storage)?;
            self.queue
                .enqueue(key, KIND_UPDATE, &payload)
                .await
                .map(|_| ())
                .map_err(storage)
        })
    }
}

fn delivery(kind: ErrorKind) -> Delivery {
    match kind.outbox_verdict() {
        OutboxVerdict::Retry => Delivery::Retryable,
        OutboxVerdict::Permanent => Delivery::Permanent,
        OutboxVerdict::Blocked => Delivery::Blocked,
    }
}

struct CreateHandler(Arc<dyn TaskRepository>);
struct UpdateHandler(Arc<dyn TaskRepository>);

impl OutboxHandler for CreateHandler {
    fn deliver<'a>(&'a self, item: &'a OutboxItem) -> BoxFuture<'a, Delivery> {
        Box::pin(async move {
            // An unreadable or invalid payload can never succeed: park it.
            let Ok(payload) = serde_json::from_slice::<CreatePayload>(&item.payload) else {
                return Delivery::Permanent;
            };
            let Ok(new) = NewTask::validate(
                &payload.title,
                &payload.description,
                TaskPriority::from_picker_key(&payload.priority),
                payload.due_date,
            ) else {
                return Delivery::Permanent;
            };
            match self.0.create(&new, &item.id).await {
                Ok(_) => Delivery::Delivered,
                Err(kind) => delivery(kind),
            }
        })
    }
}

impl OutboxHandler for UpdateHandler {
    fn deliver<'a>(&'a self, item: &'a OutboxItem) -> BoxFuture<'a, Delivery> {
        Box::pin(async move {
            let Ok(payload) = serde_json::from_slice::<UpdatePayload>(&item.payload) else {
                return Delivery::Permanent;
            };
            match self.0.set_done(&payload.id, payload.done, &item.id).await {
                Ok(_) => Delivery::Delivered,
                Err(kind) => delivery(kind),
            }
        })
    }
}

/// Adds the Tasks handlers to the app's handler table.
pub fn register_handlers(handlers: &mut Handlers, repository: &Arc<dyn TaskRepository>) {
    handlers.register(KIND_CREATE, Arc::new(CreateHandler(Arc::clone(repository))));
    handlers.register(KIND_UPDATE, Arc::new(UpdateHandler(Arc::clone(repository))));
}
