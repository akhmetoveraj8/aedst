#include "activation.hpp"

#include "aedst/logging/log_categories.hpp"
#include "aedst/platform/deep_link.hpp"
#include "app_dependencies.hpp"

#include <QString>

#include <string>
#include <vector>

namespace aedst::app {

void handleActivation(const QStringList& arguments, const QPointer<QQuickWindow>& window, AppDependencies* deps) {
    for (const QString& argument : arguments) {
        const std::string text = argument.toStdString();
        if (deps == nullptr || !platform::looksLikeDeepLink(text)) {
            continue;
        }
        // The hosts come from the active routes, the same set Router::openLink checks: the two allow-lists cannot
        // diverge.
        const std::vector<std::string> routeHosts = deps->router().linkPrefixes();
        if (auto link = platform::parseDeepLink(text, routeHosts)) {
            qCInfo(lcApp, "Deep link received (route=%s)", link->route.c_str());
            // The allow-listed route maps onto the same relative links the server uses ("/tasks/<id>").
            deps->openDeepLink(QStringLiteral("/") + QString::fromStdString(link->route));
        } else {
            qCWarning(lcApp, "Deep link rejected: %s", link.error().message.c_str());
        }
    }
    if (window) {
        window->show();
        window->raise();
        window->requestActivate();
    }
}

} // namespace aedst::app
