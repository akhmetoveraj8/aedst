//! Test doubles for the Admin ports.
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
use aedst_feature_admin::{
    domain::{
        AdminRepository, AdminTask, AuditEntry, BroadcastDraft, Overview, Page, PageRequest,
        StaticAccess, TaskStatus,
    },
    presentation::AdminController,
};
use futures::future::BoxFuture;
use tokio::sync::oneshot;

pub fn task(id: &str) -> AdminTask {
    AdminTask {
        id: id.into(),
        owner_id: "00000000-0000-4000-8000-000000000001".into(),
        title: format!("task {id}"),
        status: TaskStatus::Todo,
        created_at: 1,
        due_date: None,
    }
}

pub fn entry(id: &str) -> AuditEntry {
    AuditEntry {
        id: id.into(),
        actor_id: "a".into(),
        action: "task.delete".into(),
        target_kind: "task".into(),
        target_id: "t".into(),
        reason: "because".into(),
        created_at: 1,
    }
}

pub fn page<T>(items: Vec<T>, next: Option<&str>) -> Page<T> {
    Page {
        items,
        next_page_token: next.map(String::from),
    }
}

/// A scripted repository: every call pops its next answer and records what it was asked.
#[derive(Default)]
pub struct FakeRepo {
    pub overviews: Mutex<VecDeque<Result<Overview, ErrorKind>>>,
    pub tasks: Mutex<VecDeque<Result<Page<AdminTask>, ErrorKind>>>,
    pub audits: Mutex<VecDeque<Result<Page<AuditEntry>, ErrorKind>>>,
    pub deletes: Mutex<VecDeque<Result<(), ErrorKind>>>,
    pub broadcasts: Mutex<VecDeque<Result<u64, ErrorKind>>>,
    /// Every call, in order: `overview`, `tasks:<owner>:<token>`, `audit:<token>`,
    /// `delete:<id>:<reason>:<key>`, `broadcast:<title>:<key>`.
    pub calls: Mutex<Vec<String>>,
    /// When set, the next `list_tasks` call waits for this gate before answering.
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
}

impl FakeRepo {
    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }
}

fn token(page: &PageRequest) -> String {
    page.page_token.clone().unwrap_or_default()
}

fn next<T>(queue: &Mutex<VecDeque<T>>) -> T {
    queue.lock().unwrap().pop_front().expect("scripted answer")
}

impl AdminRepository for FakeRepo {
    fn overview(&self) -> BoxFuture<'_, Result<Overview, ErrorKind>> {
        self.record("overview".into());
        let answer = next(&self.overviews);
        Box::pin(async move { answer })
    }

    fn list_tasks<'a>(
        &'a self,
        owner_id: Option<&'a str>,
        page: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AdminTask>, ErrorKind>> {
        self.record(format!("tasks:{}:{}", owner_id.unwrap_or(""), token(page)));
        let gate = self.gate.lock().unwrap().take();
        let answer = next(&self.tasks);
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            answer
        })
    }

    fn delete_task<'a>(
        &'a self,
        id: &'a str,
        reason: &'a str,
        key: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        self.record(format!("delete:{id}:{reason}:{key}"));
        let answer = next(&self.deletes);
        Box::pin(async move { answer })
    }

    fn broadcast<'a>(
        &'a self,
        draft: &'a BroadcastDraft,
        key: &'a str,
    ) -> BoxFuture<'a, Result<u64, ErrorKind>> {
        self.record(format!("broadcast:{}:{key}", draft.title));
        let answer = next(&self.broadcasts);
        Box::pin(async move { answer })
    }

    fn list_audit_log<'a>(
        &'a self,
        page: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AuditEntry>, ErrorKind>> {
        self.record(format!("audit:{}", token(page)));
        let answer = next(&self.audits);
        Box::pin(async move { answer })
    }
}

pub struct Rig {
    pub repo: Arc<FakeRepo>,
    pub controller: Arc<AdminController>,
}

pub fn rig(admin: bool) -> Rig {
    let repo = Arc::new(FakeRepo::default());
    let counter = AtomicUsize::new(0);
    let controller = AdminController::new(repo.clone(), Arc::new(StaticAccess(admin)), move || {
        format!("k{}", counter.fetch_add(1, Ordering::SeqCst) + 1)
    });
    Rig { repo, controller }
}
