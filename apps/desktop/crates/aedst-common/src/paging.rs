//! The paging state of one token-paged list, shared by every feature list.
//!
//! A list loads a first page, then further pages by the server's `next_page_token`. A reload can
//! start while a page is still in flight, so every load carries the epoch it started in and its
//! answer is applied only while that epoch is current. The invariants:
//!
//! - a new epoch ([`PageCursor::begin_first`]) always starts with no page load in flight, so a
//!   stale answer can never leave the "loading more" flag stuck;
//! - at most one page load runs per epoch ([`PageCursor::begin_more`] refuses a second one);
//! - a stale answer changes nothing (every `finish_*` / `fail_more` returns `false` for it).
//!
//! The token of the previous epoch is kept until the new first page answers, so a failed reload
//! leaves the cursor as it was (callers gate `begin_more` on their own "ready" phase).

/// Epoch, in-flight flag and next-page token of one paged list.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageCursor {
    epoch: u64,
    loading_more: bool,
    next_token: Option<String>,
}

impl PageCursor {
    /// Starts a (re)load of the first page and returns its epoch. Answers of every older load,
    /// first page or further page, are stale from now on.
    pub fn begin_first(&mut self) -> u64 {
        self.epoch = self.epoch.wrapping_add(1);
        self.loading_more = false;
        self.epoch
    }

    /// Forgets the list: every answer in flight is stale and there is no next page. The epoch keeps
    /// counting up (a fresh `PageCursor` would restart it and could match an old answer).
    pub fn reset(&mut self) {
        self.begin_first();
        self.next_token = None;
    }

    /// Starts loading the next page: its epoch and the token to send. `None` when there is no next
    /// page or one is already loading.
    #[must_use = "a started page load must be finished or failed"]
    pub fn begin_more(&mut self) -> Option<(u64, String)> {
        if self.loading_more {
            return None;
        }
        let token = self.next_token.clone()?;
        self.loading_more = true;
        Some((self.epoch, token))
    }

    /// Whether an answer of the load started in `epoch` still applies.
    #[must_use]
    pub fn is_current(&self, epoch: u64) -> bool {
        self.epoch == epoch
    }

    /// Records the first page's next token. `false` (and no change) when the answer is stale.
    pub fn finish_first(&mut self, epoch: u64, next: Option<String>) -> bool {
        if !self.is_current(epoch) {
            return false;
        }
        self.next_token = next;
        true
    }

    /// Records a further page's next token and ends the page load. `false` (and no change) when the
    /// answer is stale.
    pub fn finish_more(&mut self, epoch: u64, next: Option<String>) -> bool {
        if !self.is_current(epoch) {
            return false;
        }
        self.loading_more = false;
        self.next_token = next;
        true
    }

    /// Ends a failed page load; the token stays, so the same page can be asked for again. `false`
    /// (and no change) when the answer is stale.
    pub fn fail_more(&mut self, epoch: u64) -> bool {
        if !self.is_current(epoch) {
            return false;
        }
        self.loading_more = false;
        true
    }

    /// Whether the server announced another page.
    #[must_use]
    pub fn has_more(&self) -> bool {
        self.next_token.is_some()
    }

    /// Whether a further page is loading.
    #[must_use]
    pub fn loading_more(&self) -> bool {
        self.loading_more
    }

    /// The epoch of the latest first-page load.
    #[must_use]
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready(token: &str) -> PageCursor {
        let mut cursor = PageCursor::default();
        let epoch = cursor.begin_first();
        assert!(cursor.finish_first(epoch, Some(token.to_owned())));
        cursor
    }

    #[test]
    fn a_first_page_with_a_token_offers_the_next_page_once() {
        let mut cursor = ready("t2");
        assert!(cursor.has_more());
        let (epoch, token) = cursor.begin_more().expect("a next page");
        assert_eq!(token, "t2");
        assert!(cursor.loading_more());
        assert_eq!(cursor.begin_more(), None, "one page load at a time");
        assert!(cursor.finish_more(epoch, None));
        assert!(!cursor.loading_more());
        assert!(!cursor.has_more(), "no token ends paging");
        assert_eq!(cursor.begin_more(), None);
    }

    #[test]
    fn a_reload_during_a_page_load_never_leaves_the_flag_stuck() {
        let mut cursor = ready("t2");
        let (stale, _) = cursor.begin_more().expect("a next page");
        let fresh = cursor.begin_first();
        assert!(!cursor.loading_more(), "a new epoch has no page load in flight");
        assert!(!cursor.finish_more(stale, Some("old".into())), "stale answer");
        assert!(!cursor.fail_more(stale));
        assert!(cursor.finish_first(fresh, Some("t3".into())));
        let (epoch, token) = cursor.begin_more().expect("paging works again");
        assert_eq!((epoch, token.as_str()), (fresh, "t3"));
    }

    #[test]
    fn a_stale_first_page_changes_nothing() {
        let mut cursor = PageCursor::default();
        let old = cursor.begin_first();
        let new = cursor.begin_first();
        assert!(cursor.finish_first(new, Some("new".into())));
        assert!(!cursor.finish_first(old, None));
        assert!(cursor.has_more());
        assert!(!cursor.is_current(old));
        assert!(cursor.is_current(new));
        assert_eq!(cursor.epoch(), new);
    }

    #[test]
    fn a_failed_page_load_keeps_the_token_for_a_retry() {
        let mut cursor = ready("t2");
        let (epoch, _) = cursor.begin_more().expect("a next page");
        assert!(cursor.fail_more(epoch));
        assert!(!cursor.loading_more());
        assert_eq!(cursor.begin_more().map(|(_, t)| t).as_deref(), Some("t2"));
    }

    #[test]
    fn reset_forgets_the_token_and_makes_every_answer_stale() {
        let mut cursor = ready("t2");
        let (stale, _) = cursor.begin_more().expect("a next page");
        cursor.reset();
        assert!(!cursor.has_more());
        assert!(!cursor.loading_more());
        assert!(!cursor.is_current(stale));
        assert!(cursor.epoch() > stale, "the epoch never goes back");
    }

    #[test]
    fn a_reload_keeps_the_old_token_until_the_first_page_answers() {
        let mut cursor = ready("t2");
        cursor.begin_first();
        assert!(cursor.has_more(), "callers gate on their phase while loading");
    }
}
