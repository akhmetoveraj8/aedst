/// Every route value in the app, in one place: the Swift analogue of the `NavKey`s in
/// `apps/android/core/navigation` (`MediaDetailKey`, ...). Any feature can push any of these onto the shared
/// `Router` (for example `Tasks` pushes `MediaRoute.detail` when an attachment is tapped) without importing the
/// feature that renders it. The view builder for each route type is registered by that feature's `*Destinations`
/// modifier and attached to the root `AedstNavigationStack` in `App/Shared`.
///
/// Add a case here when a screen becomes reachable from another feature; keep screen-private navigation inside
/// the feature.

/// Sign-in (the only route `Auth` exposes).
public enum AuthRoute: AedstRoute {
    case login
}

/// Task list and one task.
public enum TaskRoute: AedstRoute {
    case list
    case detail(id: String)
}

/// Media library and one item.
public enum MediaRoute: AedstRoute {
    case library
    case detail(id: String)
}

/// Search screen.
public enum SearchRoute: AedstRoute {
    case search
}

/// Notification inbox and preferences.
public enum NotificationsRoute: AedstRoute {
    case inbox
    case preferences
}

/// Admin sections. `App/Shared` only registers these destinations' entry point for tokens with the `admin` role.
public enum AdminRoute: AedstRoute {
    case dashboard
    case tasks
    case broadcast
    case auditLog
}
