//! The Tasks model. Pure: no I/O, no UI, no wire types.
//!
//! Unknown enum policy: a status or priority this build does not know is `Unknown`, never `Todo`
//! or `Medium`. The UI shows a neutral badge and does not offer `Unknown` in pickers; when writing,
//! `Unknown` becomes `UNSPECIFIED` so the server rejects it explicitly. `match` over these enums is
//! exhaustive, with no `_` arm.

/// Where a task is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    /// Not started.
    Todo,
    /// Being worked on.
    InProgress,
    /// Finished.
    Done,
    /// A value this build does not know.
    Unknown,
}

/// How urgent a task is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskPriority {
    /// Low.
    Low,
    /// Medium.
    Medium,
    /// High.
    High,
    /// Urgent.
    Urgent,
    /// A value this build does not know.
    Unknown,
}

impl TaskStatus {
    /// Stable key for the UI and tests.
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

impl TaskPriority {
    /// Stable key for the UI and tests.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Urgent => "urgent",
            Self::Unknown => "unknown",
        }
    }

    /// Parses a picker key. `unknown` is not offered, so it is not accepted.
    #[must_use]
    pub fn from_picker_key(key: &str) -> Option<Self> {
        match key {
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            "urgent" => Some(Self::Urgent),
            _ => None,
        }
    }
}

/// A task as the client shows it. Times are Unix seconds (UTC).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Task {
    /// Server id (a UUID), or `local:<key>` while a create waits in the outbox.
    pub id: String,
    /// One line, 1 to 200 code points.
    pub title: String,
    /// Free text, at most 4000 code points.
    pub description: String,
    /// Lifecycle state.
    pub status: TaskStatus,
    /// Urgency.
    pub priority: TaskPriority,
    /// Optional due day.
    pub due_date: Option<i64>,
    /// When the server created it.
    pub created_at: i64,
    /// Optimistic-concurrency version.
    pub version: i32,
}

impl Task {
    /// True for a create that has not reached the server yet.
    #[must_use]
    pub fn is_local(&self) -> bool {
        self.id.starts_with(LOCAL_PREFIX)
    }
}

/// Prefix of the id a queued create carries until the server confirms it.
pub const LOCAL_PREFIX: &str = "local:";

/// One page of the list.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaskPage {
    /// The rows.
    pub tasks: Vec<Task>,
    /// Token of the next page, `None` on the last one.
    pub next_page_token: Option<String>,
    /// Only the FIRST page carries it; keep it from there.
    pub total_count: Option<u32>,
}

/// Page size the list asks for (the server default is also 20, clamp 100).
pub const PAGE_SIZE: u32 = 20;

/// What the list asks for. The sort is `created_at DESC`, the server default.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaskQuery {
    /// Trimmed, at most 200 characters, case-insensitive substring of title and description.
    pub search: String,
    /// Echo of the last response's token with the same filters; `None` for the first page.
    pub page_token: Option<String>,
}
