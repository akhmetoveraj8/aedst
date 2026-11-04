//! The operator's view of the system. Timestamps are Unix seconds (UTC).

use std::fmt;

/// Rows per page (the proto allows 0..=100; 0 would mean the server default).
pub const PAGE_SIZE: u32 = 25;

/// The counters of the overview tab.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Overview {
    /// Tasks (a lower bound beyond 1,000,000).
    pub tasks_total: i64,
    /// Completed tasks.
    pub tasks_done: i64,
    /// Overdue tasks.
    pub tasks_overdue: i64,
    /// Media items.
    pub media_total: i64,
    /// Media size in bytes.
    pub media_bytes: i64,
    /// Registered push devices.
    pub push_devices: i64,
    /// Age of the oldest ready background job, seconds (0 when none waits).
    pub job_lag_seconds: i64,
    /// Queued and retrying background jobs.
    pub jobs_pending: i64,
}

/// Status of a task. Unknown server numbers map to `Unknown` and are never offered anywhere.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    /// Not started.
    Todo,
    /// Started.
    InProgress,
    /// Finished.
    Done,
    /// Unspecified or a value this build does not know.
    Unknown,
}

impl TaskStatus {
    /// From the `aedst.tasks.v1.TaskStatus` number.
    #[must_use]
    pub fn from_number(value: i32) -> Self {
        match value {
            1 => Self::Todo,
            2 => Self::InProgress,
            3 => Self::Done,
            _ => Self::Unknown,
        }
    }

    /// Translation key used by the view.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in-progress",
            Self::Done => "done",
            Self::Unknown => "unknown",
        }
    }
}

/// Any user's task.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminTask {
    /// Task id (UUID).
    pub id: String,
    /// Owner id (UUID).
    pub owner_id: String,
    /// Title.
    pub title: String,
    /// Status.
    pub status: TaskStatus,
    /// Creation time.
    pub created_at: i64,
    /// Optional due time.
    pub due_date: Option<i64>,
}

/// One audit-log line. `Debug` hides the reason.
#[derive(Clone, PartialEq, Eq)]
pub struct AuditEntry {
    /// Entry id.
    pub id: String,
    /// Operator who acted.
    pub actor_id: String,
    /// What happened (a stable server code such as `task.delete`).
    pub action: String,
    /// Kind of the target.
    pub target_kind: String,
    /// Id of the target.
    pub target_id: String,
    /// Free text the operator gave (never logged).
    pub reason: String,
    /// When.
    pub created_at: i64,
}

impl fmt::Debug for AuditEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuditEntry")
            .field("id", &self.id)
            .field("action", &self.action)
            .field("reason", &"<hidden>")
            .finish_non_exhaustive()
    }
}

/// Which page to fetch: `None` is the first.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageRequest {
    /// Token echoed back exactly as the server gave it.
    pub page_token: Option<String>,
}

/// One page of any list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page<T> {
    /// Items.
    pub items: Vec<T>,
    /// Present while more pages exist.
    pub next_page_token: Option<String>,
}
