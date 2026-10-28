#pragma once

#include <functional>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>

namespace aedst::navigation {

/// Well-known route names. A feature navigates to a name another feature
/// registers a destination for — never to that feature's types — the same way
/// a server module calls another module's RPC contract instead of importing its
/// handler package. New features add their route here, in Core.
namespace routes {

inline constexpr std::string_view kLogin = "auth/login";
inline constexpr std::string_view kTasks = "tasks/list";
inline constexpr std::string_view kTaskDetail = "tasks/detail";
inline constexpr std::string_view kSearch = "search/home";
inline constexpr std::string_view kNotifications = "notifications/inbox";
inline constexpr std::string_view kNotificationPreferences = "notifications/preferences";
inline constexpr std::string_view kMedia = "media/library";
inline constexpr std::string_view kMediaViewer = "media/viewer";
inline constexpr std::string_view kAdmin = "admin/home";
/// Blocking screen shown when the server refuses this app version (App/ owns the view; see Router::lockTo).
inline constexpr std::string_view kUpgradeRequired = "app/upgrade-required";

} // namespace routes

/// Well-known parameter keys shared across routes.
namespace params {

inline constexpr std::string_view kUserId = "userId";
inline constexpr std::string_view kTaskId = "taskId";
inline constexpr std::string_view kMediaId = "mediaId";

} // namespace params

struct Route {
    std::string name;
    /// Passed to the destination view as initial QML properties.
    std::map<std::string, std::string, std::less<>> params;

    friend bool operator==(const Route&, const Route&) = default;
};

/// Typed route helpers, next to the names above: a caller gets the right name and parameter key from one place
/// instead of assembling `Route{...}` by hand (the Android `AedstRoutes` / Apple `AedstRoute` equivalent).
namespace routes {

[[nodiscard]] inline Route tasks() {
    return Route{.name = std::string(kTasks), .params = {}};
}

[[nodiscard]] inline Route taskDetail(std::string_view taskId) {
    return Route{.name = std::string(kTaskDetail), .params = {{std::string(params::kTaskId), std::string(taskId)}}};
}

[[nodiscard]] inline Route media() {
    return Route{.name = std::string(kMedia), .params = {}};
}

[[nodiscard]] inline Route mediaViewer(std::string_view mediaId) {
    return Route{.name = std::string(kMediaViewer), .params = {{std::string(params::kMediaId), std::string(mediaId)}}};
}

[[nodiscard]] inline Route notifications() {
    return Route{.name = std::string(kNotifications), .params = {}};
}

} // namespace routes

/// Maps a server-provided in-app link (Notification.link, SearchHit.link,
/// BroadcastNotification.link: relative paths such as "/tasks/<id>") to a Route.
/// The contract says these are relative only; anything else (absolute URLs,
/// "//host", unknown prefixes, ids with path or query characters) yields nullopt
/// so a server string can never steer navigation outside the known graph.
///
/// `linkPrefixes` are the first path segments the ACTIVE routes declared (NavGraph::linkPrefixes(), filled from
/// plugin::RouteContribution::linkPrefixes). A link whose first segment is not among them is refused, which is
/// what keeps this allow-list and the `aedst://` one (platform::parseDeepLink) identical by construction.
/// Pure; defined in src/router.cpp.
[[nodiscard]] std::optional<Route> routeForLink(std::string_view link, std::span<const std::string> linkPrefixes);

} // namespace aedst::navigation
