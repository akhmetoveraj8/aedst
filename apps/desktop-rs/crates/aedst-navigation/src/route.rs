//! Route names, typed helpers and the link allow-list.
//!
//! A feature navigates to a name another feature registers a destination for, never to that
//! feature's types. New routes are added here, in core.

use std::collections::BTreeMap;

/// Well-known route names.
pub mod names {
    /// Sign-in screen.
    pub const LOGIN: &str = "auth/login";
    /// Task list.
    pub const TASKS: &str = "tasks/list";
    /// One task.
    pub const TASK_DETAIL: &str = "tasks/detail";
    /// Search home.
    pub const SEARCH: &str = "search/home";
    /// Notification inbox.
    pub const NOTIFICATIONS: &str = "notifications/inbox";
    /// Notification preferences.
    pub const NOTIFICATION_PREFERENCES: &str = "notifications/preferences";
    /// Media library.
    pub const MEDIA: &str = "media/library";
    /// One media item.
    pub const MEDIA_VIEWER: &str = "media/viewer";
    /// Staff area.
    pub const ADMIN: &str = "admin/home";
    /// Blocking screen shown when the server refuses this app version (see `Router::lock_to`).
    pub const UPGRADE_REQUIRED: &str = "app/upgrade-required";
}

/// Well-known parameter keys.
pub mod params {
    /// A user id.
    pub const USER_ID: &str = "userId";
    /// A task id.
    pub const TASK_ID: &str = "taskId";
    /// A media id.
    pub const MEDIA_ID: &str = "mediaId";
}

/// A destination plus its parameters.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Route {
    /// One of [`names`] (or a feature's own name).
    pub name: String,
    /// Passed to the destination view.
    pub params: BTreeMap<String, String>,
}

impl Route {
    /// A route without parameters.
    #[must_use]
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_owned(),
            params: BTreeMap::new(),
        }
    }

    fn with(name: &str, key: &str, value: &str) -> Self {
        Self {
            name: name.to_owned(),
            params: BTreeMap::from([(key.to_owned(), value.to_owned())]),
        }
    }
}

/// Typed route helpers: the right name and parameter key from one place.
pub mod routes {
    use super::{Route, names, params};

    /// The task list.
    #[must_use]
    pub fn tasks() -> Route {
        Route::new(names::TASKS)
    }
    /// One task.
    #[must_use]
    pub fn task_detail(task_id: &str) -> Route {
        Route::with(names::TASK_DETAIL, params::TASK_ID, task_id)
    }
    /// The media library.
    #[must_use]
    pub fn media() -> Route {
        Route::new(names::MEDIA)
    }
    /// One media item.
    #[must_use]
    pub fn media_viewer(media_id: &str) -> Route {
        Route::with(names::MEDIA_VIEWER, params::MEDIA_ID, media_id)
    }
    /// The notification inbox.
    #[must_use]
    pub fn notifications() -> Route {
        Route::new(names::NOTIFICATIONS)
    }
}

/// An id inside a link: letters, digits, `-` and `_` only (UUIDs). Anything with a path or query
/// character is refused.
fn id_after<'a>(link: &'a str, prefix: &str) -> Option<&'a str> {
    let id = link.strip_prefix(prefix)?;
    (!id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
    .then_some(id)
}

/// Maps a server-provided in-app link (`/tasks/<id>`) to a route. Relative links only: absolute
/// URLs, `//host`, unknown prefixes and ids with path or query characters yield `None`, so a server
/// string can never steer navigation outside the known graph.
///
/// `link_prefixes` are the first path segments the ACTIVE routes declared; a link whose first
/// segment is not among them is refused (this keeps it identical to the `aedst://` allow-list).
#[must_use]
pub fn route_for_link(link: &str, link_prefixes: &[String]) -> Option<Route> {
    let rest = link
        .strip_prefix('/')
        .filter(|r| !r.is_empty() && !r.starts_with('/'))?;
    let prefix = rest.split('/').next().unwrap_or_default();
    if !link_prefixes.iter().any(|p| p == prefix) {
        return None;
    }
    let bare = matches!(link.trim_end_matches('/'), l if l == format!("/{prefix}"));
    match prefix {
        "tasks" if bare => Some(routes::tasks()),
        "tasks" => id_after(link, "/tasks/").map(routes::task_detail),
        "media" if bare => Some(routes::media()),
        "media" => id_after(link, "/media/").map(routes::media_viewer),
        "notifications" if bare => Some(routes::notifications()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all() -> Vec<String> {
        ["tasks", "media", "notifications"].map(String::from).into()
    }

    #[test]
    fn maps_known_relative_links() {
        let id = "3f2b8c1e-0000-4000-8000-000000000001";
        let task = route_for_link(&format!("/tasks/{id}"), &all()).unwrap();
        assert_eq!(task.name, names::TASK_DETAIL);
        assert_eq!(task.params[params::TASK_ID], id);
        assert_eq!(route_for_link("/tasks", &all()).unwrap().name, names::TASKS);
        assert_eq!(
            route_for_link("/tasks/", &all()).unwrap().name,
            names::TASKS
        );
        assert_eq!(
            route_for_link("/notifications", &all()).unwrap().name,
            names::NOTIFICATIONS
        );
        assert_eq!(
            route_for_link("/media/abc-123", &all()).unwrap().name,
            names::MEDIA_VIEWER
        );
        assert_eq!(route_for_link("/media", &all()), Some(routes::media()));
    }

    #[test]
    fn only_prefixes_of_active_routes_open() {
        let tasks_only = vec!["tasks".to_owned()];
        assert!(route_for_link("/tasks", &tasks_only).is_some());
        assert!(route_for_link("/media/abc-123", &tasks_only).is_none());
        assert!(route_for_link("/tasks", &[]).is_none());
    }

    #[test]
    fn rejects_anything_outside_the_allow_list() {
        for link in [
            "",
            "/",
            "https://evil.example/tasks/1",
            "//evil.example/tasks/1",
            "/tasks/../admin",
            "/tasks/1?x=y",
            "/tasks/1/2",
            "/admin",
            "/notifications/x",
        ] {
            assert!(route_for_link(link, &all()).is_none(), "{link}");
        }
    }
}
