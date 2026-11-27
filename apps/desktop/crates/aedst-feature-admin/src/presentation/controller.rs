//! The admin screen's view model: owns the state, calls the repository, publishes an [`AdminView`].
//!
//! No UI types: the Slint glue subscribes to [`AdminController::subscribe`]. Nothing is loaded
//! unless [`AdminAccess::is_admin`] says so (the server enforces the role anyway). A response that
//! belongs to an older load is discarded, and `Cancelled` never shows an error.

use std::sync::{Arc, Mutex, PoisonError};

use aedst_common::ErrorKind;
use futures::future::BoxFuture;
use tokio::sync::watch;

use super::state::{AdminView, Phase, Section, Tab};
use crate::domain::{
    AdminAccess, AdminRepository, Overview, Page, PageRequest, ValidationError, parse_owner_filter,
};

/// Makes the `Idempotency-Key` of a write.
pub type KeySource = Box<dyn Fn() -> String + Send + Sync>;

/// Drives the admin screen.
pub struct AdminController {
    pub(super) repo: Arc<dyn AdminRepository>,
    pub(super) access: Arc<dyn AdminAccess>,
    pub(super) new_key: KeySource,
    state: Mutex<AdminView>,
    published: watch::Sender<AdminView>,
}

impl AdminController {
    /// A controller over the repository; `access` is the client-side role gate.
    #[must_use]
    pub fn new(
        repo: Arc<dyn AdminRepository>,
        access: Arc<dyn AdminAccess>,
        new_key: impl Fn() -> String + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            repo,
            access,
            new_key: Box::new(new_key),
            state: Mutex::new(AdminView::default()),
            published: watch::channel(AdminView::default()).0,
        })
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<AdminView> {
        self.published.subscribe()
    }

    pub(super) fn update<T>(&self, work: impl FnOnce(&mut AdminView) -> T) -> T {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let result = work(&mut state);
        state.overview.sync();
        state.tasks.sync();
        state.audit.sync();
        let view = state.clone();
        drop(state);
        self.published.send_replace(view);
        result
    }

    /// Clears everything and shows "no access" (not an operator, or the server said `Forbidden`).
    /// The lists keep counting epochs, so an answer still in flight cannot fill them again.
    pub(super) fn deny(view: &mut AdminView) {
        *view = AdminView {
            tab: view.tab,
            no_access: true,
            overview: view.overview.cleared(),
            tasks: view.tasks.cleared(),
            audit: view.audit.cleared(),
            ..AdminView::default()
        };
    }

    /// The client-side role gate. False publishes the "no access" phase and loads nothing.
    pub(super) fn gate(&self) -> bool {
        let admin = self.access.is_admin();
        self.update(|v| {
            if admin {
                v.no_access = false;
            } else {
                Self::deny(v);
            }
        });
        admin
    }

    /// Selects a tab and loads its first page when it was never loaded (or went stale).
    pub async fn open_tab(&self, tab: Tab) {
        self.update(|v| v.tab = tab);
        if !self.gate() {
            return;
        }
        let idle = self.update(|v| match tab {
            Tab::Overview => v.overview.phase == Phase::Idle,
            Tab::Tasks => v.tasks.phase == Phase::Idle,
            Tab::Audit => v.audit.phase == Phase::Idle,
            Tab::Broadcast => false,
        });
        if idle {
            self.load_first(tab).await;
        }
    }

    /// Reloads the selected tab from the first page.
    pub async fn reload(&self) {
        let tab = self.update(|v| v.tab);
        self.load_first(tab).await;
    }

    /// Loads the next page of the selected tab, if there is one and none is loading.
    pub async fn load_more(&self) {
        match self.update(|v| v.tab) {
            Tab::Tasks => self.run_tasks(false).await,
            Tab::Audit => self.run_audit(false).await,
            Tab::Overview | Tab::Broadcast => {}
        }
    }

    async fn load_first(&self, tab: Tab) {
        match tab {
            Tab::Overview => self.run_overview().await,
            Tab::Tasks => self.run_tasks(true).await,
            Tab::Audit => self.run_audit(true).await,
            Tab::Broadcast => {}
        }
    }

    /// Applies an owner filter to the tasks tab (empty: everyone). A text that is not a UUID is
    /// refused without a request.
    pub async fn set_owner_filter(&self, text: &str) {
        match parse_owner_filter(text) {
            Err(ValidationError::IdInvalid) => self.update(|v| v.filter_invalid = true),
            Err(_) => {}
            Ok(owner) => {
                self.update(|v| {
                    v.owner_filter = owner.unwrap_or_default();
                    v.filter_invalid = false;
                });
                self.run_tasks(true).await;
            }
        }
    }

    async fn run_overview(&self) {
        let repo = Arc::clone(&self.repo);
        self.run_list(
            |v| &mut v.overview,
            true,
            move |_| {
                let repo = Arc::clone(&repo);
                Box::pin(async move { repo.overview().await.map(single) })
            },
        )
        .await;
    }

    async fn run_tasks(&self, first: bool) {
        let owner = Some(self.update(|v| v.owner_filter.clone())).filter(|o| !o.is_empty());
        let repo = Arc::clone(&self.repo);
        self.run_list(
            |v| &mut v.tasks,
            first,
            move |p| {
                let (repo, owner) = (Arc::clone(&repo), owner.clone());
                Box::pin(async move { repo.list_tasks(owner.as_deref(), &p).await })
            },
        )
        .await;
    }

    async fn run_audit(&self, first: bool) {
        let repo = Arc::clone(&self.repo);
        self.run_list(
            |v| &mut v.audit,
            first,
            move |p| {
                let repo = Arc::clone(&repo);
                Box::pin(async move { repo.list_audit_log(&p).await })
            },
        )
        .await;
    }

    /// One load of one list: gate, mark loading, fetch, drop the result if a newer load started.
    async fn run_list<T, F>(
        &self,
        pick: fn(&mut AdminView) -> &mut Section<T>,
        first: bool,
        fetch: F,
    ) where
        F: Fn(PageRequest) -> BoxFuture<'static, Result<Page<T>, ErrorKind>>,
    {
        if !self.gate() {
            return;
        }
        let started = self.update(|v| {
            let s = pick(v);
            if first {
                s.phase = Phase::Loading;
                s.page_error = None;
                return Some((s.cursor.begin_first(), None));
            }
            if s.phase != Phase::Ready {
                return None;
            }
            let (epoch, token) = s.cursor.begin_more()?;
            Some((epoch, Some(token)))
        });
        let Some((epoch, page_token)) = started else {
            return;
        };
        let append = page_token.is_some();
        let result = fetch(PageRequest { page_token }).await;
        self.update(|v| {
            if !pick(v).cursor.is_current(epoch) {
                return; // a newer load started while this one was in flight
            }
            if result.as_ref().err() == Some(&ErrorKind::Forbidden) {
                return Self::deny(v);
            }
            let s = pick(v);
            match result {
                Ok(page) => {
                    if append {
                        s.cursor.finish_more(epoch, page.next_page_token);
                        s.rows.extend(page.items);
                    } else {
                        s.cursor.finish_first(epoch, page.next_page_token);
                        s.rows = page.items;
                    }
                    s.phase = Phase::Ready;
                }
                Err(ErrorKind::Cancelled) => {
                    if append {
                        s.cursor.fail_more(epoch);
                    } else {
                        s.phase = Phase::Idle;
                    }
                }
                Err(kind) if append => {
                    s.cursor.fail_more(epoch);
                    s.page_error = Some(kind);
                }
                Err(kind) => s.phase = Phase::Failed(kind),
            }
        });
    }
}

fn single(overview: Overview) -> Page<Overview> {
    Page {
        items: vec![overview],
        next_page_token: None,
    }
}
