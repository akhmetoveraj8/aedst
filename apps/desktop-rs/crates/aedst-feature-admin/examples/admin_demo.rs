//! Runs the Admin screen against an in-memory repository (no server):
//! `cargo run -p aedst-feature-admin --example admin_demo -- [--lang ru|tg|uz|ar] [--dark] [--no-access]
//! [--offline] [--empty] [--tab overview|tasks|audit|broadcast]`.
//!
//! `--no-access` shows the refused state of a user without the admin role; `--offline` makes every
//! call fail as offline. `--snapshot <file.png>` renders the window once, saves it and exits.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use aedst_common::ErrorKind;
use aedst_feature_admin::{
    domain::{
        AdminRepository, AdminTask, AuditEntry, BroadcastDraft, Overview, Page, PageRequest,
        StaticAccess, TaskStatus,
    },
    presentation::{AdminController, Tab},
    ui_glue::{AdminDemoWindow, bind, language_is_rtl, select_language},
};
use futures::future::BoxFuture;
use slint::ComponentHandle;

struct Memory {
    tasks: Mutex<Vec<AdminTask>>,
    audit: Mutex<Vec<AuditEntry>>,
    offline: bool,
}

const OWNER: &str = "00000000-0000-4000-8000-000000000001";

impl Memory {
    fn sample(empty: bool, offline: bool) -> Self {
        if empty {
            return Self {
                tasks: Mutex::new(Vec::new()),
                audit: Mutex::new(Vec::new()),
                offline,
            };
        }
        let titles = [
            ("Prepare the quarterly report", TaskStatus::InProgress),
            ("Buy milk and bread", TaskStatus::Todo),
            ("Call the bank", TaskStatus::Done),
            ("Renew the passport", TaskStatus::Todo),
        ];
        Self {
            tasks: Mutex::new(
                titles
                    .iter()
                    .enumerate()
                    .map(|(i, (title, status))| AdminTask {
                        id: format!("00000000-0000-4000-8000-00000000020{i}"),
                        owner_id: OWNER.to_owned(),
                        title: (*title).to_owned(),
                        status: *status,
                        created_at: 1_761_000_000 + i64::try_from(i).unwrap_or(0) * 3600,
                        due_date: None,
                    })
                    .collect(),
            ),
            audit: Mutex::new(vec![AuditEntry {
                id: "e1".into(),
                actor_id: OWNER.into(),
                action: "task.delete".into(),
                target_kind: "task".into(),
                target_id: "00000000-0000-4000-8000-000000000209".into(),
                reason: "Duplicate of another task".into(),
                created_at: 1_761_500_000,
            }]),
            offline,
        }
    }

    fn check(&self) -> Result<(), ErrorKind> {
        if self.offline {
            Err(ErrorKind::Offline)
        } else {
            Ok(())
        }
    }
}

fn only<T: Clone>(items: &Mutex<Vec<T>>) -> Result<Page<T>, ErrorKind> {
    let items = items.lock().map_err(|_| ErrorKind::Unknown)?.clone();
    Ok(Page {
        items,
        next_page_token: None,
    })
}

impl AdminRepository for Memory {
    fn overview(&self) -> BoxFuture<'_, Result<Overview, ErrorKind>> {
        Box::pin(async move {
            self.check()?;
            Ok(Overview {
                tasks_total: 1234,
                tasks_done: 456,
                tasks_overdue: 12,
                media_total: 89,
                media_bytes: 345_678_901,
                push_devices: 7,
                job_lag_seconds: 3,
                jobs_pending: 2,
            })
        })
    }

    fn list_tasks<'a>(
        &'a self,
        _: Option<&'a str>,
        _: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AdminTask>, ErrorKind>> {
        Box::pin(async move {
            self.check()?;
            only(&self.tasks)
        })
    }

    fn delete_task<'a>(
        &'a self,
        id: &'a str,
        reason: &'a str,
        _: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            self.check()?;
            self.tasks
                .lock()
                .map_err(|_| ErrorKind::Unknown)?
                .retain(|t| t.id != id);
            self.audit.lock().map_err(|_| ErrorKind::Unknown)?.insert(
                0,
                AuditEntry {
                    id: format!("e-{id}"),
                    actor_id: OWNER.into(),
                    action: "task.delete".into(),
                    target_kind: "task".into(),
                    target_id: id.to_owned(),
                    reason: reason.to_owned(),
                    created_at: 1_761_600_000,
                },
            );
            Ok(())
        })
    }

    fn broadcast<'a>(
        &'a self,
        draft: &'a BroadcastDraft,
        _: &'a str,
    ) -> BoxFuture<'a, Result<u64, ErrorKind>> {
        Box::pin(async move {
            self.check()?;
            Ok(if draft.user_id.is_some() { 1 } else { 3 })
        })
    }

    fn list_audit_log<'a>(
        &'a self,
        _: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AuditEntry>, ErrorKind>> {
        Box::pin(async move {
            self.check()?;
            only(&self.audit)
        })
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let option = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let lang = option("--lang").unwrap_or_else(|| "en".to_owned());
    let tab = option("--tab")
        .and_then(|k| Tab::from_key(&k))
        .unwrap_or(Tab::Overview);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let counter = AtomicUsize::new(0);
    let controller = AdminController::new(
        Arc::new(Memory::sample(flag("--empty"), flag("--offline"))),
        Arc::new(StaticAccess(!flag("--no-access"))),
        move || format!("demo-{}", counter.fetch_add(1, Ordering::SeqCst)),
    );

    let ui = AdminDemoWindow::new()?;
    select_language(&lang)?;
    ui.set_rtl(language_is_rtl(&lang));
    ui.set_dark(flag("--dark"));
    bind(&ui, &controller, runtime.handle());
    runtime.spawn({
        let controller = Arc::clone(&controller);
        async move {
            controller.open_tab(tab).await;
            if tab == Tab::Tasks && std::env::args().any(|a| a == "--confirm") {
                controller
                    .request_delete("00000000-0000-4000-8000-000000000201")
                    .await;
            }
        }
    });
    if let Some(path) = option("--snapshot") {
        let weak = ui.as_weak();
        slint::Timer::single_shot(std::time::Duration::from_millis(2500), move || {
            if let Some(ui) = weak.upgrade()
                && let Ok(buffer) = ui.window().take_snapshot()
            {
                let _ = image::save_buffer(
                    &path,
                    buffer.as_bytes(),
                    buffer.width(),
                    buffer.height(),
                    image::ColorType::Rgba8,
                );
            }
            let _ = slint::quit_event_loop();
        });
    }
    ui.run()?;
    Ok(())
}
