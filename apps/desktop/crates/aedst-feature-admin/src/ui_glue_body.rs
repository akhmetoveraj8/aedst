// The binding code of this feature, included twice: by `ui_glue.rs` in this crate (against its own
// generated types) and by the shell (`aedst-desktop`, against the types its single Slint compilation
// generates). `feature` names this crate in both places, so paths start with `feature`, never with
// the crate keyword, and the file holds no inner attributes or inner doc comments (`include!`).

use std::sync::Arc;

use aedst_common::ErrorKind;
use aedst_slint_model::apply_rows;
use slint::ComponentHandle;
use tokio::{runtime::Handle, task::AbortHandle};

use feature::{
    domain::Overview,
    presentation::{AdminController, AdminView, BroadcastStatus, DeleteState, Phase, Section, Tab},
};

/// Arabic is the only right-to-left locale; the shell sets `AedstLayout.rtl` from this.
#[must_use]
pub fn language_is_rtl(language: &str) -> bool {
    language == "ar"
}

/// Switches the bundled translation (`en`, `ru`, `tg`, `uz`, `ar`). Unknown codes fall back to English.
///
/// # Errors
/// The Slint error when the language is not bundled.
pub fn select_language(language: &str) -> Result<(), slint::SelectBundledTranslationError> {
    slint::select_bundled_translation(language)
}

/// `2026-11-01 09:30` in UTC (the operator compares times across time zones; 0 means unknown).
#[must_use]
pub fn format_time(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .filter(|_| seconds > 0)
        .map_or_else(String::new, |t| t.format("%Y-%m-%d %H:%M").to_string())
}

/// Bytes as `1.5 MB` (decimal units, one digit).
#[must_use]
pub fn format_bytes(bytes: i64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes.max(0) as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn overview_items(o: &Overview) -> Vec<OverviewItemData> {
    let item = |key: &str, value: String| OverviewItemData {
        key: key.into(),
        value: value.into(),
    };
    vec![
        item("tasks", o.tasks_total.to_string()),
        item("tasksDone", o.tasks_done.to_string()),
        item("tasksOverdue", o.tasks_overdue.to_string()),
        item("media", o.media_total.to_string()),
        item("mediaBytes", format_bytes(o.media_bytes)),
        item("pushDevices", o.push_devices.to_string()),
        item("jobLag", o.job_lag_seconds.to_string()),
        item("jobsPending", o.jobs_pending.to_string()),
    ]
}

fn admin_tab(tab: Tab) -> AdminTab {
    match tab {
        Tab::Overview => AdminTab::Overview,
        Tab::Tasks => AdminTab::Tasks,
        Tab::Audit => AdminTab::Audit,
        Tab::Broadcast => AdminTab::Broadcast,
    }
}

fn tab_of(tab: AdminTab) -> Tab {
    match tab {
        AdminTab::Overview => Tab::Overview,
        AdminTab::Tasks => Tab::Tasks,
        AdminTab::Audit => Tab::Audit,
        AdminTab::Broadcast => Tab::Broadcast,
    }
}

/// Phase and error text of one list: a failed first page, or a later page that failed.
fn list_status<T>(section: &Section<T>) -> (AdminPhase, String) {
    match section.phase {
        Phase::Idle => (AdminPhase::Idle, String::new()),
        Phase::Loading => (AdminPhase::Loading, String::new()),
        Phase::Ready => (
            AdminPhase::Ready,
            section
                .page_error
                .map(ErrorKind::name)
                .unwrap_or_default()
                .to_owned(),
        ),
        Phase::Failed(kind) => (AdminPhase::Failed, kind.name().to_owned()),
    }
}

/// Copies a published view into the store. Pure data in, UI properties out.
pub fn apply(store: &AdminStore<'_>, view: &AdminView) {
    store.set_tab(admin_tab(view.tab));
    store.set_no_access(view.no_access);
    let items = view
        .overview
        .rows
        .first()
        .map(overview_items)
        .unwrap_or_default();
    apply_rows(
        || store.get_overview_items(),
        |model| store.set_overview_items(model),
        items,
    );
    let tasks: Vec<AdminTaskRowData> = view
        .tasks
        .rows
        .iter()
        .map(|t| AdminTaskRowData {
            id: t.id.as_str().into(),
            title: t.title.as_str().into(),
            owner: t.owner_id.as_str().into(),
            status: t.status.key().into(),
            created: format_time(t.created_at).into(),
        })
        .collect();
    apply_rows(|| store.get_tasks(), |model| store.set_tasks(model), tasks);
    let audit: Vec<AuditRowData> = view
        .audit
        .rows
        .iter()
        .map(|e| AuditRowData {
            action: e.action.as_str().into(),
            target: format!("{} {}", e.target_kind, e.target_id).into(),
            reason: e.reason.as_str().into(),
            actor: e.actor_id.as_str().into(),
            created: format_time(e.created_at).into(),
        })
        .collect();
    apply_rows(|| store.get_audit(), |model| store.set_audit(model), audit);

    let ((phase, error), has_more, loading_more) = match view.tab {
        Tab::Overview => (list_status(&view.overview), false, false),
        Tab::Tasks => (
            list_status(&view.tasks),
            view.tasks.has_more,
            view.tasks.loading_more,
        ),
        Tab::Audit => (
            list_status(&view.audit),
            view.audit.has_more,
            view.audit.loading_more,
        ),
        Tab::Broadcast => ((AdminPhase::Ready, String::new()), false, false),
    };
    store.set_phase(phase);
    store.set_error_kind(error.into());
    store.set_has_more(has_more);
    store.set_loading_more(loading_more);
    store.set_filter_invalid(view.filter_invalid);

    let (state, error) = match &view.delete {
        DeleteState::Idle => (AdminDeleteState::Idle, String::new()),
        DeleteState::Confirming { .. } => (AdminDeleteState::Confirming, String::new()),
        DeleteState::Invalid { error, .. } => (AdminDeleteState::Invalid, error.key().to_owned()),
        DeleteState::Deleting { .. } => (AdminDeleteState::Deleting, String::new()),
        DeleteState::Failed { kind, .. } => (AdminDeleteState::Failed, kind.name().to_owned()),
    };
    store.set_delete_state(state);
    store.set_delete_error(error.into());
    store.set_delete_title(
        view.delete
            .target()
            .map(|(_, title)| title)
            .unwrap_or("")
            .into(),
    );

    let (state, error, recipients) = match view.broadcast {
        BroadcastStatus::Idle => (AdminBroadcastState::Idle, String::new(), 0),
        BroadcastStatus::Sending => (AdminBroadcastState::Sending, String::new(), 0),
        BroadcastStatus::Invalid(e) => (AdminBroadcastState::Invalid, e.key().to_owned(), 0),
        BroadcastStatus::Failed(kind) => (AdminBroadcastState::Failed, kind.name().to_owned(), 0),
        BroadcastStatus::Sent { recipients } => (
            AdminBroadcastState::Sent,
            String::new(),
            i32::try_from(recipients).unwrap_or(i32::MAX),
        ),
    };
    store.set_broadcast_state(state);
    store.set_broadcast_error(error.into());
    store.set_recipients(recipients);
}

/// Runs `work` against the controller on the runtime (callbacks come from the UI thread).
fn run<F, Fut>(controller: &Arc<AdminController>, runtime: &Handle, work: F)
where
    F: FnOnce(Arc<AdminController>) -> Fut,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    runtime.spawn(work(Arc::clone(controller)));
}

