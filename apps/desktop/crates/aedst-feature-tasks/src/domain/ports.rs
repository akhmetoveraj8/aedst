//! What the domain needs from the outside world. `data` implements these; tests use fakes.

use aedst_common::ErrorKind;
use futures::future::BoxFuture;

use super::{
    task::{Task, TaskPage, TaskQuery},
    validation::NewTask,
};

/// The server side of Tasks. Every write carries the `Idempotency-Key`, so repeating it is safe.
pub trait TaskRepository: Send + Sync {
    /// One page of the list.
    fn list<'a>(&'a self, query: &'a TaskQuery) -> BoxFuture<'a, Result<TaskPage, ErrorKind>>;
    /// Creates a task.
    fn create<'a>(
        &'a self,
        new: &'a NewTask,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>>;
    /// Completes (`done`) or reopens a task: the only way status moves to or from `Done`.
    fn set_done<'a>(
        &'a self,
        id: &'a str,
        done: bool,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>>;
}

/// Writes that must survive being offline (the outbox).
pub trait PendingWrites: Send + Sync {
    /// Queues a create under `key` (the same key the direct attempt used).
    fn enqueue_create<'a>(
        &'a self,
        key: &'a str,
        new: &'a NewTask,
    ) -> BoxFuture<'a, Result<(), ErrorKind>>;
    /// Queues a complete/reopen under `key`.
    fn enqueue_set_done<'a>(
        &'a self,
        key: &'a str,
        id: &'a str,
        done: bool,
    ) -> BoxFuture<'a, Result<(), ErrorKind>>;
}

/// Product analytics. Names are fixed by `docs/contract/analytics-events.json`; no titles,
/// descriptions or other free text, ever.
pub trait Analytics: Send + Sync {
    /// `task_created` with `priority` and `has_due_date`.
    fn task_created(&self, priority: &'static str, has_due_date: bool);
    /// `task_completed`, no properties.
    fn task_completed(&self);
}

/// Analytics that does nothing (consent not given, or tests).
#[derive(Clone, Copy, Debug, Default)]
pub struct NoAnalytics;

impl Analytics for NoAnalytics {
    fn task_created(&self, _priority: &'static str, _has_due_date: bool) {}
    fn task_completed(&self) {}
}
