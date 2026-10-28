#include "aedst/capabilities/capabilities_service.hpp"
#include "aedst/logging/log_categories.hpp"
#include "app_dependencies.hpp"
#include "client_build.hpp"
#include "plugin_host.hpp"

#include <QObject>
#include <QString>
#include <QStringList>

#include <string>
#include <utility>
#include <vector>

namespace aedst::app {

namespace {

QStringList toQStringList(const std::vector<std::string>& names) {
    QStringList list;
    list.reserve(static_cast<qsizetype>(names.size()));
    for (const std::string& name : names) {
        list.push_back(QString::fromStdString(name));
    }
    return list;
}

} // namespace

void AppDependencies::createCapabilities(std::string version, std::shared_ptr<persistence::DatabaseWorker> worker,
                                         persistence::Dispatcher dispatcher) {
    capabilities_ = std::make_unique<capabilities::CapabilitiesService>(capabilities::CapabilitiesService::Dependencies{
        .remote = std::make_shared<capabilities::ConnectCapabilitiesRemote>(connectClient_),
        .cache = std::make_shared<capabilities::SqliteCapabilityCache>(std::move(worker), std::move(dispatcher)),
        .build = desktopClientBuild(std::move(version)),
    });
    plugins_->setCapabilitySource(*capabilities_);
    session_->setVisibleFeatures(
        toQStringList(capabilities_->visibleFeatures())); // the defaults, until the server answers

    // A new answer: show or hide the shell's sections, and let plugins that were waiting for it activate (there is no
    // deactivation, ADR-0033: a built-in feature is hidden in the shell, a run-time plugin disappears after a restart).
    QObject::connect(capabilities_.get(), &capabilities::CapabilitiesService::capabilitiesChanged, capabilities_.get(),
                     [this]() {
                         session_->setVisibleFeatures(toQStringList(capabilities_->visibleFeatures()));
                         plugins_->activate();
                         plugins_->registerRoutes(*navGraph_);
                     });
    // This build is below the server's minimum: the same blocking screen the version gate's refusal shows.
    QObject::connect(capabilities_.get(), &capabilities::CapabilitiesService::upgradeRequired, capabilities_.get(),
                     [this]() { onUpgradeRequired(); });
    QObject::connect(capabilities_.get(), &capabilities::CapabilitiesService::upgradeRecommended, capabilities_.get(),
                     [this]() {
                         qCInfo(lcApp, "A newer release is recommended (%s); updates are offered by the update flow",
                                capabilities_->versionAdvice().recommended.c_str());
                     });
}

capabilities::CapabilitiesService& AppDependencies::capabilities() noexcept {
    return *capabilities_;
}

} // namespace aedst::app