/// Connects the screen of `ui` to `controller`. Callbacks run on the UI thread and hand the work to
/// `runtime`; every published view is applied on the UI thread.
/// The returned handles stop the long-lived forwarding tasks; the owner aborts them when it
/// replaces these controllers (a sign-out), so an old controller can never write into the UI again.
pub fn bind<C>(ui: &C, controller: &Arc<AdminController>, runtime: &Handle) -> Vec<AbortHandle>
where
    C: ComponentHandle + 'static,
    for<'a> AdminStore<'a>: slint::Global<'a, C>,
{
    let store = ui.global::<AdminStore>();
    let (c, r) = (Arc::clone(controller), runtime.clone());
    store.on_select_tab(move |tab| {
        let tab = tab_of(tab);
        run(&c, &r, |c| async move { c.open_tab(tab).await });
    });
    let (c, r) = (Arc::clone(controller), runtime.clone());
    store.on_reload(move || run(&c, &r, |c| async move { c.reload().await }));
    let (c, r) = (Arc::clone(controller), runtime.clone());
    store.on_load_more(move || run(&c, &r, |c| async move { c.load_more().await }));
    let (c, r) = (Arc::clone(controller), runtime.clone());
    store.on_filter_owner(move |owner| {
        let owner = owner.to_string();
        run(&c, &r, |c| async move { c.set_owner_filter(&owner).await });
    });
    let (c, r) = (Arc::clone(controller), runtime.clone());
    store.on_request_delete(move |id| {
        let id = id.to_string();
        run(&c, &r, |c| async move { c.request_delete(&id).await });
    });
    let c = Arc::clone(controller);
    store.on_cancel_delete(move || c.cancel_delete());
    let (c, r) = (Arc::clone(controller), runtime.clone());
    store.on_confirm_delete(move |reason| {
        let reason = reason.to_string();
        run(&c, &r, |c| async move { c.confirm_delete(&reason).await });
    });
    let (c, r) = (Arc::clone(controller), runtime.clone());
    store.on_broadcast(move |user, title, body, link| {
        let (user, title, body, link) = (
            user.to_string(),
            title.to_string(),
            body.to_string(),
            link.to_string(),
        );
        run(&c, &r, |c| async move {
            c.broadcast(&user, &title, &body, &link).await;
        });
    });
    let c = Arc::clone(controller);
    store.on_broadcast_edited(move || c.clear_broadcast_status());

    let weak = ui.as_weak();
    let mut updates = controller.subscribe();
    let forwarder = runtime.spawn(async move {
        loop {
            let view = updates.borrow_and_update().clone();
            let shown =
                weak.upgrade_in_event_loop(move |ui| apply(&ui.global::<AdminStore>(), &view));
            if shown.is_err() || updates.changed().await.is_err() {
                break; // the window is gone, or the controller was dropped
            }
        }
    });
    vec![forwarder.abort_handle()]
}
