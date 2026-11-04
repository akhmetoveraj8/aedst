//! The Connect implementation of the repository: generated client + bearer token. Both RPCs are
//! reads, so no idempotency key is needed.

use std::sync::Arc;

use aedst_api::{TokenSource, call_authenticated};
use aedst_common::ErrorKind;
use aedst_contract::proto::aedst::search::v1::SearchServiceClient;
use connectrpc::client::{ClientConfig, HttpClient};
use futures::future::BoxFuture;

use super::mapping::{page_from_wire, search_request, suggest_request};
use crate::domain::{SearchPage, SearchQuery, SearchRepository};

/// Talks to `SearchService`.
pub struct ConnectSearchRepository {
    client: SearchServiceClient<HttpClient>,
    tokens: Arc<dyn TokenSource>,
    online: Arc<dyn Fn() -> bool + Send + Sync>,
}

impl ConnectSearchRepository {
    /// `online` reports connectivity so `unavailable` while offline is classified `Offline`.
    #[must_use]
    pub fn new(
        http: HttpClient,
        config: ClientConfig,
        tokens: Arc<dyn TokenSource>,
        online: impl Fn() -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            client: SearchServiceClient::new(http, config),
            tokens,
            online: Arc::new(online),
        }
    }

    fn kind(&self, error: &aedst_api::ApiError) -> ErrorKind {
        error.kind((self.online)())
    }
}

impl SearchRepository for ConnectSearchRepository {
    fn search<'a>(
        &'a self,
        query: &'a SearchQuery,
    ) -> BoxFuture<'a, Result<SearchPage, ErrorKind>> {
        Box::pin(async move {
            let request = search_request(query);
            let first = query.page_token.is_none();
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.search_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(page_from_wire(&response.into_owned(), first))
        })
    }

    fn suggest<'a>(
        &'a self,
        prefix: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, Result<Vec<String>, ErrorKind>> {
        Box::pin(async move {
            let request = suggest_request(prefix, limit);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.suggest_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(response.into_owned().suggestions)
        })
    }
}
