//! Domain layer: pure model, query rules, ports and the use case. No wire types, no UI, no storage.

pub mod hit;
pub mod ports;
pub mod query;
pub mod service;

pub use hit::{
    DocumentKind, HIGHLIGHT_END, HIGHLIGHT_START, SearchHit, SearchPage, SnippetSegment,
};
pub use ports::{LinkNavigator, SearchRepository};
pub use query::{
    MAX_QUERY_CHARS, MAX_SUGGEST_CHARS, PAGE_SIZE, SUGGEST_LIMIT, SearchQuery, normalize_query,
};
pub use service::SearchService;
