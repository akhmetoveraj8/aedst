#pragma once

#include "aedst/core/outcome.hpp"
#include "aedst/plugin/service_registry.hpp"

#include <string>
#include <utility>
#include <vector>

namespace aedst::plugin {

/// Version of the plugin contract (IFeaturePlugin, PluginDescriptor, ServiceRegistry semantics).
/// A plugin built against another value is rejected, never loaded "best effort". Bump it on any
/// source- or ABI-incompatible change of this module's public headers.
inline constexpr int kPluginApiVersion = 1;

/// Where a plugin came from. Decides how an unknown CapabilitySet is treated and nothing else:
/// both origins go through the same validation.
enum class PluginOrigin {
    /// Compiled into the executable and registered by the composition root.
    BuiltIn,
    /// Discovered at run time by the (optional) PluginLoader, only from the signed allowlist.
    Runtime,
};

/// A screen the plugin adds to the navigation graph. `viewUrl` must be a `qrc:/` URL: QML that is
/// not part of the plugin's own resources (file:, http:, ...) is never navigated to.
struct RouteContribution {
    std::string routeName;
    std::string viewUrl;
    /// First path segments this screen opens, lower-case `[a-z]+` ("tasks" for `/tasks/<id>` and `aedst://tasks`).
    /// While the route is active they are the ONLY allow-list for in-app links and `aedst://` deep links
    /// (navigation::NavGraph::linkPrefixes()). Empty = the screen is reached by navigation only, never by a link.
    std::vector<std::string> linkPrefixes{}; // default member initializer: {name, url} stays warning-free

    friend bool operator==(const RouteContribution&, const RouteContribution&) = default;
};

struct PluginDescriptor {
    /// Stable identity: lower-case `[a-z][a-z0-9._-]{2,63}`. A built-in feature uses its feature id (`tasks`, the same
    /// id as features.yaml, the server capability and ClientBuild::features); a third-party plugin uses `vendor.name`.
    std::string id;
    /// Semantic version of the plugin itself (semver 2.0.0).
    std::string version;
    /// The kPluginApiVersion the plugin was built against.
    int apiVersion{kPluginApiVersion};
    /// Server capabilities (aedst.capabilities.v1) that must all be present for the plugin to be
    /// activated. Empty = none required.
    std::vector<std::string> requiredCapabilities;
    /// Server feature flag that must be enabled. Empty = not flag-gated.
    std::string featureFlag;
};

/// The contract between a feature and the host. Built-in features implement it and are added by
/// the composition root; runtime plugins implement it behind QtFeaturePluginFactory.
///
/// The host calls, in this order: descriptor() (validation and gating), routes() (collision check),
/// then registerServices() once, on the GUI thread, only for a plugin that passed everything. A
/// plugin must not start threads, network calls or file access from its constructor.
class IFeaturePlugin {
public:
    IFeaturePlugin() = default;
    IFeaturePlugin(const IFeaturePlugin&) = delete;
    IFeaturePlugin& operator=(const IFeaturePlugin&) = delete;
    IFeaturePlugin(IFeaturePlugin&&) = delete;
    IFeaturePlugin& operator=(IFeaturePlugin&&) = delete;
    virtual ~IFeaturePlugin() = default;

    [[nodiscard]] virtual const PluginDescriptor& descriptor() const noexcept = 0;

    /// Screens this plugin adds. The host registers them in the NavGraph only when it is active.
    [[nodiscard]] virtual std::vector<RouteContribution> routes() const = 0;

    /// Provides the plugin's services and receives the host's. (`register` is a C++ keyword, hence
    /// the name.) A failure rejects the plugin and rolls the registry back.
    [[nodiscard]] virtual core::VoidOutcome registerServices(ServiceRegistry& registry) = 0;
};

/// A plugin that only declares an identity and screens. Built-in features use it while their
/// view models are still constructed by AppDependencies (see ADR-0033, "Phase 2").
class StaticFeaturePlugin final : public IFeaturePlugin {
public:
    StaticFeaturePlugin(PluginDescriptor descriptor, std::vector<RouteContribution> routes)
        : descriptor_(std::move(descriptor)), routes_(std::move(routes)) {}

    [[nodiscard]] const PluginDescriptor& descriptor() const noexcept override { return descriptor_; }

    [[nodiscard]] std::vector<RouteContribution> routes() const override { return routes_; }

    [[nodiscard]] core::VoidOutcome registerServices(ServiceRegistry& /*registry*/) override { return core::ok(); }

private:
    PluginDescriptor descriptor_;
    std::vector<RouteContribution> routes_;
};

} // namespace aedst::plugin
