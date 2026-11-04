//! The search view model: owns the state, debounces typing, calls the use cases and publishes a
//! [`SearchView`].
//!
//! No UI types: the Slint glue subscribes to [`SearchController::subscribe`]. Three epochs guard
//! against out-of-order answers: typing (debounce), searching and suggesting. A response that
//! belongs to an older epoch is dropped, and `Cancelled` never shows an error.

use std::{
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};

use aedst_common::ErrorKind;
use tokio::sync::watch;

use super::search_state::{HitRow, Phase, SearchView};
use crate::domain::{LinkNavigator, SearchService, normalize_query};

/// How long typing must pause before a request is sent.
pub const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Default)]
struct Inner {
    view: SearchView,
    /// The text box content as typed.
    raw: String,
    /// The normalised query of the last search; `load_more` continues it.
    active: String,
    next_token: Option<String>,
    /// Bumped by every keystroke and submit; a pending debounce with an older value is dropped.
    typing_epoch: u64,
    /// Bumped by every first-page search and every clear.
    search_epoch: u64,
    /// Bumped like `search_epoch`, for the suggestions.
    suggest_epoch: u64,
}

impl Inner {
    /// Forgets everything: the query is empty, so nothing is shown and in-flight answers are stale.
    fn clear(&mut self) {
        self.view = SearchView::default();
        self.active.clear();
        self.next_token = None;
        self.search_epoch += 1;
        self.suggest_epoch += 1;
    }
}

/// Drives the search screen.
pub struct SearchController {
    service: Arc<SearchService>,
    navigator: Arc<dyn LinkNavigator>,
    inner: Mutex<Inner>,
    published: watch::Sender<SearchView>,
}

impl SearchController {
    /// A controller over the use cases and the router port.
    #[must_use]
    pub fn new(service: Arc<SearchService>, navigator: Arc<dyn LinkNavigator>) -> Arc<Self> {
        Arc::new(Self {
            service,
            navigator,
            inner: Mutex::new(Inner::default()),
            published: watch::channel(SearchView::default()).0,
        })
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<SearchView> {
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

    /// The text box changed. An empty query clears at once and makes no request; otherwise the
    /// search runs once typing has paused for [`DEBOUNCE`]. Must be called inside the runtime.
    pub fn set_query(self: &Arc<Self>, text: &str) {
        let scheduled = self.update(|i| {
            if i.raw == text {
                return None;
            }
            i.raw = text.to_owned();
            i.typing_epoch += 1;
            if normalize_query(text).is_empty() {
                i.clear();
                return None;
            }
            Some(i.typing_epoch)
        });
        let Some(epoch) = scheduled else { return };
        let me = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(DEBOUNCE).await;
            if me.update(|i| i.typing_epoch) == epoch {
                me.search_now().await;
            }
        });
    }

    /// Enter or "try again": searches the current text without waiting for a pause.
    pub async fn submit(&self) {
        self.search_now().await;
    }

    /// A suggestion was chosen: it becomes the query and is searched at once.
    pub async fn pick_suggestion(&self, suggestion: &str) {
        self.update(|i| {
            i.raw = suggestion.to_owned();
            i.typing_epoch += 1;
        });
        self.search_now().await;
    }

    async fn search_now(&self) {
        let started = self.update(|i| {
            i.typing_epoch += 1; // a pending debounce is now redundant
            let query = normalize_query(&i.raw);
            if query.is_empty() {
                return None;
            }
            i.search_epoch += 1;
            i.suggest_epoch += 1;
            i.active.clone_from(&query);
            i.view.phase = Phase::Loading;
            i.view.action_error = None;
            i.view.loading_more = false;
            Some((i.search_epoch, i.suggest_epoch, query))
        });
        let Some((search_epoch, suggest_epoch, query)) = started else {
            return;
        };
        futures::future::join(
            self.run_search(search_epoch, &query),
            self.run_suggest(suggest_epoch, &query),
        )
        .await;
    }

    async fn run_search(&self, epoch: u64, query: &str) {
        let result = self.service.search(query, None).await;
        self.update(|i| {
            if i.search_epoch != epoch {
                return; // a newer search started, or the query was cleared
            }
            match result {
                Ok(Some(page)) => {
                    i.view.hits = page.hits.iter().map(HitRow::from_hit).collect();
                    i.view.total_estimate = page.total_estimate;
                    i.view.has_more = page.next_page_token.is_some();
                    i.next_token = page.next_page_token;
                    i.view.phase = Phase::Ready;
                }
                Ok(None) => i.clear(),
                Err(ErrorKind::Cancelled) => i.view.phase = Phase::Idle,
                Err(kind) => {
                    i.view.hits.clear();
                    i.view.has_more = false;
                    i.next_token = None;
                    i.view.phase = Phase::Failed(kind);
                }
            }
        });
    }

    async fn run_suggest(&self, epoch: u64, query: &str) {
        let result = self.service.suggest(query).await;
        self.update(|i| {
            if i.suggest_epoch != epoch {
                return;
            }
            // Best effort: a failure keeps whatever is shown and says nothing.
            if let Ok(suggestions) = result {
                i.view.suggestions = suggestions;
            }
        });
    }

    /// Loads the next page of the current search, echoing the page token back.
    pub async fn load_more(&self) {
        let started = self.update(|i| {
            let token = i.next_token.clone()?;
            if i.view.loading_more || i.view.phase != Phase::Ready {
                return None;
            }
            i.view.loading_more = true;
            i.view.action_error = None;
            Some((i.search_epoch, i.active.clone(), token))
        });
        let Some((epoch, query, token)) = started else {
            return;
        };
        let result = self.service.search(&query, Some(&token)).await;
        self.update(|i| {
            if i.search_epoch != epoch {
                return;
            }
            i.view.loading_more = false;
            match result {
                Ok(Some(page)) => {
                    i.view.hits.extend(page.hits.iter().map(HitRow::from_hit));
                    i.view.has_more = page.next_page_token.is_some();
                    i.next_token = page.next_page_token;
                }
                Ok(None) | Err(ErrorKind::Cancelled) => {}
                Err(kind) => i.view.action_error = Some(kind),
            }
        });
    }

    /// Opens the hit at `index` through the router. Only relative in-app routes are passed on;
    /// anything else, and a route the router refuses, does nothing. True when it was opened.
    pub fn open_hit(&self, index: usize) -> bool {
        let link = {
            let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
            inner
                .view
                .hits
                .get(index)
                .filter(|h| h.openable)
                .map(|h| h.link.clone())
        };
        link.is_some_and(|link| self.navigator.open(&link))
    }
}
