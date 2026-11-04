//! Test doubles for the Notifications ports.
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
use aedst_feature_notifications::{
    domain::{
        LinkNavigator, Notification, NotificationKind, NotificationPage, NotificationQuery,
        NotificationsRepository, NotificationsService, Preferences,
    },
    presentation::UnreadCounter,
};
use futures::future::BoxFuture;
use tokio::sync::oneshot;

pub fn item(id: &str, read: bool) -> Notification {
    Notification {
        id: id.into(),
        kind: NotificationKind::TaskCompleted,
        title: format!("title {id}"),
        body: String::new(),
        link: format!("/tasks/{id}"),
        subject_id: id.into(),
        created_at: 1_000,
        read,
    }
}

pub fn page(items: &[(&str, bool)], next: Option<&str>) -> NotificationPage {
    NotificationPage {
        notifications: items.iter().map(|(id, read)| item(id, *read)).collect(),
        next_page_token: next.map(String::from),
    }
}

/// A scripted repository. Every write records the idempotency key it was sent with.
#[derive(Default)]
pub struct FakeRepo {
    pub pages: Mutex<VecDeque<Result<NotificationPage, ErrorKind>>>,
    pub counts: Mutex<VecDeque<Result<u32, ErrorKind>>>,
    pub mark_reads: Mutex<VecDeque<Result<(), ErrorKind>>>,
    pub mark_alls: Mutex<VecDeque<Result<u32, ErrorKind>>>,
    pub gets: Mutex<VecDeque<Result<Preferences, ErrorKind>>>,
    pub updates: Mutex<VecDeque<Result<Preferences, ErrorKind>>>,
    pub queries: Mutex<Vec<NotificationQuery>>,
    pub marked: Mutex<Vec<Vec<String>>>,
    pub keys: Mutex<Vec<String>>,
    pub sent_preferences: Mutex<Vec<Preferences>>,
    pub count_calls: AtomicUsize,
    /// When set, the next `list` call waits for this gate before answering.
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
    /// When set, the next `mark_read` call waits for this gate before answering.
    pub mark_gate: Mutex<Option<oneshot::Receiver<()>>>,
}

fn pop<T>(queue: &Mutex<VecDeque<T>>, what: &str) -> T {
    queue
        .lock()
        .unwrap()
        .pop_front()
        .unwrap_or_else(|| panic!("scripted {what}"))
}

impl NotificationsRepository for FakeRepo {
    fn list<'a>(
        &'a self,
        query: &'a NotificationQuery,
    ) -> BoxFuture<'a, Result<NotificationPage, ErrorKind>> {
        self.queries.lock().unwrap().push(query.clone());
        let gate = self.gate.lock().unwrap().take();
        let answer = pop(&self.pages, "page");
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            answer
        })
    }

    fn unread_count(&self) -> BoxFuture<'_, Result<u32, ErrorKind>> {
        self.count_calls.fetch_add(1, Ordering::SeqCst);
        let answer = pop(&self.counts, "count");
        Box::pin(async move { answer })
    }

    fn mark_read<'a>(
        &'a self,
        ids: &'a [String],
        key: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        self.marked.lock().unwrap().push(ids.to_vec());
        self.keys.lock().unwrap().push(key.into());
        let gate = self.mark_gate.lock().unwrap().take();
        let answer = pop(&self.mark_reads, "mark_read");
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            answer
        })
    }

    fn mark_all_read<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<u32, ErrorKind>> {
        self.keys.lock().unwrap().push(key.into());
        let answer = pop(&self.mark_alls, "mark_all_read");
        Box::pin(async move { answer })
    }

    fn get_preferences(&self) -> BoxFuture<'_, Result<Preferences, ErrorKind>> {
        let answer = pop(&self.gets, "get_preferences");
        Box::pin(async move { answer })
    }

    fn update_preferences<'a>(
        &'a self,
        preferences: &'a Preferences,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Preferences, ErrorKind>> {
        self.sent_preferences.lock().unwrap().push(*preferences);
        self.keys.lock().unwrap().push(key.into());
        let answer = pop(&self.updates, "update_preferences");
        Box::pin(async move { answer })
    }
}

#[derive(Default)]
pub struct FakeNavigator {
    pub opened: Mutex<Vec<String>>,
}

impl LinkNavigator for FakeNavigator {
    fn open(&self, link: &str) -> bool {
        self.opened.lock().unwrap().push(link.into());
        true
    }
}

pub struct Rig {
    pub repo: Arc<FakeRepo>,
    pub navigator: Arc<FakeNavigator>,
    pub service: Arc<NotificationsService>,
    pub counter: Arc<UnreadCounter>,
}

pub fn rig() -> Rig {
    let repo = Arc::new(FakeRepo::default());
    let navigator = Arc::new(FakeNavigator::default());
    let key_counter = Arc::new(AtomicUsize::new(0));
    let service = Arc::new(NotificationsService::new(
        repo.clone(),
        navigator.clone(),
        move || format!("k{}", key_counter.fetch_add(1, Ordering::SeqCst) + 1),
    ));
    let counter = UnreadCounter::new(service.clone());
    Rig {
        repo,
        navigator,
        service,
        counter,
    }
}
