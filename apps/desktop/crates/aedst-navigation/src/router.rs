//! The destination graph, the back stack and the deep-link gate.
//!
//! The router owns the stack and publishes a snapshot; the UI mirrors it. View models hold a
//! `Router` and call `push` / `reset_to` with a [`Route`]; they never see another feature.

use std::{
    collections::{BTreeSet, HashMap},
    sync::{Mutex, PoisonError},
};

use tokio::sync::watch;

use crate::route::{Route, route_for_link};

/// Route name -> view key. Each feature registers its entries; only the app sees the whole graph.
#[derive(Clone, Debug, Default)]
pub struct NavGraph {
    destinations: HashMap<String, String>,
    link_prefixes: BTreeSet<String>,
}

impl NavGraph {
    /// Registers `route_name` -> `view`. Idempotent: registering the same view again (every
    /// capabilities update re-runs the registration) is a no-op; a DIFFERENT view replaces the old one
    /// with a warning. `link_prefixes` count only while the route is registered.
    pub fn register(&mut self, route_name: &str, view: &str, link_prefixes: &[&str]) {
        match self.destinations.get(route_name) {
            Some(existing) if existing == view => {}
            Some(_) => {
                tracing::warn!(
                    route = route_name,
                    "destination re-registered with a different view; last one wins"
                );
                self.destinations
                    .insert(route_name.to_owned(), view.to_owned());
            }
            None => {
                self.destinations
                    .insert(route_name.to_owned(), view.to_owned());
            }
        }
        self.link_prefixes
            .extend(link_prefixes.iter().map(|p| (*p).to_owned()));
    }

    /// The view of a route, if registered.
    #[must_use]
    pub fn resolve(&self, route_name: &str) -> Option<&str> {
        self.destinations.get(route_name).map(String::as_str)
    }

    /// Every link prefix of a registered route, sorted and unique: the ONE source of both allow-lists
    /// (`Router::open_link` and the `aedst://` parser).
    #[must_use]
    pub fn link_prefixes(&self) -> Vec<String> {
        self.link_prefixes.iter().cloned().collect()
    }
}

/// What the UI needs to draw navigation.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NavSnapshot {
    /// The top of the stack.
    pub current: Option<Route>,
    /// Stack depth.
    pub depth: usize,
    /// True after `lock_to`: no way out.
    pub locked: bool,
}

#[derive(Default)]
struct State {
    stack: Vec<Route>,
    locked: bool,
}

/// Owns the back stack.
pub struct Router {
    graph: NavGraph,
    state: Mutex<State>,
    snapshot: watch::Sender<NavSnapshot>,
}

impl Router {
    /// A router over `graph`.
    #[must_use]
    pub fn new(graph: NavGraph) -> Self {
        Self {
            graph,
            state: Mutex::new(State::default()),
            snapshot: watch::channel(NavSnapshot::default()).0,
        }
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<NavSnapshot> {
        self.snapshot.subscribe()
    }

    /// The view the UI should show for `route`.
    #[must_use]
    pub fn view_for(&self, route: &Route) -> Option<&str> {
        self.graph.resolve(&route.name)
    }

    fn change<T>(&self, work: impl FnOnce(&mut State) -> T) -> T {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let result = work(&mut state);
        let snapshot = NavSnapshot {
            current: state.stack.last().cloned(),
            depth: state.stack.len(),
            locked: state.locked,
        };
        drop(state);
        self.snapshot.send_replace(snapshot);
        result
    }

    /// Pushes a route. `false` (and a log line) when it has no destination or the router is locked.
    pub fn push(&self, route: Route) -> bool {
        if self.graph.resolve(&route.name).is_none() {
            tracing::warn!(route = %route.name, "no destination registered");
            return false;
        }
        self.change(|s| {
            if s.locked {
                return false;
            }
            s.stack.push(route);
            true
        })
    }

    /// Clears the stack and shows `route`.
    pub fn reset_to(&self, route: Route) -> bool {
        if self.graph.resolve(&route.name).is_none() {
            tracing::warn!(route = %route.name, "no destination registered");
            return false;
        }
        self.change(|s| {
            if s.locked {
                return false;
            }
            s.stack = vec![route];
            true
        })
    }

    /// Shows `route` and then refuses every further navigation for the rest of the process: the user
    /// cannot leave it (forced upgrade). Locks nothing and returns `false` when it has no destination.
    pub fn lock_to(&self, route: Route) -> bool {
        if self.graph.resolve(&route.name).is_none() {
            tracing::warn!(route = %route.name, "cannot lock to an unregistered route");
            return false;
        }
        self.change(|s| {
            s.stack = vec![route];
            s.locked = true;
            true
        })
    }

    /// Pops one screen; the root stays. `false` at the root or when locked.
    pub fn go_back(&self) -> bool {
        self.change(|s| {
            if s.locked || s.stack.len() <= 1 {
                return false;
            }
            s.stack.pop();
            true
        })
    }

    /// Pushes the route for a server-provided relative link; `false` for anything outside the
    /// allow-list of the active routes.
    pub fn open_link(&self, link: &str) -> bool {
        match route_for_link(link, &self.graph.link_prefixes()) {
            Some(route) => self.push(route),
            None => {
                tracing::warn!("ignoring unsupported in-app link");
                false
            }
        }
    }

    /// The link prefixes of the active routes (pass them to the `aedst://` parser as well).
    #[must_use]
    pub fn link_prefixes(&self) -> Vec<String> {
        self.graph.link_prefixes()
    }

    /// True after `lock_to`.
    #[must_use]
    pub fn is_locked(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .locked
    }
}

/// Holds a deep link that arrives before sign-in and opens it once the user is signed in.
///
/// Without it a cold-start `aedst://tasks/<id>` was pushed onto the login screen and then wiped by
/// the `reset_to(task list)` after sign-in. `Router::open_link` still validates every link, so the
/// gate never widens the allow-list. Only the most recent pending link is kept.
pub struct DeepLinkGate<'r> {
    router: &'r Router,
    pending: Option<String>,
    signed_in: bool,
}

