#pragma once

#include "aedst/logging/log_categories.hpp"

#include <QUrl>

#include <functional>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace aedst::navigation {

/// Route name -> QML view. Each feature's `register<Feature>Destinations()`
/// adds its entries; only App/ calls all of them, so only App/ sees the full graph.
class NavGraph final {
public:
    /// `linkPrefixes`: the first path segments ("tasks") of in-app links and `aedst://` hosts that this route opens.
    /// They count only while the route is registered, so a hidden feature opens no links (see routeForLink).
    void registerDestination(std::string_view routeName, QUrl view, const std::vector<std::string>& linkPrefixes = {}) {
        // Idempotent: registering the same route to the same view again (every capabilities update re-runs the
        // plugins' registration) is a no-op. Only a DIFFERENT view for an existing route is a conflict worth a warning.
        if (const auto existing = destinations_.find(routeName); existing != destinations_.end()) {
            if (existing->second != view) {
                qCWarning(lcNavigation,
                          "NavGraph: destination for '%s' re-registered with a different view; last one wins",
                          existing->first.c_str());
                existing->second = std::move(view);
            }
        } else {
            destinations_.emplace(std::string(routeName), std::move(view));
        }
        linkPrefixes_.insert(linkPrefixes.begin(), linkPrefixes.end());
    }

    /// Every link prefix declared by a registered route, sorted and unique. The ONE source of both deep-link
    /// allow-lists (Router::openLink and platform::parseDeepLink).
    [[nodiscard]] std::vector<std::string> linkPrefixes() const { return {linkPrefixes_.begin(), linkPrefixes_.end()}; }

    [[nodiscard]] std::optional<QUrl> resolve(std::string_view routeName) const {
        if (const auto it = destinations_.find(routeName); it != destinations_.end()) {
            return it->second;
        }
        return std::nullopt;
    }

    [[nodiscard]] bool contains(std::string_view routeName) const { return destinations_.contains(routeName); }

private:
    std::map<std::string, QUrl, std::less<>> destinations_;
    std::set<std::string, std::less<>> linkPrefixes_;
};

} // namespace aedst::navigation
