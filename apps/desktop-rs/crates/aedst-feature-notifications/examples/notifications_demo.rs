//! Runs the Notifications views against an in-memory repository (no server):
//! `cargo run -p aedst-feature-notifications --example notifications_demo -- [--lang ru|tg|uz|ar] [--dark] [--offline] [--empty] [--prefs]`.
//!
//! `--offline` makes every write fail as offline, so marking read and changing a switch roll back
//! and show the error. `--prefs` shows the preferences view instead of the inbox.
//! `--snapshot <file.png>` renders the window once, saves it and exits (for screenshots and docs).

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use aedst_common::ErrorKind;
use aedst_feature_notifications::{
    domain::{
        LinkNavigator, Notification, NotificationKind, NotificationPage, NotificationQuery,
        NotificationsRepository, NotificationsService, Preferences,
    },
    presentation::{InboxController, PreferencesController, UnreadCounter},
    ui_glue::{Controllers, NotificationsDemoWindow, bind, language_is_rtl, select_language},
};
use futures::future::BoxFuture;
use slint::ComponentHandle;

struct Memory {
    items: Mutex<Vec<Notification>>,
    prefs: Mutex<Preferences>,
    offline: bool,
}

impl NotificationsRepository for Memory {
    fn list<'a>(
        &'a self,
        query: &'a NotificationQuery,
    ) -> BoxFuture<'a, Result<NotificationPage, ErrorKind>> {
        Box::pin(async move {
            let items = self.items.lock().map_err(|_| ErrorKind::Unknown)?;
            Ok(NotificationPage {
                notifications: items
                    .iter()
                    .filter(|n| !query.unread_only || !n.read)
                    .cloned()
                    .collect(),
                next_page_token: None,
            })
        })
    }

    fn unread_count(&self) -> BoxFuture<'_, Result<u32, ErrorKind>> {
        Box::pin(async move {
            let items = self.items.lock().map_err(|_| ErrorKind::Unknown)?;
            Ok(u32::try_from(items.iter().filter(|n| !n.read).count()).unwrap_or(u32::MAX))
        })
    }

    fn mark_read<'a>(
        &'a self,
        ids: &'a [String],
        _: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            let mut items = self.items.lock().map_err(|_| ErrorKind::Unknown)?;
            for item in items.iter_mut().filter(|n| ids.contains(&n.id)) {
                item.read = true;
            }
            Ok(())
        })
    }

    fn mark_all_read<'a>(&'a self, _: &'a str) -> BoxFuture<'a, Result<u32, ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            let mut items = self.items.lock().map_err(|_| ErrorKind::Unknown)?;
            let unread = items.iter().filter(|n| !n.read).count();
            items.iter_mut().for_each(|n| n.read = true);
            Ok(u32::try_from(unread).unwrap_or(u32::MAX))
        })
    }

    fn get_preferences(&self) -> BoxFuture<'_, Result<Preferences, ErrorKind>> {
        Box::pin(async move { Ok(*self.prefs.lock().map_err(|_| ErrorKind::Unknown)?) })
    }

    fn update_preferences<'a>(
        &'a self,
        preferences: &'a Preferences,
        _: &'a str,
    ) -> BoxFuture<'a, Result<Preferences, ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            *self.prefs.lock().map_err(|_| ErrorKind::Unknown)? = *preferences;
            Ok(*preferences)
        })
    }
}

struct Nowhere;

impl LinkNavigator for Nowhere {
    fn open(&self, _: &str) -> bool {
        true
    }
}

fn sample() -> Vec<Notification> {
    let rows = [
        (
            NotificationKind::TaskDueSoon,
            "Renew the passport is due tomorrow",
            "Due 2026-11-02. Open the task to review it.",
            false,
        ),
        (
            NotificationKind::MediaReady,
            "Your upload is ready",
            "passport-scan.jpg finished processing.",
            false,
        ),
        (
            NotificationKind::TaskCompleted,
            "Call the bank was completed",
            "Completed from another device.",
            true,
        ),
        (
            NotificationKind::System,
            "Scheduled maintenance",
            "The service will be briefly unavailable on Sunday night.",
            true,
        ),
    ];
    rows.iter()
        .enumerate()
        .map(|(i, (kind, title, body, read))| Notification {
            id: format!("00000000-0000-4000-8000-00000000000{i}"),
            kind: *kind,
            title: (*title).to_owned(),
            body: (*body).to_owned(),
            link: format!("/tasks/{i}"),
            subject_id: String::new(),
            created_at: 1_793_525_400 - i64::try_from(i).unwrap_or(0) * 5_400,
            read: *read,
        })
        .collect()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let lang = args
        .iter()
        .position(|a| a == "--lang")
        .and_then(|i| args.get(i + 1))
        .map_or("en", String::as_str);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let repository = Arc::new(Memory {
        items: Mutex::new(if flag("--empty") {
            Vec::new()
        } else {
            sample()
        }),
        prefs: Mutex::new(Preferences {
            push_enabled: true,
            task_completed: true,
            task_due_soon: true,
            media_ready: false,
        }),
        offline: flag("--offline"),
    });
    let keys = AtomicUsize::new(0);
    let service = Arc::new(NotificationsService::new(
        repository,
        Arc::new(Nowhere),
        move || format!("demo-{}", keys.fetch_add(1, Ordering::SeqCst)),
    ));
    let unread = UnreadCounter::new(Arc::clone(&service));
    let controllers = Controllers {
        inbox: InboxController::new(Arc::clone(&service), Arc::clone(&unread)),
        preferences: PreferencesController::new(service),
        unread,
    };

    let ui = NotificationsDemoWindow::new()?;
    select_language(lang)?;
    ui.set_rtl(language_is_rtl(lang));
    ui.set_dark(flag("--dark"));
    if flag("--prefs") {
        ui.set_screen("preferences".into());
    }
    bind(&ui, &controllers, runtime.handle());
    runtime.spawn({
        let (inbox, preferences, unread) = (
            Arc::clone(&controllers.inbox),
            Arc::clone(&controllers.preferences),
            Arc::clone(&controllers.unread),
        );
        async move {
            let _ = unread.refresh().await;
            preferences.load().await;
            inbox.load_first().await;
        }
    });
    if let Some(path) = args
        .iter()
        .position(|a| a == "--snapshot")
        .and_then(|i| args.get(i + 1))
        .cloned()
    {
        let weak = ui.as_weak();
        slint::Timer::single_shot(Duration::from_millis(2500), move || {
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
