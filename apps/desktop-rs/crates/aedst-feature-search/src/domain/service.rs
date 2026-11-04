//! The use cases. They enforce the query rules, so an empty query never reaches the repository.

use std::sync::Arc;

use aedst_common::ErrorKind;

use super::{
    hit::SearchPage,
    ports::SearchRepository,
    query::{MAX_SUGGEST_CHARS, SUGGEST_LIMIT, SearchQuery, normalize_query},
};

/// Search use cases over the repository port.
pub struct SearchService {
    repository: Arc<dyn SearchRepository>,
}

impl SearchService {
    /// A service over a repository.
    #[must_use]
    pub fn new(repository: Arc<dyn SearchRepository>) -> Self {
        Self { repository }
    }

    /// Searches. `None` when the query is empty after normalisation: no request is made.
    ///
    /// # Errors
    /// The kind of the failure.
    pub async fn search(
        &self,
        raw: &str,
        page_token: Option<&str>,
    ) -> Result<Option<SearchPage>, ErrorKind> {
        let text = normalize_query(raw);
        if text.is_empty() {
            return Ok(None);
        }
        let query = SearchQuery {
            text,
            page_token: page_token.map(str::to_owned),
        };
        self.repository.search(&query).await.map(Some)
    }

    /// Suggestions for what is being typed. Empty (and no request) for an empty or too long query.
    ///
    /// # Errors
    /// The kind of the failure.
    pub async fn suggest(&self, raw: &str) -> Result<Vec<String>, ErrorKind> {
        let prefix = normalize_query(raw);
        if prefix.is_empty() || prefix.chars().count() > MAX_SUGGEST_CHARS {
            return Ok(Vec::new());
        }
        self.repository.suggest(&prefix, SUGGEST_LIMIT).await
    }
}
