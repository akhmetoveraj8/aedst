//! Navigation core: routes, the destination graph, the back stack, the link allow-list.
//!
//! UI-independent. The Slint shell subscribes to [`Router::subscribe`] and maps a route to a view.

pub mod route;
pub mod router;

pub use route::{Route, names, params, route_for_link, routes};
pub use router::{DeepLinkGate, NavGraph, NavSnapshot, Router};
