//! The use cases. The call is made directly first with a fresh Idempotency-Key; only a retryable
//! failure (offline, unavailable, timeout, rate limited) falls back to the outbox, **with the same
//! key**, so a request whose response was lost is applied once.

use std::sync::Arc;

use aedst_common::ErrorKind;

use super::{
    ports::{Analytics, PendingWrites, TaskRepository},
    task::{LOCAL_PREFIX, Task, TaskPage, TaskQuery},
    validation::NewTask,
};

/// How a create ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CreateOutcome {
    /// The server has it.
    Created(Task),
    /// Waiting in the outbox; the row shows as pending under this local id.
    Queued {
        /// `local:<key>`.
        local_id: String,
    },
}

/// How a complete/reopen ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SetDoneOutcome {
    /// The server applied it.
    Updated(Task),
    /// Waiting in the outbox.
    Queued,
}

/// Tasks use cases over the ports.
pub struct TaskService {
    repository: Arc<dyn TaskRepository>,
    pending: Arc<dyn PendingWrites>,
    analytics: Arc<dyn Analytics>,
    new_key: Box<dyn Fn() -> String + Send + Sync>,
}

impl TaskService {
    /// `new_key` makes a fresh idempotency key (a UUID in production).
    #[must_use]
    pub fn new(
        repository: Arc<dyn TaskRepository>,
        pending: Arc<dyn PendingWrites>,
        analytics: Arc<dyn Analytics>,
        new_key: impl Fn() -> String + Send + Sync + 'static,
    ) -> Self {
        Self {
            repository,
            pending,
            analytics,
            new_key: Box::new(new_key),
        }
    }

    /// One page of the list.
    ///
    /// # Errors
    /// The failure kind.
    pub async fn list(&self, query: &TaskQuery) -> Result<TaskPage, ErrorKind> {
        self.repository.list(query).await
    }

    /// Creates a task, queueing it when the failure is retryable.
    ///
    /// # Errors
    /// The failure kind; a failed enqueue is [`ErrorKind::Storage`].
    pub async fn create(&self, new: &NewTask) -> Result<CreateOutcome, ErrorKind> {
        let key = (self.new_key)();
        match self.repository.create(new, &key).await {
            Ok(task) => {
                self.analytics
                    .task_created(new.priority.key(), new.due_date.is_some());
                Ok(CreateOutcome::Created(task))
            }
            Err(kind) if kind.retryable() => {
                self.pending
                    .enqueue_create(&key, new)
                    .await
                    .map_err(|_| ErrorKind::Storage)?;
                self.analytics
                    .task_created(new.priority.key(), new.due_date.is_some());
                Ok(CreateOutcome::Queued {
                    local_id: format!("{LOCAL_PREFIX}{key}"),
                })
            }
            Err(kind) => Err(kind),
        }
    }

    /// Completes or reopens a task, queueing it when the failure is retryable.
    ///
    /// # Errors
    /// The failure kind; a failed enqueue is [`ErrorKind::Storage`].
    pub async fn set_done(&self, id: &str, done: bool) -> Result<SetDoneOutcome, ErrorKind> {
        let key = (self.new_key)();
        match self.repository.set_done(id, done, &key).await {
            Ok(task) => {
                if done {
                    self.analytics.task_completed();
                }
                Ok(SetDoneOutcome::Updated(task))
            }
            Err(kind) if kind.retryable() => {
                self.pending
                    .enqueue_set_done(&key, id, done)
                    .await
                    .map_err(|_| ErrorKind::Storage)?;
                Ok(SetDoneOutcome::Queued)
            }
            Err(kind) => Err(kind),
        }
    }
}
