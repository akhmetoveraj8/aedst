//! The session scope: everything that belongs to ONE signed-in user.
//!
//! A scope owns the feature controllers (and therefore every list, inbox and view the user loaded)
//! and the background work of the session (queued-write delivery, the unread poller, the "waiting to
//! sync" counter). The shell keeps exactly one scope bound to the window: a fresh, empty one at start
//! and after every sign-out, started at sign-in. Ending a scope stops its work; dropping it frees the
//! user's data, so nothing of one account is shown to, or delivered for, the next one.

use std::sync::{
    Arc, Mutex, PoisonError,
    atomic::{AtomicBool, Ordering},
};

use aedst_feature_admin::presentation::{AdminController, Tab};
use aedst_feature_media::presentation::{LibraryController, ViewerController};
use aedst_feature_notifications::presentation::{
    InboxController, PreferencesController, UnreadCounter,
};
use aedst_feature_search::presentation::SearchController;
use aedst_feature_tasks::presentation::TaskListController;
use slint::ComponentHandle;
use tokio::{runtime::Handle, sync::watch, task::AbortHandle, time::sleep};
use tokio_util::sync::CancellationToken;

use crate::{
    generated::{AppWindow, SearchStore, TasksStore},
    glue,
    services::{FeatureDeps, OUTBOX_TICK, Services, new_key},
};

/// The controllers and background work of one session.
pub struct SessionScope {
    tasks: Arc<TaskListController>,
    search: Arc<SearchController>,
    inbox: Arc<InboxController>,
    preferences: Arc<PreferencesController>,
    unread: Arc<UnreadCounter>,
    media_library: Arc<LibraryController>,
    media_viewer: Arc<ViewerController>,
    admin: Arc<AdminController>,
    started: AtomicBool,
    stop: CancellationToken,
    /// The glue's forwarding tasks (controller -> window); aborted when the scope ends, so an old
    /// controller can never write into the window after the next scope is bound.
    forwarders: Mutex<Vec<AbortHandle>>,
}

impl SessionScope {
    /// Fresh, empty controllers over the app's stateless services. Nothing runs until [`Self::start`].
    #[must_use]
    pub fn new(deps: &FeatureDeps) -> Arc<Self> {
        let unread = UnreadCounter::new(Arc::clone(&deps.notifications));
        Arc::new(Self {
            tasks: TaskListController::new(Arc::clone(&deps.tasks)),
            search: SearchController::new(Arc::clone(&deps.search), deps.links.clone()),
            inbox: InboxController::new(Arc::clone(&deps.notifications), Arc::clone(&unread)),
            preferences: PreferencesController::new(Arc::clone(&deps.notifications)),
            unread,
            media_library: LibraryController::new(
                Arc::clone(&deps.media),
                Arc::clone(&deps.uploads),
                Arc::clone(&deps.picker),
            ),
            media_viewer: ViewerController::new(Arc::clone(&deps.images)),
            admin: AdminController::new(
                Arc::clone(&deps.admin),
                Arc::clone(&deps.admin_access),
                new_key,
            ),
            started: AtomicBool::new(false),
            stop: CancellationToken::new(),
            forwarders: Mutex::new(Vec::new()),
        })
    }

    /// Binds every feature screen to this scope's controllers. Runs on the UI thread. The previous
    /// scope's callbacks are replaced, so its controllers are dropped with it; text the user typed
    /// into a screen (which no controller owns) is cleared.
    pub fn bind(&self, ui: &AppWindow, runtime: &Handle) {
        ui.global::<SearchStore>().set_query("".into());
        ui.global::<TasksStore>().set_priority("medium".into());
        let notifications = glue::notifications::Controllers {
            inbox: Arc::clone(&self.inbox),
            preferences: Arc::clone(&self.preferences),
            unread: Arc::clone(&self.unread),
        };
        let mut handles = glue::tasks::bind(ui, &self.tasks, runtime);
        handles.extend(glue::search::bind(ui, &self.search, runtime));
        handles.extend(glue::notifications::bind(ui, &notifications, runtime));
        handles.extend(glue::media::bind(
            ui,
            &self.media_library,
            &self.media_viewer,
            runtime,
        ));
        handles.extend(glue::admin::bind(ui, &self.admin, runtime));
        if self.stop.is_cancelled() {
            // Ended before the window got to bind it (two sign-outs in a row).
            handles.iter().for_each(AbortHandle::abort);
            return;
        }
        self.forwarders
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend(handles);
    }

    /// The unread count, for the sidebar badge.
    #[must_use]
    pub fn unread(&self) -> watch::Receiver<u32> {
        self.unread.subscribe()
    }

    /// Loads what a feature shows when its section is opened (`id` from `features::FEATURES`).
    pub async fn open(&self, id: &str) {
        match id {
            "tasks" => self.tasks.load_first().await,
            "notifications" => {
                self.inbox.load_first().await;
                self.preferences.load().await;
            }
            "media" => self.media_library.load_first().await,
            "admin" => self.admin.open_tab(Tab::Overview).await,
            // Search loads when the user types; there is nothing to fetch on open.
            _ => {}
        }
    }

    /// Starts the session's background work; it runs until [`Self::end`] (or the scope is dropped).
    /// Calling it again (a second sign-in path racing the first) does nothing.
    pub fn start(&self, app: &Services, foreground: watch::Receiver<bool>, runtime: &Handle) {
        if self.started.swap(true, Ordering::SeqCst) || self.stop.is_cancelled() {
            return;
        }
        let stop = &self.stop;
        let outbox = &app.outbox;

        // Deliver queued writes now, whenever one is queued, when the server is reachable again,
        // and on a slow tick as a safety net.
        outbox.trigger();
        spawn_until(runtime, stop, Arc::clone(outbox).trigger_on_enqueue());
        let (tick, mut online) = (Arc::clone(outbox), app.connectivity.subscribe());
        spawn_until(runtime, stop, async move {
            loop {
                tokio::select! {
                    () = sleep(OUTBOX_TICK) => tick.trigger(),
                    changed = online.changed() => {
                        if changed.is_err() {
                            return;
                        }
                        if *online.borrow_and_update() {
                            tick.trigger();
                        }
                    }
                }
            }
        });

        // "Waiting to sync": the queue's pending count into the Tasks banner.
        let (queue, tasks, mut pending) = (
            app.outbox_queue.clone(),
            Arc::clone(&self.tasks),
            outbox.subscribe_pending(),
        );
        spawn_until(runtime, stop, async move {
            if let Err(error) = queue.refresh_pending().await {
                tracing::warn!(%error, "could not count the queued writes");
            }
            loop {
                let count = *pending.borrow_and_update();
                tasks.set_pending_count(count);
                if pending.changed().await.is_err() {
                    return;
                }
            }
        });

        // The unread badge, polled only while the window is visible.
        let unread = Arc::clone(&self.unread);
        spawn_until(runtime, stop, async move { unread.run(foreground).await });
    }

    /// Stops the session's background work and its forwarding into the window. In-flight requests
    /// finish but publish into controllers nobody shows any more.
    pub fn end(&self) {
        self.stop.cancel();
        for handle in self
            .forwarders
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
        {
            handle.abort();
        }
    }
}

impl Drop for SessionScope {
    fn drop(&mut self) {
        self.end();
    }
}

/// Runs `work` on `runtime` until `stop` is cancelled.
fn spawn_until<F>(runtime: &Handle, stop: &CancellationToken, work: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    let stop = stop.clone();
    runtime.spawn(async move {
        tokio::select! {
            () = stop.cancelled() => {}
            () = work => {}
        }
    });
}
