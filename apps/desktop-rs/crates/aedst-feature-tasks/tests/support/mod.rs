//! Test doubles for the Tasks ports.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report
#![allow(dead_code)] // each test file uses a different subset

use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use aedst_common::ErrorKind;
use aedst_feature_tasks::domain::{
    Analytics, NewTask, PendingWrites, Task, TaskPage, TaskPriority, TaskQuery, TaskRepository,
    TaskService, TaskStatus,
};
use futures::future::BoxFuture;
use tokio::sync::oneshot;

pub fn task(id: &str, title: &str, status: TaskStatus) -> Task {
    Task {
        id: id.into(),
        title: title.into(),
        description: String::new(),
        status,
        priority: TaskPriority::Medium,
        due_date: None,
        created_at: 0,
        version: 1,
    }
}

pub fn page(ids: &[&str], next: Option<&str>, total: Option<u32>) -> TaskPage {
    TaskPage {
        tasks: ids
            .iter()
            .map(|id| task(id, &format!("task {id}"), TaskStatus::Todo))
            .collect(),
        next_page_token: next.map(String::from),
        total_count: total,
    }
}

/// A scripted repository. Every write records the idempotency key it was sent with.
#[derive(Default)]
pub struct FakeRepo {
    pub pages: Mutex<VecDeque<Result<TaskPage, ErrorKind>>>,
    pub creates: Mutex<VecDeque<Result<Task, ErrorKind>>>,
    pub set_dones: Mutex<VecDeque<Result<Task, ErrorKind>>>,
    pub keys: Mutex<Vec<(String, String)>>,
    pub queries: Mutex<Vec<TaskQuery>>,
    /// When set, the next `list` call waits for this gate before answering.
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
}

impl TaskRepository for FakeRepo {
    fn list<'a>(&'a self, query: &'a TaskQuery) -> BoxFuture<'a, Result<TaskPage, ErrorKind>> {
        self.queries.lock().unwrap().push(query.clone());
        let gate = self.gate.lock().unwrap().take();
        let answer = self
            .pages
            .lock()
            .unwrap()
            .pop_front()
            .expect("scripted page");
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            answer
        })
    }

    fn create<'a>(
        &'a self,
        _: &'a NewTask,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>> {
        self.keys
            .lock()
            .unwrap()
            .push(("create".into(), key.into()));
        let answer = self
            .creates
            .lock()
            .unwrap()
            .pop_front()
            .expect("scripted create");
        Box::pin(async move { answer })
    }

    fn set_done<'a>(
        &'a self,
        id: &'a str,
        done: bool,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>> {
        self.keys
            .lock()
            .unwrap()
            .push((format!("set_done:{id}:{done}"), key.into()));
        let answer = self
            .set_dones
            .lock()
            .unwrap()
            .pop_front()
            .expect("scripted set_done");
        Box::pin(async move { answer })
    }
}

#[derive(Default)]
pub struct FakePending {
    pub creates: Mutex<Vec<String>>,
    pub updates: Mutex<Vec<(String, String, bool)>>,
    pub fail: bool,
}

impl PendingWrites for FakePending {
    fn enqueue_create<'a>(
        &'a self,
        key: &'a str,
        _: &'a NewTask,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        self.creates.lock().unwrap().push(key.into());
        let fail = self.fail;
        Box::pin(async move {
            if fail {
                Err(ErrorKind::Storage)
            } else {
                Ok(())
            }
        })
    }

    fn enqueue_set_done<'a>(
        &'a self,
        key: &'a str,
        id: &'a str,
        done: bool,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        self.updates
            .lock()
            .unwrap()
            .push((key.into(), id.into(), done));
        let fail = self.fail;
        Box::pin(async move {
            if fail {
                Err(ErrorKind::Storage)
            } else {
                Ok(())
            }
        })
    }
}

#[derive(Default)]
pub struct Recorder {
    pub created: Mutex<Vec<(String, bool)>>,
    pub completed: AtomicUsize,
}

impl Analytics for Recorder {
    fn task_created(&self, priority: &'static str, has_due_date: bool) {
        self.created
            .lock()
            .unwrap()
            .push((priority.into(), has_due_date));
    }
    fn task_completed(&self) {
        self.completed.fetch_add(1, Ordering::SeqCst);
    }
}

pub struct Rig {
    pub repo: Arc<FakeRepo>,
    pub pending: Arc<FakePending>,
    pub analytics: Arc<Recorder>,
    pub service: Arc<TaskService>,
}

pub fn rig_with(pending: FakePending) -> Rig {
    let repo = Arc::new(FakeRepo::default());
    let pending = Arc::new(pending);
    let analytics = Arc::new(Recorder::default());
    let counter = Arc::new(AtomicUsize::new(0));
    let service = Arc::new(TaskService::new(
        repo.clone(),
        pending.clone(),
        analytics.clone(),
        move || format!("k{}", counter.fetch_add(1, Ordering::SeqCst) + 1),
    ));
    Rig {
        repo,
        pending,
        analytics,
        service,
    }
}

pub fn rig() -> Rig {
    rig_with(FakePending::default())
}
