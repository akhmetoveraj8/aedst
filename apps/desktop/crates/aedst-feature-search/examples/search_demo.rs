//! Runs the Search screen against an in-memory repository (no server):
//! `cargo run -p aedst-feature-search --example search_demo -- [--lang ru|tg|uz|ar] [--dark] [--offline] [--empty] [--query milk]`.
//!
//! `--offline` makes every request fail as offline (error state with "Try again"); `--empty` has no
//! documents at all (the "No results" state); `--query <text>` types a query on start.
//! `--snapshot <file.png>` renders the window once, saves it and exits (for screenshots and docs).

use std::sync::{Arc, Mutex};

use aedst_common::ErrorKind;
use aedst_feature_search::{
    domain::{
        DocumentKind, LinkNavigator, SearchHit, SearchPage, SearchQuery, SearchRepository,
        SearchService,
    },
    presentation::SearchController,
    ui_glue::{SearchDemoWindow, SearchStore, bind, language_is_rtl, select_language},
};
use futures::future::BoxFuture;
use slint::ComponentHandle;

const PAGE: usize = 4;

struct Memory {
    hits: Vec<SearchHit>,
    offline: bool,
}

impl SearchRepository for Memory {
    fn search<'a>(
        &'a self,
        query: &'a SearchQuery,
    ) -> BoxFuture<'a, Result<SearchPage, ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            let needle = query.text.to_lowercase();
            let found: Vec<&SearchHit> = self
                .hits
                .iter()
                .filter(|h| h.title.to_lowercase().contains(&needle))
                .collect();
            let start = query
                .page_token
                .as_deref()
                .and_then(|t| t.parse::<usize>().ok())
                .unwrap_or(0);
            let end = (start + PAGE).min(found.len());
            let slice = found.get(start..end).unwrap_or_default();
            Ok(SearchPage {
                hits: slice.iter().map(|h| (*h).clone()).collect(),
                next_page_token: (end < found.len()).then(|| end.to_string()),
                total_estimate: query
                    .page_token
                    .is_none()
                    .then(|| u32::try_from(found.len()).unwrap_or(0)),
            })
        })
    }

    fn suggest<'a>(
        &'a self,
        prefix: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, Result<Vec<String>, ErrorKind>> {
        Box::pin(async move {
            let needle = prefix.to_lowercase();
            Ok(self
                .hits
                .iter()
                .filter(|h| h.title.to_lowercase().starts_with(&needle))
                .map(|h| h.title.clone())
                .take(usize::try_from(limit).unwrap_or(8))
                .collect())
        })
    }
}

/// Stands in for the router: remembers what was opened.
#[derive(Default)]
struct Opened(Mutex<Vec<String>>);

impl LinkNavigator for Opened {
    fn open(&self, link: &str) -> bool {
        self.0
            .lock()
            .map(|mut opened| opened.push(link.to_owned()))
            .is_ok()
    }
}

fn sample() -> Vec<SearchHit> {
    let titles = [
        ("Buy milk and bread", DocumentKind::Task),
        ("Milk delivery schedule.pdf", DocumentKind::Media),
        ("Milk tea recipe", DocumentKind::Task),
        ("Prepare the quarterly report", DocumentKind::Task),
        ("Milkshake photo.jpg", DocumentKind::Media),
        ("Call the bank", DocumentKind::Task),
        ("Almond milk shopping list", DocumentKind::Task),
        ("Renew the passport", DocumentKind::Unknown),
    ];
    titles
        .iter()
        .enumerate()
        .map(|(i, (title, kind))| SearchHit {
            kind: *kind,
            id: format!("00000000-0000-4000-8000-00000000000{i}"),
            title: (*title).to_owned(),
            snippet: format!(
                "...remember the \u{E000}{}\u{E001} before the weekend...",
                "milk"
            ),
            score: 1.0,
            link: format!("/tasks/{i}"),
            updated_at: None,
        })
        .collect()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let value = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let lang = value("--lang").unwrap_or_else(|| "en".to_owned());

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let repository = Arc::new(Memory {
        hits: if flag("--empty") {
            Vec::new()
        } else {
            sample()
        },
        offline: flag("--offline"),
    });
    let controller = SearchController::new(
        Arc::new(SearchService::new(repository)),
        Arc::new(Opened::default()),
    );

    let ui = SearchDemoWindow::new()?;
    select_language(&lang)?;
    ui.set_rtl(language_is_rtl(&lang));
    ui.set_dark(flag("--dark"));
    bind(&ui, &controller, runtime.handle());
    if let Some(query) = value("--query") {
        ui.global::<SearchStore>().set_query(query.as_str().into());
        let _guard = runtime.enter();
        controller.set_query(&query);
    }
    if let Some(path) = value("--snapshot") {
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
