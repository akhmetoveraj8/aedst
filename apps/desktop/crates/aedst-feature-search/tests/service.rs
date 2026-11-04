//! The use case: query rules are enforced before the repository is reached.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use support::{page, rig};

#[tokio::test]
async fn an_empty_query_never_reaches_the_repository() {
    let rig = rig();
    assert_eq!(rig.service.search("  \t", None).await, Ok(None));
    assert_eq!(rig.service.suggest("   ").await, Ok(Vec::new()));
    assert!(rig.repo.searches.lock().unwrap().is_empty());
    assert!(rig.repo.suggests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_query_is_normalised_and_the_token_passed_through() {
    let rig = rig();
    rig.repo
        .pages
        .lock()
        .unwrap()
        .push_back(Ok(page(&["a"], None, None)));
    let result = rig.service.search("  milk ", Some("tok")).await.unwrap();
    assert_eq!(result.unwrap().hits.len(), 1);
    let sent = rig.repo.searches.lock().unwrap().clone();
    assert_eq!(sent[0].text, "milk");
    assert_eq!(sent[0].page_token.as_deref(), Some("tok"));
}

#[tokio::test]
async fn suggest_asks_for_eight_and_skips_long_prefixes() {
    let rig = rig();
    rig.service.suggest(" mi ").await.unwrap();
    assert_eq!(
        rig.repo.suggests.lock().unwrap().clone(),
        vec![("mi".to_owned(), 8)]
    );
    rig.service.suggest(&"x".repeat(101)).await.unwrap();
    assert_eq!(rig.repo.suggests.lock().unwrap().len(), 1);
}
