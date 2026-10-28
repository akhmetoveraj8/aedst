#pragma once

#include "aedst/platform/notification_service.hpp"

#include <QObject>
#include <QString>

#include <memory>
#include <string>
#include <string_view>

class QSystemTrayIcon;

namespace aedst::platform {

/// Native desktop notifications through QSystemTrayIcon::showMessage:
///  - Windows: a toast/balloon from the tray icon (no AppUserModelID shortcut or
///    WinRT code needed);
///  - Linux: the StatusNotifier/XEmbed tray; on Linux the D-Bus service in
///    makeNotificationService() is preferred when available.
///
/// QSystemTrayIcon lives in Qt Widgets and requires a QApplication (not just
/// QGuiApplication): App/main.cpp creates a QApplication for exactly this reason
/// (docs/adr/0022-telemetry-media-notifications.md). No Widgets UI is built.
///
/// Every message also goes to `inAppFallback` when the tray is unavailable, so a
/// headless/test session or a desktop without a tray still shows an AedstToast.
/// Text is truncated like InAppNotificationService. Must live on the GUI thread.
class TrayNotificationService final : public QObject, public NotificationService {
    Q_OBJECT
    Q_PROPERTY(int badgeCount READ badgeCount WRITE setBadgeCount NOTIFY badgeCountChanged)

public:
    explicit TrayNotificationService(NotificationService& inAppFallback, QObject* parent = nullptr);
    TrayNotificationService(const TrayNotificationService&) = delete;
    TrayNotificationService& operator=(const TrayNotificationService&) = delete;
    TrayNotificationService(TrayNotificationService&&) = delete;
    TrayNotificationService& operator=(TrayNotificationService&&) = delete;
    ~TrayNotificationService() override;

    /// QApplication is running, a system tray exists and it can show balloon messages.
    [[nodiscard]] static bool isSupported();

    [[nodiscard]] bool isAvailable() const override;
    void show(std::string_view title, std::string_view body, NotificationSeverity severity) override;
    /// Clicking the balloon reports `request.link` to the activation handler. The tray has no action buttons
    /// and shows one balloon at a time, so only the most recent link can be activated.
    void showRequest(const NotificationRequest& request) override;

    /// Shown in the tray tooltip ("AEDST - 3 unread"); 0 hides the count.
    [[nodiscard]] int badgeCount() const noexcept { return badgeCount_; }

    void setBadgeCount(int count);

signals:
    /// The user clicked the last shown message (bring the window forward / open the inbox).
    void messageClicked();
    /// The tray icon itself was clicked.
    void activated();
    void badgeCountChanged();

private:
    void updateToolTip();

    NotificationService& fallback_;
    std::unique_ptr<QSystemTrayIcon> tray_;
    std::string lastLink_;
    int badgeCount_{0};
};

} // namespace aedst::platform
