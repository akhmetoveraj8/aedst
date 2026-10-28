#include "dbus_notification_service.hpp"

#include "aedst/logging/log_categories.hpp"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QString>
#include <QStringList>
#include <QVariant>
#include <QVariantMap>

#include <string_view>

namespace aedst::platform {
namespace {

constexpr qsizetype kMaxTitleChars = 256;
constexpr qsizetype kMaxBodyChars = 2048;
constexpr int kMaxTrackedNotifications = 64;

QString serviceName() {
    return QStringLiteral("org.freedesktop.Notifications");
}

QString objectPath() {
    return QStringLiteral("/org/freedesktop/Notifications");
}

bool isServerRunning() {
    const QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected()) {
        return false;
    }
    QDBusConnectionInterface* busInterface = bus.interface();
    if (busInterface == nullptr) {
        return false;
    }
    return busInterface->isServiceRegistered(serviceName()).value();
}

/// Notification spec urgency levels: 0 low, 1 normal, 2 critical.
uchar urgencyFor(NotificationSeverity severity) {
    return severity == NotificationSeverity::Error ? uchar{2} : uchar{1};
}

QString iconFor(NotificationSeverity severity) {
    switch (severity) {
    case NotificationSeverity::Warning:
        return QStringLiteral("dialog-warning");
    case NotificationSeverity::Error:
        return QStringLiteral("dialog-error");
    case NotificationSeverity::Info:
        break;
    }
    return QStringLiteral("dialog-information");
}

QString toQString(std::string_view text, qsizetype maxChars) {
    return QString::fromUtf8(text.data(), static_cast<qsizetype>(text.size())).left(maxChars);
}

} // namespace

DBusNotificationService::DBusNotificationService(NotificationService& fallback)
    : fallback_(fallback), available_(isServerRunning()) {
    if (!available_) {
        return;
    }
    const QDBusConnection bus = QDBusConnection::sessionBus();
    bus.connect(serviceName(), objectPath(), serviceName(), QStringLiteral("ActionInvoked"), this,
                SLOT(onActionInvoked(uint, QString)));
    bus.connect(serviceName(), objectPath(), serviceName(), QStringLiteral("NotificationClosed"), this,
                SLOT(onNotificationClosed(uint, uint)));
}

bool DBusNotificationService::isAvailable() const {
    return available_;
}

void DBusNotificationService::show(std::string_view title, std::string_view body, NotificationSeverity severity) {
    showRequest(NotificationRequest{.title = std::string(title), .body = std::string(body), .severity = severity});
}

void DBusNotificationService::showRequest(const NotificationRequest& request) {
    if (!available_) {
        fallback_.show(request.title, request.body, request.severity);
        return;
    }
    // Summary is plain text; the body may be interpreted as markup by the
    // server, so escape it: server-provided text must never inject markup.
    const QString summary = toQString(request.title, kMaxTitleChars);
    const QString text = toQString(request.body, kMaxBodyChars).toHtmlEscaped();

    QVariantMap hints;
    hints.insert(QStringLiteral("urgency"), QVariant::fromValue(urgencyFor(request.severity)));

    // "default" is the action a click on the notification body triggers; servers that render buttons show it
    // under the given label.
    QStringList actions;
    if (!request.link.empty()) {
        const QString label =
            request.actionLabel.empty() ? QStringLiteral("Open") : toQString(request.actionLabel, kMaxTitleChars);
        actions << QStringLiteral("default") << label;
    }

    const QString tag = QString::fromStdString(request.tag);
    const uint replaces = tag.isEmpty() ? 0U : idsByTag_.value(tag, 0U);

    QDBusMessage message =
        QDBusMessage::createMethodCall(serviceName(), objectPath(), serviceName(), QStringLiteral("Notify"));
    message << QCoreApplication::applicationName()    // app_name
            << QVariant::fromValue(quint32{replaces}) // replaces_id
            << iconFor(request.severity)              // app_icon
            << summary                                // summary
            << text                                   // body
            << actions                                // actions
            << hints                                  // hints
            << -1;                                    // expire_timeout: server default

    const QDBusPendingCall call = QDBusConnection::sessionBus().asyncCall(message);
    if (call.isError()) {
        fallback_.show(request.title, request.body, request.severity);
        return;
    }
    // The server answers with the notification id; remember what a click on it should open.
    auto* watcher = new QDBusPendingCallWatcher(call, this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this,
            [this, link = request.link, tag](QDBusPendingCallWatcher* finished) {
                finished->deleteLater();
                const QDBusPendingReply<uint> reply = *finished;
                if (reply.isError()) {
                    qCWarning(lcNotifications, "org.freedesktop.Notifications.Notify failed: %s",
                              qUtf8Printable(reply.error().message()));
                    return;
                }
                const uint id = reply.value();
                if (!tag.isEmpty()) {
                    idsByTag_.insert(tag, id);
                }
                if (!link.empty()) {
                    if (pending_.size() >= kMaxTrackedNotifications) {
                        pending_.clear(); // bounded: an old, never-closed notification is not worth a leak
                        idsByTag_.clear();
                    }
                    pending_.insert(id, Pending{.link = link, .tag = tag});
                }
            });
}

void DBusNotificationService::onActionInvoked(uint id, const QString& actionKey) {
    Q_UNUSED(actionKey) // "default" (body click) and a button both open the link
    const auto it = pending_.constFind(id);
    if (it == pending_.constEnd()) {
        return; // not one of ours (the signal is broadcast to every client)
    }
    const std::string link = it->link;
    notifyActivated(link);
}

void DBusNotificationService::onNotificationClosed(uint id, uint reason) {
    Q_UNUSED(reason)
    const auto it = pending_.constFind(id);
    if (it == pending_.constEnd()) {
        return;
    }
    if (!it->tag.isEmpty()) {
        idsByTag_.remove(it->tag);
    }
    pending_.remove(id);
}

} // namespace aedst::platform
