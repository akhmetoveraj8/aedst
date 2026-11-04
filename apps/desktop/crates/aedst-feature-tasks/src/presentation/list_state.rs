//! What the list screen shows. Plain data, no UI types: the Slint glue copies it into the view.

use aedst_common::ErrorKind;

use crate::domain::{Task, TaskPriority, TaskStatus, ValidationError};

/// One row of the list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    /// Server id, or `local:<key>` for a create still in the outbox.
    pub id: String,
    /// Title.
    pub title: String,
    /// Status (`Unknown` renders a neutral badge).
    pub status: TaskStatus,
    /// Priority (`Unknown` renders a neutral badge).
    pub priority: TaskPriority,
    /// Waiting in the outbox ("Pending sync" badge).
    pub pending: bool,
}

impl Row {
    /// A row for a task the server knows.
    #[must_use]
    pub fn from_task(task: &Task) -> Self {
        Self {
            id: task.id.clone(),
            title: task.title.clone(),
            status: task.status,
            priority: task.priority,
            pending: task.is_local(),
        }
    }

    /// True when the checkbox should be checked.
    #[must_use]
    pub fn done(&self) -> bool {
        self.status == TaskStatus::Done
    }
}

/// Where loading stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Nothing requested yet.
    Idle,
    /// The first page is loading.
    Loading,
    /// Rows are shown (possibly none: the empty state).
    Ready,
    /// The first page failed; show the translated message of this kind and a retry.
    Failed(ErrorKind),
}

/// The state of the create form after the last submit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CreateStatus {
    /// Nothing submitted, or the last create worked (the form is cleared).
    Idle,
    /// A request is in flight.
    Sending,
    /// Refused before any request.
    Invalid(ValidationError),
    /// The server refused or failed (not retryable, or the outbox failed).
    Failed(ErrorKind),
}

/// Everything the screen needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListView {
    /// Rows, newest first.
    pub rows: Vec<Row>,
    /// Loading phase.
    pub phase: Phase,
    /// Total from the first page.
    pub total_count: Option<u32>,
    /// A next page exists.
    pub has_more: bool,
    /// A further page is loading.
    pub loading_more: bool,
    /// Items waiting in the outbox ("Waiting to sync: N").
    pub pending_count: u64,
    /// The create form's state.
    pub create: CreateStatus,
    /// A row action (complete/reopen) or a later page failed; `Cancelled` is never stored.
    pub action_error: Option<ErrorKind>,
}

impl Default for ListView {
    fn default() -> Self {
        Self {
            rows: Vec::new(),
            phase: Phase::Idle,
            total_count: None,
            has_more: false,
            loading_more: false,
            pending_count: 0,
            create: CreateStatus::Idle,
            action_error: None,
        }
    }
}
