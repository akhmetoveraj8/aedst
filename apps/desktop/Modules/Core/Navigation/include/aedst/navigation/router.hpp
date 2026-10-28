#pragma once

#include "aedst/navigation/nav_graph.hpp"
#include "aedst/navigation/route.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QUrl>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

#include <memory>
#include <string>
#include <vector>

namespace aedst::navigation {

/// Owns the back stack; QML's StackView in App/qml/Main.qml mirrors it by
/// reacting to the *Requested signals. ViewModels hold a Router* and call
/// push()/resetTo() with a Route — they never see QML or another feature.
class Router final : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(AppRouter)
    QML_SINGLETON
    Q_PROPERTY(QString currentRoute READ currentRoute NOTIFY currentRouteChanged)
    Q_PROPERTY(int depth READ depth NOTIFY currentRouteChanged)

public:
    static Router* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<Router>::create(engine, script);
    }

    explicit Router(std::shared_ptr<const NavGraph> graph, QObject* parent = nullptr);

    /// Returns false (and logs) when no destination is registered for the route.
    bool push(const Route& route);
    bool resetTo(const Route& route);

    /// Shows `route` and then refuses every further push/resetTo/goBack for the rest of the process: the user cannot
    /// leave it (forced upgrade). Returns false, and locks nothing, when the route has no destination.
    bool lockTo(const Route& route);

    [[nodiscard]] bool isLocked() const noexcept { return locked_; }

    Q_INVOKABLE bool navigate(const QString& routeName, const QVariantMap& params = {});
    Q_INVOKABLE bool replaceAll(const QString& routeName, const QVariantMap& params = {});
    Q_INVOKABLE bool goBack();
    /// Pushes the route for a server-provided relative link (see routeForLink);
    /// returns false and does nothing for anything outside the allow-list.
    Q_INVOKABLE bool openLink(const QString& link);

    /// The link prefixes of the active routes (NavGraph::linkPrefixes()); pass them to platform::parseDeepLink so
    /// `aedst://` links and openLink() accept the same screens.
    [[nodiscard]] std::vector<std::string> linkPrefixes() const;

    [[nodiscard]] QString currentRoute() const;
    [[nodiscard]] int depth() const;
    [[nodiscard]] const std::vector<Route>& backStack() const noexcept;

signals:
    void pushRequested(const QUrl& view, const QVariantMap& properties);
    void popRequested();
    void replaceAllRequested(const QUrl& view, const QVariantMap& properties);
    void currentRouteChanged();

private:
    [[nodiscard]] static Route toRoute(const QString& routeName, const QVariantMap& params);
    [[nodiscard]] static QVariantMap toProperties(const Route& route);

    std::shared_ptr<const NavGraph> graph_;
    std::vector<Route> backStack_;
    bool locked_{false};
};

} // namespace aedst::navigation
