//! What the inbox shows. Plain data, no UI types: the Slint glue copies it into the view.

use aedst_common::ErrorKind;

use super::format::format_time;
use crate::domain::{Notification, NotificationKind};

/// One row of the inbox.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    /// Server id.
    pub id: String,
    /// Kind (`Unknown` renders a neutral badge).
    pub kind: NotificationKind,
    /// Headline.
    pub title: String,
    /// Detail text.
    pub body: String,
    /// In-app link; empty when the row opens nothing.
    pub link: String,
    /// `YYYY-MM-DD HH:MM` (UTC), empty when unset.
    pub created: String,
    /// Already read (shown calm); unread rows are emphasised.
    pub read: bool,
}

impl Row {
    /// A row for a notification.
    #[must_use]
    pub fn from_notification(item: &Notification) -> Self {
        Self {
            id: item.id.clone(),
            kind: item.kind,
            title: item.title.clone(),
            body: item.body.clone(),
            link: item.link.clone(),
            created: format_time(item.created_at),
            read: item.read,
        }
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

/// Everything the inbox needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InboxView {
    /// Rows, newest first.
    pub rows: Vec<Row>,
    /// Loading phase.
    pub phase: Phase,
    /// The "unread only" filter is on.
    pub unread_only: bool,
    /// A next page exists.
    pub has_more: bool,
    /// A further page is loading.
    pub loading_more: bool,
    /// "Mark all as read" is in flight.
    pub marking_all: bool,
    /// A mark operation or a later page failed; `Cancelled` is never stored.
    pub action_error: Option<ErrorKind>,
}

impl Default for InboxView {
    fn default() -> Self {
        Self {
            rows: Vec::new(),
            phase: Phase::Idle,
            unread_only: false,
            has_more: false,
            loading_more: false,
            marking_all: false,
            action_error: None,
        }
    }
}