impl<'r> DeepLinkGate<'r> {
    /// A gate in the signed-out state.
    #[must_use]
    pub fn new(router: &'r Router) -> Self {
        Self {
            router,
            pending: None,
            signed_in: false,
        }
    }

    /// Opens `link` now when signed in, otherwise remembers it. `true` only when it was opened.
    pub fn submit(&mut self, link: &str) -> bool {
        if self.signed_in {
            return self.router.open_link(link);
        }
        self.pending = Some(link.to_owned());
        false
    }

    /// Call AFTER the signed-in home screen is on the stack: a pending link is pushed on top of it.
    /// Signing out drops a pending link: a link kept from one session must never open in another.
    pub fn set_signed_in(&mut self, signed_in: bool) {
        self.signed_in = signed_in;
        if !signed_in {
            self.pending = None;
        } else if let Some(link) = self.pending.take() {
            self.router.open_link(&link);
        }
    }

    /// Whether a link is waiting for sign-in.
    #[must_use]
    pub fn has_pending(&self) -> bool {
        self.pending.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::route::{names, routes};

    fn router() -> Router {
        let mut graph = NavGraph::default();
        graph.register(names::LOGIN, "LoginView", &[]);
        graph.register(names::TASKS, "TaskListView", &["tasks"]);
        graph.register(names::TASK_DETAIL, "TaskDetailView", &[]);
        graph.register(names::UPGRADE_REQUIRED, "UpgradeView", &[]);
        Router::new(graph)
    }

    #[test]
    fn push_grows_the_stack_and_publishes_a_snapshot() {
        let router = router();
        let rx = router.subscribe();
        assert!(router.reset_to(routes::tasks()));
        assert!(router.push(routes::task_detail("t1")));
        let snapshot = rx.borrow().clone();
        assert_eq!(snapshot.depth, 2);
        assert_eq!(snapshot.current.unwrap().name, names::TASK_DETAIL);
    }

    #[test]
    fn an_unregistered_route_is_rejected_and_changes_nothing() {
        let router = router();
        assert!(!router.push(routes::media()));
        assert_eq!(router.subscribe().borrow().depth, 0);
    }

    #[test]
    fn go_back_stops_at_the_root_and_reset_clears_the_stack() {
        let router = router();
        router.reset_to(routes::tasks());
        router.push(routes::task_detail("t1"));
        assert!(router.go_back());
        assert!(!router.go_back());
        router.push(routes::task_detail("t2"));
        router.reset_to(Route::new(names::LOGIN));
        assert_eq!(router.subscribe().borrow().depth, 1);
    }

    #[test]
    fn lock_to_shows_the_route_and_refuses_every_way_out() {
        let router = router();
        router.reset_to(routes::tasks());
        assert!(router.lock_to(Route::new(names::UPGRADE_REQUIRED)));
        assert!(router.is_locked());
        assert!(!router.push(routes::tasks()));
        assert!(!router.reset_to(Route::new(names::LOGIN)));
        assert!(!router.go_back());
        assert!(!router.open_link("/tasks"));
        let snapshot = router.subscribe().borrow().clone();
        assert_eq!((snapshot.depth, snapshot.locked), (1, true));
    }

    #[test]
    fn lock_to_an_unknown_route_locks_nothing() {
        let router = router();
        assert!(!router.lock_to(Route::new("nope")));
        assert!(!router.is_locked());
    }

    #[test]
    fn link_prefixes_follow_registered_routes_and_registration_is_idempotent() {
        let mut graph = NavGraph::default();
        graph.register("a/home", "A", &["tasks"]);
        graph.register("m/home", "M", &["media", "tasks"]);
        graph.register("m/home", "M", &["media"]);
        assert_eq!(graph.link_prefixes(), ["media", "tasks"]);
        graph.register("m/home", "M2", &[]);
        assert_eq!(graph.resolve("m/home"), Some("M2"));
    }

    #[test]
    fn deep_link_gate_keeps_a_cold_start_link_until_after_sign_in() {
        let router = router();
        let mut gate = DeepLinkGate::new(&router);
        assert!(!gate.submit("/tasks"));
        assert!(gate.has_pending());
        router.reset_to(routes::tasks()); // the signed-in home screen
        gate.set_signed_in(true);
        assert!(!gate.has_pending());
        assert_eq!(
            router.subscribe().borrow().depth,
            2,
            "the link opens on top of the home screen"
        );
    }

    #[test]
    fn signing_out_drops_a_pending_link_and_the_allow_list_still_applies() {
        let router = router();
        let mut gate = DeepLinkGate::new(&router);
        gate.submit("/tasks");
        gate.set_signed_in(false);
        assert!(!gate.has_pending());
        gate.submit("/admin");
        router.reset_to(routes::tasks());
        gate.set_signed_in(true);
        assert_eq!(
            router.subscribe().borrow().depth,
            1,
            "a link outside the allow-list is still refused"
        );
    }
}
