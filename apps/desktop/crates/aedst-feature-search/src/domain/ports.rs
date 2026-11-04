//! What the domain needs from the outside world. `data` implements the repository; the app shell
//! implements the navigator (with `aedst_navigation::Router::open_link`); tests use fakes.

use aedst_common::ErrorKind;
use futures::future::BoxFuture;

use super::{hit::SearchPage, query::SearchQuery};

/// The server side of Search. Read-only, so repeating a call is always safe.
pub trait SearchRepository: Send + Sync {
    /// One page of results for a normalised query.
    fn search<'a>(&'a self, query: &'a SearchQuery)
    -> BoxFuture<'a, Result<SearchPage, ErrorKind>>;
    /// Title prefix suggestions, at most `limit`.
    fn suggest<'a>(
        &'a self,
        prefix: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, Result<Vec<String>, ErrorKind>>;
}

/// Opens an in-app route. A route the router refuses simply does nothing.
pub trait LinkNavigator: Send + Sync {
    /// True when the link was opened.
    fn open(&self, link: &str) -> bool;
}
