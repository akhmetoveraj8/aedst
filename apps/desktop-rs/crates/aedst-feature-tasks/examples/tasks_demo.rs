//! Runs the Tasks screen against an in-memory repository (no server):
//! `cargo run -p aedst-feature-tasks --example tasks_demo -- [--lang ru|tg|uz|ar] [--dark] [--offline] [--empty]`.
//!
//! `--offline` makes every write fail as offline, so creates and toggles show the pending badge.
//! `--snapshot <file.png>` renders the window once, saves it and exits (for screenshots and docs).

use std::sync::{Arc, Mutex};

use aedst_common::ErrorKind;
use aedst_feature_tasks::{
    domain::{
        NewTask, NoAnalytics, PendingWrites, Task, TaskPage, TaskPriority, TaskQuery,
        TaskRepository, TaskService, TaskStatus,
    },
    presentation::TaskListController,
    ui_glue::{TasksDemoWindow, bind, language_is_rtl, select_language},
};
use futures::future::BoxFuture;
use slint::ComponentHandle;

struct Memory {
    tasks: Mutex<Vec<Task>>,
    offline: bool,
}

impl TaskRepository for Memory {
    fn list<'a>(&'a self, _: &'a TaskQuery) -> BoxFuture<'a, Result<TaskPage, ErrorKind>> {
        Box::pin(async move {
            let tasks = self.tasks.lock().map_err(|_| ErrorKind::Unknown)?.clone();
            let total = u32::try_from(tasks.len()).ok();
            Ok(TaskPage {
                tasks,
                next_page_token: None,
                total_count: total,
            })
        })
    }

    fn create<'a>(
        &'a self,
        new: &'a NewTask,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            let task = Task {
                id: key.to_owned(),
                title: new.title.clone(),
                description: new.description.clone(),
                status: TaskStatus::Todo,
                priority: new.priority,
                due_date: None,
                created_at: 0,
                version: 1,
            };
            self.tasks
                .lock()
                .map_err(|_| ErrorKind::Unknown)?
                .insert(0, task.clone());
            Ok(task)
        })
    }

    fn set_done<'a>(
        &'a self,
        id: &'a str,
        done: bool,
        _: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            let mut tasks = self.tasks.lock().map_err(|_| ErrorKind::Unknown)?;
            let task = tasks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or(ErrorKind::NotFound)?;
            task.status = if done {
                TaskStatus::Done
            } else {
                TaskStatus::Todo
            };
            Ok(task.clone())
        })
    }
}

struct Nowhere;

impl PendingWrites for Nowhere {
    fn enqueue_create<'a>(
        &'a self,
        _: &'a str,
        _: &'a NewTask,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async { Ok(()) })
    }
    fn enqueue_set_done<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: bool,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async { Ok(()) })
    }
}

fn sample() -> Vec<Task> {
    let titles = [
        (
            "Prepare the quarterly report",
            TaskStatus::InProgress,
            TaskPriority::High,
        ),
        ("Buy milk and bread", TaskStatus::Todo, TaskPriority::Low),
        ("Call the bank", TaskStatus::Done, TaskPriority::Medium),
        ("Renew the passport", TaskStatus::Todo, TaskPriority::Urgent),
    ];
    titles
        .iter()
        .enumerate()
        .map(|(i, (title, status, priority))| Task {
            id: format!("00000000-0000-4000-8000-00000000000{i}"),
            title: (*title).to_owned(),
            description: String::new(),
            status: *status,
            priority: *priority,
            due_date: None,
            created_at: 0,
            version: 1,
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
        tasks: Mutex::new(if flag("--empty") {
            Vec::new()
        } else {
            sample()
        }),
        offline: flag("--offline"),
    });
    let counter = std::sync::atomic::AtomicUsize::new(0);
    let service = Arc::new(TaskService::new(
        repository,
        Arc::new(Nowhere),
        Arc::new(NoAnalytics),
        move || {
            format!(
                "demo-{}",
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            )
        },
    ));
    let controller = TaskListController::new(service);

    let ui = TasksDemoWindow::new()?;
    select_language(lang)?;
    ui.set_rtl(language_is_rtl(lang));
    ui.set_dark(flag("--dark"));
    bind(&ui, &controller, runtime.handle());
    runtime.spawn({
        let controller = Arc::clone(&controller);
        async move { controller.load_first().await }
    });
    if let Some(path) = args
        .iter()
        .position(|a| a == "--snapshot")
        .and_then(|i| args.get(i + 1))
        .cloned()
    {
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
