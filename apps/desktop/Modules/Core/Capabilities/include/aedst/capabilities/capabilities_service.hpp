#pragma once

#include "aedst/capabilities/capability_ports.hpp"
#include "aedst/capabilities/capability_rules.hpp"
#include "aedst/plugin/capability_set.hpp"

#include <QObject>
#include <QString>

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace aedst::capabilities {

/// Capability negotiation (ADR-0035): fetches what the server supports, remembers the last answer, and tells the
/// rest of the app which features to show and whether this build is still supported. GUI thread only.
///
/// Source order for every decision: a fetched answer, else the last known answer from the cache, else the defaults
/// (built-in features on, flagged features off). A failed fetch never clears anything.
///
/// It implements ICapabilitySource for PluginManager with one deliberate difference from isEnabled():
/// `current()` stays UNKNOWN until a real answer (fetched or cached) exists, so run-time plugins keep waiting and
/// built-ins keep their "works offline" behaviour; isEnabled() applies the defaults and is what the shell uses.
///
/// Triggers: start() at launch (cache first, then fetch), refresh() when connectivity returns. At most one fetch is
/// in flight; a refresh() during one is dropped (the answer it would give is on its way).
class CapabilitiesService final : public QObject, public plugin::ICapabilitySource {
    Q_OBJECT

public:
    struct Dependencies {
        std::shared_ptr<CapabilitiesRemote> remote;
        std::shared_ptr<CapabilityCache> cache;
        ClientBuild build;
    };

    explicit CapabilitiesService(Dependencies dependencies, QObject* parent = nullptr);
    ~CapabilitiesService() override;

    /// Loads the cached answer, then fetches. Call once, after the event loop can run.
    void start();
    /// Fetches now unless a fetch is already running.
    void refresh();

    /// Unknown until a fetched or cached answer exists (see class comment).
    [[nodiscard]] plugin::CapabilitySet current() const override { return current_; }

    /// Is the feature shown: built AND (server-enabled, or default). Unknown ids are false.
    [[nodiscard]] bool isEnabled(std::string_view id) const;
    /// Every feature id (and sub-capability) that is currently shown, sorted. For the shell's bindings.
    [[nodiscard]] std::vector<std::string> visibleFeatures() const;

    [[nodiscard]] const VersionAdvice& versionAdvice() const noexcept { return advice_; }

    /// Is the answer a fetched or cached one (as opposed to the defaults)?
    [[nodiscard]] bool hasAnswer() const noexcept { return answer_.has_value(); }

signals:
    /// The visible set may have changed (a new answer was applied).
    void capabilitiesChanged();
    /// This build is older than the server's minimum. Emitted once per process; the app locks on the upgrade screen.
    void upgradeRequired();
    /// A newer release exists. Emitted when the recommendation first appears; non-blocking.
    void upgradeRecommended();

private:
    void loadCache();
    void applyAnswer(ServerCapabilities answer, bool persist);

    std::shared_ptr<CapabilitiesRemote> remote_;
    std::shared_ptr<CapabilityCache> cache_;
    ClientBuild build_;

    std::optional<ServerCapabilities> answer_;
    plugin::CapabilitySet visible_; // always known(): includes the defaults
    plugin::CapabilitySet current_; // unknown until answer_ has a value
    VersionAdvice advice_;
    bool fetching_{false};
    bool fetchedOnce_{false};
    bool upgradeSignalled_{false};
    bool recommendedSignalled_{false};
};

} // namespace aedst::capabilities
