//! Test doubles for the Search ports.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report
#![allow(dead_code)] // each test file uses a different subset

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use aedst_common::ErrorKind;
use aedst_feature_search::{
    domain::{
        DocumentKind, LinkNavigator, SearchHit, SearchPage, SearchQuery, SearchRepository,
        SearchService,
    },
    presentation::SearchController,
};
use futures::future::BoxFuture;
use tokio::sync::oneshot;

pub fn hit(id: &str, title: &str) -> SearchHit {
    SearchHit {
        kind: DocumentKind::Task,
        id: id.into(),
        title: title.into(),
        snippet: format!("about \u{E000}{title}\u{E001} here"),
        score: 1.0,
        link: format!("/tasks/{id}"),
        updated_at: None,
    }
}

pub fn page(ids: &[&str], next: Option<&str>, total: Option<u32>) -> SearchPage {
    SearchPage {
        hits: ids.iter().map(|id| hit(id, &format!("hit {id}"))).collect(),
        next_page_token: next.map(String::from),
        total_estimate: total,
    }
}

/// A scripted repository. A gate makes the matching call wait until the test releases it.
#[derive(Default)]
pub struct FakeRepo {
    pub pages: Mutex<VecDeque<Result<SearchPage, ErrorKind>>>,
    pub suggestions: Mutex<VecDeque<Result<Vec<String>, ErrorKind>>>,
    pub searches: Mutex<Vec<SearchQuery>>,
    pub suggests: Mutex<Vec<(String, u32)>>,
    pub search_gate: Mutex<Option<oneshot::Receiver<()>>>,
}

impl SearchRepository for FakeRepo {
    fn search<'a>(
        &'a self,
        query: &'a SearchQuery,
    ) -> BoxFuture<'a, Result<SearchPage, ErrorKind>> {
        self.searches.lock().unwrap().push(query.clone());
        let gate = self.search_gate.lock().unwrap().take();
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

    fn suggest<'a>(
        &'a self,
        prefix: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, Result<Vec<String>, ErrorKind>> {
        self.suggests.lock().unwrap().push((prefix.into(), limit));
        let answer = self
            .suggestions
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(Vec::new()));
        Box::pin(async move { answer })
    }
}

/// Records what was opened; refuses links in `refuse`.
#[derive(Default)]
pub struct FakeNavigator {
    pub opened: Mutex<Vec<String>>,
    pub refuse: Mutex<Vec<String>>,
}

impl LinkNavigator for FakeNavigator {
    fn open(&self, link: &str) -> bool {
        if self.refuse.lock().unwrap().iter().any(|l| l == link) {
            return false;
        }
        self.opened.lock().unwrap().push(link.into());
        true
    }
}

pub struct Rig {
    pub repo: Arc<FakeRepo>,
    pub navigator: Arc<FakeNavigator>,
    pub service: Arc<SearchService>,
    pub controller: Arc<SearchController>,
}

pub fn rig() -> Rig {
    let repo = Arc::new(FakeRepo::default());
    let navigator = Arc::new(FakeNavigator::default());
    let service = Arc::new(SearchService::new(repo.clone()));
    let controller = SearchController::new(service.clone(), navigator.clone());
    Rig {
        repo,
        navigator,
        service,
        controller,
    }
}

/// Lets spawned tasks run until they are all waiting again (time is paused in these tests).
pub async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}
