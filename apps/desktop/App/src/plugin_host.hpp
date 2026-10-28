#pragma once

#include "aedst/navigation/nav_graph.hpp"
#include "aedst/plugin/capability_set.hpp"
#include "aedst/plugin/plugin_manager.hpp"
#include "aedst/plugin/service_registry.hpp"

#include <memory>

namespace aedst::app {

/// The composition root's side of the plugin architecture (ADR-0033): registers the six first-party
/// features as built-in plugins, optionally discovers signed run-time plugins, activates everything
/// that passes validation and capability gating, and copies the active plugins' routes into the
/// NavGraph. The only place in the app that knows both the feature factories and the PluginManager.
///
/// Phase 1 (this change): plugins contribute identity, gating and routes; view models are still built
/// by AppDependencies. Phase 2 moves view-model construction into registerServices().
class PluginHost final {
public:
    /// Adds the built-in features (Auth first, then the rest).
    PluginHost();
    PluginHost(const PluginHost&) = delete;
    PluginHost& operator=(const PluginHost&) = delete;
    PluginHost(PluginHost&&) = delete;
    PluginHost& operator=(PluginHost&&) = delete;
    ~PluginHost();

    /// Discovers run-time plugins in `<application dir>/plugins`. Compiled to a no-op unless the build
    /// sets AEDST_ENABLE_RUNTIME_PLUGINS; even then nothing is loaded without a validly signed allowlist.
    void addRuntimePlugins();

    /// Where activate() reads the server capabilities from (CapabilitiesService, ADR-0035). Must outlive the host.
    /// Until it is set the capabilities are unknown: built-ins stay active, run-time plugins wait.
    void setCapabilitySource(const plugin::ICapabilitySource& source) noexcept { capabilities_ = &source; }

    /// Evaluates all plugins that are not active yet against the current capabilities. Call again when they change.
    void activate();

    /// Registers the routes of the active plugins. Call after activate().
    void registerRoutes(navigation::NavGraph& graph) const;

    [[nodiscard]] const plugin::PluginManager& plugins() const noexcept { return manager_; }

    [[nodiscard]] plugin::ServiceRegistry& services() noexcept { return services_; }

private:
    struct RuntimeLoader; // PluginLoader behind an opaque type: only defined in builds with run-time plugins

    // Declared first, destroyed last: a run-time plugin's code must outlive the plugin objects.
    std::unique_ptr<RuntimeLoader> loader_;
    plugin::ServiceRegistry services_;
    plugin::StaticCapabilitySource noCapabilities_; // used until the host supplies a source
    const plugin::ICapabilitySource* capabilities_{&noCapabilities_};
    plugin::PluginManager manager_;
};

} // namespace aedst::app
