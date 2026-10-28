#pragma once

// Private to AedstPlatform; compiled only when Qt6::DBus was found on a
// Linux (AEDST_PLATFORM_HAS_DBUS).

#include "aedst/platform/notification_service.hpp"

#include <QHash>
#include <QObject>
#include <QString>

#include <string>
#include <string_view>
#include <utility>

namespace aedst::platform {

/// org.freedesktop.Notifications over the session bus: Notify (fire-and-forget, the in-app fallback is
/// used only when the call cannot be sent), ActionInvoked (click on the body = the "default" action, or a
/// button) and NotificationClosed (forget the link of a closed notification).
///
/// A request with a tag replaces the previous notification of that tag (`replaces_id`), so a burst of events
/// never stacks identical balloons. Text is escaped before it reaches the server (body markup).
class DBusNotificationService final : public QObject, public NotificationService {
    Q_OBJECT

public:
    explicit DBusNotificationService(NotificationService& fallback);

    [[nodiscard]] bool isAvailable() const override;
    void show(std::string_view title, std::string_view body, NotificationSeverity severity) override;
    void showRequest(const NotificationRequest& request) override;

    /// Clicks on a fallback's notifications (tray balloon) must reach the same handler.
    void setActivationHandler(NotificationActivationHandler handler) override {
        fallback_.setActivationHandler(handler);
        NotificationService::setActivationHandler(std::move(handler));
    }

private slots:
    void onActionInvoked(uint id, const QString& actionKey);
    void onNotificationClosed(uint id, uint reason);

private:
    struct Pending {
        std::string link;
        QString tag;
    };

    NotificationService& fallback_;
    bool available_;
    QHash<uint, Pending> pending_;  // server notification id -> what a click opens
    QHash<QString, uint> idsByTag_; // tag -> last server id (for replaces_id)
};

} // namespace aedst::platform
