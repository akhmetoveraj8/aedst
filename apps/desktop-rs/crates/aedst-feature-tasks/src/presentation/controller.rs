//! The list's view model: owns the state, calls the use cases, publishes a [`ListView`].
//!
//! No UI types: the Slint glue subscribes to [`TaskListController::subscribe`]. A response that
//! belongs to an older load (the user refreshed meanwhile) is discarded, and `Cancelled` never
//! shows an error.

use std::sync::{Arc, Mutex, PoisonError};

use aedst_common::ErrorKind;
use tokio::sync::watch;

use super::list_state::{CreateStatus, ListView, Phase, Row};
use crate::domain::{
    CreateOutcome, LOCAL_PREFIX, NewTask, SetDoneOutcome, TaskPriority, TaskQuery, TaskService,
    TaskStatus,
};

#[derive(Default)]
struct Inner {
    view: ListView,
    next_token: Option<String>,
    search: String,
    /// Bumped by every first-page load; a result carrying an older value is dropped.
    epoch: u64,
}

/// Drives the Tasks list screen.
pub struct TaskListController {
    service: Arc<TaskService>,
    inner: Mutex<Inner>,
    published: watch::Sender<ListView>,
}

impl TaskListController {
    /// A controller over the use cases.
    #[must_use]
    pub fn new(service: Arc<TaskService>) -> Arc<Self> {
        Arc::new(Self {
            service,
            inner: Mutex::new(Inner::default()),
            published: watch::channel(ListView::default()).0,
        })
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<ListView> {
        self.published.subscribe()
    }

    fn update<T>(&self, work: impl FnOnce(&mut Inner) -> T) -> T {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let result = work(&mut inner);
        let view = inner.view.clone();
        drop(inner);
        self.published.send_replace(view);
        result
    }

    /// Items waiting in the outbox, for the "waiting to sync" banner.
    pub fn set_pending_count(&self, count: u64) {
        self.update(|i| i.view.pending_count = count);
    }

    /// Loads (or reloads) the first page. Safe to call again: only the latest call wins.
    pub async fn load_first(&self) {
        let (epoch, query) = self.update(|i| {
            i.epoch += 1;
            i.view.phase = Phase::Loading;
            i.view.action_error = None;
            (
                i.epoch,
                TaskQuery {
                    search: i.search.clone(),
                    page_token: None,
                },
            )
        });
        let result = self.service.list(&query).await;
        self.update(|i| {
            if i.epoch != epoch {
                return; // a newer load started while this one was in flight
            }
            match result {
                Ok(page) => {
                    // Rows still waiting in the outbox stay on top until the server confirms them.
                    let waiting: Vec<Row> =
                        i.view.rows.iter().filter(|r| r.pending).cloned().collect();
                    i.view.rows = waiting
                        .into_iter()
                        .chain(page.tasks.iter().map(Row::from_task))
                        .collect();
                    i.view.total_count = page.total_count;
                    i.view.has_more = page.next_page_token.is_some();
                    i.next_token = page.next_page_token;
                    i.view.phase = Phase::Ready;
                }
                Err(ErrorKind::Cancelled) => i.view.phase = Phase::Idle,
                Err(kind) => i.view.phase = Phase::Failed(kind),
            }
        });
    }

    /// Loads the next page, if there is one and none is loading.
    pub async fn load_more(&self) {
        let started = self.update(|i| {
            let token = i.next_token.clone()?;
            if i.view.loading_more || i.view.phase != Phase::Ready {
                return None;
            }
            i.view.loading_more = true;
            Some((
                i.epoch,
                TaskQuery {
                    search: i.search.clone(),
                    page_token: Some(token),
                },
            ))
        });
        let Some((epoch, query)) = started else {
            return;
        };
        let result = self.service.list(&query).await;
        self.update(|i| {
            if i.epoch != epoch {
                return;
            }
            i.view.loading_more = false;
            match result {
                Ok(page) => {
                    i.view.rows.extend(page.tasks.iter().map(Row::from_task));
                    i.view.has_more = page.next_page_token.is_some();
                    i.next_token = page.next_page_token;
                }
                Err(ErrorKind::Cancelled) => {}
                Err(kind) => i.view.action_error = Some(kind),
            }
        });
    }

    /// Validates and creates a task. `priority_key` is a picker key (`low`..`urgent`).
    pub async fn create(&self, title: &str, description: &str, priority_key: &str) {
        let new = match NewTask::validate(
            title,
            description,
            TaskPriority::from_picker_key(priority_key),
            None,
        ) {
            Ok(new) => new,
            Err(error) => return self.update(|i| i.view.create = CreateStatus::Invalid(error)),
        };
        self.update(|i| i.view.create = CreateStatus::Sending);
        let outcome = self.service.create(&new).await;
        self.update(|i| match outcome {
            Ok(CreateOutcome::Created(task)) => {
                i.view.rows.insert(0, Row::from_task(&task));
                i.view.total_count = i.view.total_count.map(|n| n + 1);
                i.view.create = CreateStatus::Idle;
            }
            Ok(CreateOutcome::Queued { local_id }) => {
                debug_assert!(local_id.starts_with(LOCAL_PREFIX));
                i.view.rows.insert(
                    0,
                    Row {
                        id: local_id,
                        title: new.title.clone(),
                        status: TaskStatus::Todo,
                        priority: new.priority,
                        pending: true,
                    },
                );
                i.view.create = CreateStatus::Idle;
            }
            Err(ErrorKind::Cancelled) => i.view.create = CreateStatus::Idle,
            Err(kind) => i.view.create = CreateStatus::Failed(kind),
        });
    }

    /// Completes a task, or reopens it when it is already done. A pending (local) row cannot be
    /// changed until the server confirms it.
    pub async fn toggle(&self, id: &str) {
        let Some(done) = self.update(|i| {
            i.view.action_error = None;
            i.view
                .rows
                .iter()
                .find(|r| r.id == id && !r.pending)
                .map(|r| r.status != TaskStatus::Done)
        }) else {
            return;
        };
        let outcome = self.service.set_done(id, done).await;
        self.update(|i| {
            let Some(row) = i.view.rows.iter_mut().find(|r| r.id == id) else {
                return;
            };
            match outcome {
                Ok(SetDoneOutcome::Updated(task)) => *row = Row::from_task(&task),
                Ok(SetDoneOutcome::Queued) => {
                    row.status = if done {
                        TaskStatus::Done
                    } else {
                        TaskStatus::Todo
                    };
                    row.pending = true;
                }
                Err(ErrorKind::Cancelled) => {}
                Err(kind) => i.view.action_error = Some(kind),
            }
        });
    }
}
