#include "plugin_host.hpp"

#include "Navigation/admin_destinations.hpp"
#include "Navigation/auth_destinations.hpp"
#include "Navigation/media_destinations.hpp"
#include "Navigation/notifications_destinations.hpp"
#include "Navigation/search_destinations.hpp"
#include "Navigation/tasks_destinations.hpp"
#include "aedst/logging/log_categories.hpp"

#include <QString>
#include <QUrl>

#ifdef AEDST_RUNTIME_PLUGINS
#include "aedst/plugin/plugin_loader.hpp"

#include <QCoreApplication>
#include <QDir>

#include <vector>
#endif

namespace aedst::app {

#ifdef AEDST_RUNTIME_PLUGINS
struct PluginHost::RuntimeLoader {
    explicit RuntimeLoader(plugin::PluginLoaderConfig config) : loader(std::move(config)) {}

    plugin::PluginLoader loader;
};
#else
struct PluginHost::RuntimeLoader {};
#endif

PluginHost::PluginHost() {
    // Order matters only for route-name collisions: built-ins are added first, so nothing added later can shadow them.
    const auto addBuiltIn = [this](std::unique_ptr<plugin::IFeaturePlugin> feature) {
        if (auto added = manager_.add(std::move(feature), plugin::PluginOrigin::BuiltIn); !added) {
            qCCritical(lcApp, "Built-in plugin was not added: %s", added.error().message.c_str());
        }
    };
    addBuiltIn(feature::auth::makeAuthPlugin());
    addBuiltIn(feature::tasks::makeTasksPlugin());
    addBuiltIn(feature::search::makeSearchPlugin());
    addBuiltIn(feature::notifications::makeNotificationsPlugin());
    addBuiltIn(feature::media::makeMediaPlugin());
    addBuiltIn(feature::admin::makeAdminPlugin());
}

PluginHost::~PluginHost() = default;

void PluginHost::addRuntimePlugins() {
#ifdef AEDST_RUNTIME_PLUGINS
    // The directory is fixed by the application, never by the environment or the command line.
    const QString directory = QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("plugins"));
    loader_ = std::make_unique<RuntimeLoader>(plugin::PluginLoaderConfig::forApplication(directory.toStdString()));
    std::vector<plugin::LoadReport> report;
    for (plugin::LoadedPlugin& loaded : loader_->loader.loadAll(report)) {
        if (auto added = manager_.add(std::move(loaded.plugin), plugin::PluginOrigin::Runtime); !added) {
            qCWarning(lcApp, "Run-time plugin %s was not added: %s", loaded.fileName.c_str(),
                      added.error().message.c_str());
        }
    }
    for (const plugin::LoadReport& line : report) {
        if (!line.loaded) {
            qCWarning(lcApp, "Plugin file '%s' not loaded (%s): %s", line.fileName.c_str(),
                      plugin::toString(line.verdict).data(), line.detail.c_str());
        }
    }
#endif
}

void PluginHost::activate() {
    manager_.activate(*capabilities_, services_);
}

void PluginHost::registerRoutes(navigation::NavGraph& graph) const {
    for (const plugin::RouteContribution& route : manager_.activeRoutes()) {
        graph.registerDestination(route.routeName, QUrl(QString::fromStdString(route.viewUrl)), route.linkPrefixes);
    }
}

} // namespace aedst::app
