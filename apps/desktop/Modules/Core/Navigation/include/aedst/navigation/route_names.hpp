#pragma once

#include "aedst/navigation/route.hpp"

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

namespace aedst::navigation {

/// The well-known route names of `routes::` (route.hpp) as constant QML properties, so Main.qml never repeats a
/// string literal such as "tasks/list": `AppRouter.currentRoute === Routes.login`. A default-constructible
/// QML_SINGLETON: the engine creates it, App/ provides nothing.
class RouteNames final : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Routes)
    QML_SINGLETON
    Q_PROPERTY(QString login READ login CONSTANT)
    Q_PROPERTY(QString tasks READ tasks CONSTANT)
    Q_PROPERTY(QString search READ search CONSTANT)
    Q_PROPERTY(QString notifications READ notifications CONSTANT)
    Q_PROPERTY(QString media READ media CONSTANT)
    Q_PROPERTY(QString admin READ admin CONSTANT)
    Q_PROPERTY(QString upgradeRequired READ upgradeRequired CONSTANT)

public:
    explicit RouteNames(QObject* parent = nullptr) : QObject(parent) {}

    [[nodiscard]] static QString login() { return name(routes::kLogin); }

    [[nodiscard]] static QString tasks() { return name(routes::kTasks); }

    [[nodiscard]] static QString search() { return name(routes::kSearch); }

    [[nodiscard]] static QString notifications() { return name(routes::kNotifications); }

    [[nodiscard]] static QString media() { return name(routes::kMedia); }

    [[nodiscard]] static QString admin() { return name(routes::kAdmin); }

    [[nodiscard]] static QString upgradeRequired() { return name(routes::kUpgradeRequired); }

private:
    [[nodiscard]] static QString name(std::string_view route) {
        return QString::fromUtf8(route.data(), static_cast<qsizetype>(route.size()));
    }
};

} // namespace aedst::navigation
