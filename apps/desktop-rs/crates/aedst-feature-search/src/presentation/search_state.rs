//! What the search screen shows. Plain data, no UI types: the Slint glue copies it into the view.

use aedst_common::ErrorKind;

use crate::domain::{DocumentKind, SearchHit, SnippetSegment};

/// One result row.
#[derive(Clone, Debug, PartialEq)]
pub struct HitRow {
    /// Id in the owning module.
    pub id: String,
    /// Kind badge (`Unknown` renders a neutral badge).
    pub kind: DocumentKind,
    /// Title.
    pub title: String,
    /// Excerpt without highlight markers.
    pub snippet: String,
    /// The excerpt as plain and highlighted runs.
    pub segments: Vec<SnippetSegment>,
    /// In-app route.
    pub link: String,
    /// The link is a relative in-app route; any other link is never opened.
    pub openable: bool,
}

impl HitRow {
    /// A row for a hit.
    #[must_use]
    pub fn from_hit(hit: &SearchHit) -> Self {
        Self {
            id: hit.id.clone(),
            kind: hit.kind,
            title: hit.title.clone(),
            snippet: hit.plain_snippet(),
            segments: hit.segments(),
            link: hit.link.clone(),
            openable: hit.has_in_app_link(),
        }
    }
}

/// Where the search stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// No query: nothing requested, nothing shown.
    Idle,
    /// The first page is loading.
    Loading,
    /// Hits are shown (possibly none: the "no results" state).
    Ready,
    /// The first page failed; show the translated message of this kind and a retry.
    Failed(ErrorKind),
}

/// Everything the screen needs.
#[derive(Clone, Debug, PartialEq)]
pub struct SearchView {
    /// Loading phase.
    pub phase: Phase,
    /// Results, best first.
    pub hits: Vec<HitRow>,
    /// Suggestions for what is typed (best effort, failures stay silent).
    pub suggestions: Vec<String>,
    /// Approximate total from the first page.
    pub total_estimate: Option<u32>,
    /// A next page exists.
    pub has_more: bool,
    /// A further page is loading.
    pub loading_more: bool,
    /// A later page failed; `Cancelled` is never stored.
    pub action_error: Option<ErrorKind>,
}

impl Default for SearchView {
    fn default() -> Self {
        Self {
            phase: Phase::Idle,
            hits: Vec::new(),
            suggestions: Vec::new(),
            total_estimate: None,
            has_more: false,
            loading_more: false,
            action_error: None,
        }
    }
}
