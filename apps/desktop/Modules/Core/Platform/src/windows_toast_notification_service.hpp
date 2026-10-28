#pragma once

// Private to AedstPlatform; compiled only on Windows.

#include "aedst/platform/notification_service.hpp"

#include <QObject>

#include <memory>
#include <string>
#include <string_view>
#include <utility>

namespace aedst::platform {

/// Native Windows toast notifications (Windows.UI.Notifications through C++/WinRT) with an action button and
/// click activation. Unpackaged desktop apps need two things Windows checks before it shows a toast:
///  - an AppUserModelID (AUMID), set for the process here;
///  - a Start Menu shortcut carrying that AUMID. The installer creates it and the service only VERIFIES it; when no
///    shortcut carries the AUMID, the service writes `%APPDATA%\Microsoft\Windows\Start Menu\Programs\AEDST.lnk` as a
///    fallback (which the uninstaller removes).
/// Activation works while the process runs (ToastNotification.Activated, marshalled to the GUI thread). A click
/// after the app has exited starts the app through the shortcut without the link: opening it needs the COM
/// activator / protocol registration the installer will provide (docs/adr/0027-realtime-notifications.md).
///
/// isAvailable() is false when the toast platform refuses (notifications disabled by the user or policy, COM
/// failure); callers then fall back to the tray balloon. Must live on the GUI thread.
class WindowsToastNotificationService final : public QObject, public NotificationService {
    Q_OBJECT

public:
    /// `fallback` receives requests when the toast cannot be shown.
    explicit WindowsToastNotificationService(NotificationService& fallback, QObject* parent = nullptr);
    ~WindowsToastNotificationService() override;

    [[nodiscard]] bool isAvailable() const override;
    void show(std::string_view title, std::string_view body, NotificationSeverity severity) override;
    void showRequest(const NotificationRequest& request) override;

    /// Clicks on a fallback's notifications (tray balloon) must reach the same handler.
    void setActivationHandler(NotificationActivationHandler handler) override {
        fallback_.setActivationHandler(handler);
        NotificationService::setActivationHandler(std::move(handler));
    }

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
    NotificationService& fallback_;
    bool ready_{false};
};

} // namespace aedst::platform
