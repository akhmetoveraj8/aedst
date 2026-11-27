//! What the admin screen shows. Plain data, no UI types: the Slint glue copies it into the view.

use aedst_common::{ErrorKind, PageCursor};

use crate::domain::{AdminTask, AuditEntry, Overview, ValidationError};

/// The tab strip.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tab {
    /// Counters.
    Overview,
    /// Any user's tasks.
    Tasks,
    /// Audit log.
    Audit,
    /// Compose a system notification.
    Broadcast,
}

impl Tab {
    /// The key the view uses; unknown keys are refused so a stray string never selects a tab.
    #[must_use]
    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "overview" => Some(Self::Overview),
            "tasks" => Some(Self::Tasks),
            "audit" => Some(Self::Audit),
            "broadcast" => Some(Self::Broadcast),
            _ => None,
        }
    }

    /// See [`Tab::from_key`].
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Overview => "overview",
            Self::Tasks => "tasks",
            Self::Audit => "audit",
            Self::Broadcast => "broadcast",
        }
    }
}

/// Where loading a list stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Nothing requested yet (or the data is stale and reloads when the tab opens).
    Idle,
    /// The first page is loading.
    Loading,
    /// Rows are shown (possibly none).
    Ready,
    /// The first page failed; show the translated message of this kind and a retry.
    Failed(ErrorKind),
}

/// One paged list (the overview is a section whose single row is the counters).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Section<T> {
    /// Rows loaded so far.
    pub rows: Vec<T>,
    /// Loading phase.
    pub phase: Phase,
    /// A next page exists.
    pub has_more: bool,
    /// A further page is loading.
    pub loading_more: bool,
    /// A later page failed; `Cancelled` is never stored.
    pub page_error: Option<ErrorKind>,
    /// Epoch, page load in flight and next token (echoed back exactly); `has_more` and
    /// `loading_more` are copied from it on every publish.
    pub(crate) cursor: PageCursor,
}

impl<T> Section<T> {
    /// Copies the cursor's flags into the published fields.
    pub(crate) fn sync(&mut self) {
        self.has_more = self.cursor.has_more();
        self.loading_more = self.cursor.loading_more();
    }

    /// An empty section whose cursor makes every answer still in flight stale.
    pub(crate) fn cleared(&self) -> Self {
        let mut cursor = self.cursor.clone();
        cursor.reset();
        Self {
            cursor,
            ..Self::default()
        }
    }
}

impl<T> Default for Section<T> {
    fn default() -> Self {
        Self {
            rows: Vec::new(),
            phase: Phase::Idle,
            has_more: false,
            loading_more: false,
            page_error: None,
            cursor: PageCursor::default(),
        }
    }
}

/// The two-step delete: nothing is sent before `Confirming` was reached and a reason was given.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeleteState {
    /// No delete in progress.
    Idle,
    /// Step one done: waiting for the reason and the confirmation.
    Confirming {
        /// Task to delete.
        id: String,
        /// Its title, for the confirmation text.
        title: String,
    },
    /// The reason was refused before any request.
    Invalid {
        /// Task to delete.
        id: String,
        /// Its title.
        title: String,
        /// Why.
        error: ValidationError,
    },
    /// The request is in flight.
    Deleting {
        /// Task being deleted.
        id: String,
        /// Its title.
        title: String,
    },
    /// The server refused or failed; the confirmation stays open for a retry.
    Failed {
        /// Task to delete.
        id: String,
        /// Its title.
        title: String,
        /// Why.
        kind: ErrorKind,
    },
}

impl DeleteState {
    /// The task the confirmation is about.
    #[must_use]
    pub fn target(&self) -> Option<(&str, &str)> {
        match self {
            Self::Idle => None,
            Self::Confirming { id, title }
            | Self::Invalid { id, title, .. }
            | Self::Deleting { id, title }
            | Self::Failed { id, title, .. } => Some((id, title)),
        }
    }
}

/// The broadcast form after the last submit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BroadcastStatus {
    /// Nothing submitted.
    Idle,
    /// A request is in flight.
    Sending,
    /// Refused before any request.
    Invalid(ValidationError),
    /// The server refused or failed.
    Failed(ErrorKind),
    /// Delivered to this many recipients.
    Sent {
        /// Recipients reported by the server.
        recipients: u64,
    },
}

/// Everything the screen needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdminView {
    /// Selected tab.
    pub tab: Tab,
    /// The user is not an operator: nothing was loaded and the screen says so.
    pub no_access: bool,
    /// Counters (at most one row).
    pub overview: Section<Overview>,
    /// Tasks of any user.
    pub tasks: Section<AdminTask>,
    /// Audit log.
    pub audit: Section<AuditEntry>,
    /// The owner filter currently applied to the tasks (empty: everyone).
    pub owner_filter: String,
    /// The text typed into the owner filter is not a UUID.
    pub filter_invalid: bool,
    /// The delete confirmation.
    pub delete: DeleteState,
    /// The broadcast form.
    pub broadcast: BroadcastStatus,
}

impl Default for AdminView {
    fn default() -> Self {
        Self {
            tab: Tab::Overview,
            no_access: false,
            overview: Section::default(),
            tasks: Section::default(),
            audit: Section::default(),
            owner_filter: String::new(),
            filter_invalid: false,
            delete: DeleteState::Idle,
            broadcast: BroadcastStatus::Idle,
        }
    }
}
