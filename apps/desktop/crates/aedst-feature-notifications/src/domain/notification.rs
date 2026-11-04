//! The Notifications model. Pure: no I/O, no UI, no wire types.
//!
//! Unknown enum policy: a kind this build does not know is `Unknown`, never `System`. The UI shows
//! a neutral badge. `match` over the enum is exhaustive, with no `_` arm.

/// What a notification is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationKind {
    /// A task was completed.
    TaskCompleted,
    /// A task is due soon.
    TaskDueSoon,
    /// Media finished processing.
    MediaReady,
    /// An operator message.
    System,
    /// A value this build does not know.
    Unknown,
}

impl NotificationKind {
    /// Stable key for the UI and tests.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::TaskCompleted => "task-completed",
            Self::TaskDueSoon => "task-due-soon",
            Self::MediaReady => "media-ready",
            Self::System => "system",
            Self::Unknown => "unknown",
        }
    }
}

/// One inbox entry. Times are Unix seconds (UTC).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notification {
    /// Server id (a UUID).
    pub id: String,
    /// What it is about.
    pub kind: NotificationKind,
    /// Headline.
    pub title: String,
    /// Detail text.
    pub body: String,
    /// In-app route to open on tap (relative, e.g. `/tasks/<id>`); empty when there is none.
    pub link: String,
    /// Id of the entity the notification is about.
    pub subject_id: String,
    /// When the server created it.
    pub created_at: i64,
    /// True once the user has read it.
    pub read: bool,
}

/// Page size the inbox asks for (the server default is also 20, clamp 100).
pub const PAGE_SIZE: u32 = 20;

/// `MarkRead` takes at most this many ids per call.
pub const MAX_MARK_IDS: usize = 100;

/// What the inbox asks for. The order is newest first, fixed by the server.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NotificationQuery {
    /// Only unread entries.
    pub unread_only: bool,
    /// Echo of the last response's token with the same filter; `None` for the first page.
    pub page_token: Option<String>,
}

/// One page of the inbox.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NotificationPage {
    /// The entries.
    pub notifications: Vec<Notification>,
    /// Token of the next page, `None` on the last one.
    pub next_page_token: Option<String>,
}

/// The four server-side delivery switches.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Preferences {
    /// Master switch: deliver to this user (on desktop: native notifications).
    pub push_enabled: bool,
    /// "Task completed" notifications.
    pub task_completed: bool,
    /// "Task due soon" notifications.
    pub task_due_soon: bool,
    /// "Media ready" notifications.
    pub media_ready: bool,
}

/// One of the four switches, addressed by the key the screen uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreferenceKey {
    /// [`Preferences::push_enabled`].
    PushEnabled,
    /// [`Preferences::task_completed`].
    TaskCompleted,
    /// [`Preferences::task_due_soon`].
    TaskDueSoon,
    /// [`Preferences::media_ready`].
    MediaReady,
}

impl PreferenceKey {
    /// Parses the screen's key; unknown keys are refused.
    #[must_use]
    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "push-enabled" => Some(Self::PushEnabled),
            "task-completed" => Some(Self::TaskCompleted),
            "task-due-soon" => Some(Self::TaskDueSoon),
            "media-ready" => Some(Self::MediaReady),
            _ => None,
        }
    }
}

impl Preferences {
    /// The current value of one switch.
    #[must_use]
    pub fn get(&self, key: PreferenceKey) -> bool {
        match key {
            PreferenceKey::PushEnabled => self.push_enabled,
            PreferenceKey::TaskCompleted => self.task_completed,
            PreferenceKey::TaskDueSoon => self.task_due_soon,
            PreferenceKey::MediaReady => self.media_ready,
        }
    }

    /// A copy with one switch changed.
    #[must_use]
    pub fn with(mut self, key: PreferenceKey, value: bool) -> Self {
        match key {
            PreferenceKey::PushEnabled => self.push_enabled = value,
            PreferenceKey::TaskCompleted => self.task_completed = value,
            PreferenceKey::TaskDueSoon => self.task_due_soon = value,
            PreferenceKey::MediaReady => self.media_ready = value,
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_switch_is_read_and_changed_by_key() {
        let prefs = Preferences::default().with(PreferenceKey::TaskDueSoon, true);
        assert!(prefs.get(PreferenceKey::TaskDueSoon));
        assert!(!prefs.get(PreferenceKey::MediaReady));
        assert_eq!(
            PreferenceKey::from_key("media-ready"),
            Some(PreferenceKey::MediaReady)
        );
        assert_eq!(PreferenceKey::from_key("nope"), None);
    }
}
