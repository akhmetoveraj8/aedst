//! The Search model. Pure: no I/O, no UI, no wire types.
//!
//! Unknown enum policy: a document kind this build does not know is `Unknown`, never `Task`. The
//! UI shows a neutral badge for it.

/// What a hit points at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentKind {
    /// A task.
    Task,
    /// A media file.
    Media,
    /// A value this build does not know.
    Unknown,
}

impl DocumentKind {
    /// Stable key for the UI and tests.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Media => "media",
            Self::Unknown => "unknown",
        }
    }
}

/// The server wraps every matched term in U+E000 ... U+E001 (private use) so clients highlight
/// natively without parsing HTML.
pub const HIGHLIGHT_START: char = '\u{E000}';
/// See [`HIGHLIGHT_START`].
pub const HIGHLIGHT_END: char = '\u{E001}';

/// One run of snippet text; `highlighted` runs were wrapped in the markers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnippetSegment {
    /// The text without markers.
    pub text: String,
    /// True for a matched term.
    pub highlighted: bool,
}

/// One result. Times are Unix seconds (UTC).
#[derive(Clone, Debug, PartialEq)]
pub struct SearchHit {
    /// What the hit is.
    pub kind: DocumentKind,
    /// Id in the owning module.
    pub id: String,
    /// Title.
    pub title: String,
    /// Plain-text excerpt as the server sent it, with highlight markers.
    pub snippet: String,
    /// Relevance.
    pub score: f32,
    /// In-app route such as `/tasks/<id>`; opened through the [`super::LinkNavigator`].
    pub link: String,
    /// Last change in the owning module.
    pub updated_at: Option<i64>,
}

impl SearchHit {
    /// The snippet split into plain and highlighted runs. Tolerant, because server text is
    /// untrusted: a missing end marker highlights to the end, a stray end marker is dropped, a
    /// repeated start marker is ignored, empty runs are omitted and neighbours never share a
    /// `highlighted` value.
    #[must_use]
    pub fn segments(&self) -> Vec<SnippetSegment> {
        fn flush(out: &mut Vec<SnippetSegment>, run: &mut String, highlighted: bool) {
            if run.is_empty() {
                return;
            }
            let text = std::mem::take(run);
            match out.last_mut() {
                Some(last) if last.highlighted == highlighted => last.text.push_str(&text),
                _ => out.push(SnippetSegment { text, highlighted }),
            }
        }
        let mut out: Vec<SnippetSegment> = Vec::new();
        let mut highlighted = false;
        let mut run = String::new();
        for c in self.snippet.chars() {
            if c == HIGHLIGHT_START || c == HIGHLIGHT_END {
                flush(&mut out, &mut run, highlighted);
                highlighted = c == HIGHLIGHT_START;
            } else {
                run.push(c);
            }
        }
        flush(&mut out, &mut run, highlighted);
        out
    }

    /// The snippet without any marker.
    #[must_use]
    pub fn plain_snippet(&self) -> String {
        self.snippet
            .chars()
            .filter(|c| *c != HIGHLIGHT_START && *c != HIGHLIGHT_END)
            .collect()
    }

    /// True when `link` is a relative in-app route (`/x`, not `//host` and not `scheme:`). Absolute
    /// URLs are never opened by this feature.
    #[must_use]
    pub fn has_in_app_link(&self) -> bool {
        self.link.starts_with('/') && !self.link.starts_with("//") && !self.link.contains("://")
    }
}

/// One page of results.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SearchPage {
    /// The hits.
    pub hits: Vec<SearchHit>,
    /// Token of the next page, `None` on the last one.
    pub next_page_token: Option<String>,
    /// Approximate total; only the FIRST page carries it.
    pub total_estimate: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(snippet: &str, link: &str) -> SearchHit {
        SearchHit {
            kind: DocumentKind::Task,
            id: "1".into(),
            title: "t".into(),
            snippet: snippet.into(),
            score: 1.0,
            link: link.into(),
            updated_at: None,
        }
    }

    fn seg(text: &str, highlighted: bool) -> SnippetSegment {
        SnippetSegment {
            text: text.into(),
            highlighted,
        }
    }

    #[test]
    fn markers_split_the_snippet_into_runs() {
        let h = hit("buy \u{E000}milk\u{E001} now", "/tasks/1");
        assert_eq!(
            h.segments(),
            vec![seg("buy ", false), seg("milk", true), seg(" now", false)]
        );
        assert_eq!(h.plain_snippet(), "buy milk now");
    }

    #[test]
    fn broken_markers_are_tolerated() {
        assert_eq!(
            hit("a\u{E001}b\u{E000}c", "").segments(),
            vec![seg("ab", false), seg("c", true)]
        );
        assert!(hit("", "").segments().is_empty());
        assert_eq!(
            hit("\u{E000}\u{E000}x\u{E001}", "").segments(),
            vec![seg("x", true)]
        );
    }

    #[test]
    fn only_relative_routes_count_as_in_app_links() {
        assert!(hit("", "/tasks/1").has_in_app_link());
        assert!(!hit("", "https://evil.example/x").has_in_app_link());
        assert!(!hit("", "//evil.example/x").has_in_app_link());
        assert!(!hit("", "tasks/1").has_in_app_link());
        assert!(!hit("", "").has_in_app_link());
    }
}
