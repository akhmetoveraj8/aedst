#pragma once

#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <utility>

namespace aedst::platform {

enum class NotificationSeverity {
    Info,
    Warning,
    Error,
};

[[nodiscard]] constexpr std::string_view toString(NotificationSeverity severity) noexcept {
    switch (severity) {
    case NotificationSeverity::Warning:
        return "warning";
    case NotificationSeverity::Error:
        return "error";
    case NotificationSeverity::Info:
        break;
    }
    return "info";
}

/// A notification that can be clicked. Text is plain UTF-8 (implementations truncate and escape it).
struct NotificationRequest {
    std::string title;
    std::string body;
    NotificationSeverity severity{NotificationSeverity::Info};
    /// In-app route ("/tasks/<id>") opened when the user clicks the notification or its action button.
    /// Empty = informational only. Validated by the receiver (Router::openLink allow-list), not here.
    std::string link;
    /// A newer notification with the same tag replaces the older one instead of stacking.
    std::string tag;
    /// Text of the action button ("Open"); empty = no button (the notification body stays clickable).
    std::string actionLabel;
};

/// Invoked on the GUI thread when the user activates a notification that had a link.
using NotificationActivationHandler = std::function<void(const std::string& link)>;

/// Shows a user-visible notification. Text is plain UTF-8; implementations
/// truncate and escape it, so callers can pass server-provided strings.
class NotificationService {
public:
    NotificationService() = default;
    NotificationService(const NotificationService&) = delete;
    NotificationService& operator=(const NotificationService&) = delete;
    NotificationService(NotificationService&&) = delete;
    NotificationService& operator=(NotificationService&&) = delete;
    virtual ~NotificationService() = default;

    /// Runtime capability check (is there anything that can display this?).
    [[nodiscard]] virtual bool isAvailable() const = 0;
    virtual void show(std::string_view title, std::string_view body, NotificationSeverity severity) = 0;

    /// Clickable variant. Services without activation support (the in-app toast) just show the text.
    virtual void showRequest(const NotificationRequest& request) {
        show(request.title, request.body, request.severity);
    }

    /// Where activations of showRequest() notifications are reported. Services that wrap another one forward it.
    virtual void setActivationHandler(NotificationActivationHandler handler) {
        activationHandler_ = std::move(handler);
    }

protected:
    /// Implementations call this (on the GUI thread) when the user clicked a notification with a link.
    void notifyActivated(const std::string& link) const {
        if (activationHandler_ && !link.empty()) {
            activationHandler_(link);
        }
    }

private:
    NotificationActivationHandler activationHandler_;
};

/// Universal fallback: does not display anything itself, it emits
/// notificationRaised() so QML can show an in-app AedstToast. `severity` is
/// "info" | "warning" | "error". isAvailable() is true once something (the QML
/// layer) is connected to the signal.
class InAppNotificationService final : public QObject, public NotificationService {
    Q_OBJECT
    QML_NAMED_ELEMENT(Notifications)
    QML_SINGLETON

public:
    static InAppNotificationService* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<InAppNotificationService>::create(engine, script);
    }

    explicit InAppNotificationService(QObject* parent = nullptr);

    [[nodiscard]] bool isAvailable() const override;
    void show(std::string_view title, std::string_view body, NotificationSeverity severity) override;

signals:
    void notificationRaised(const QString& title, const QString& body, const QString& severity);
};

/// Chooses the best available service:
///  - Linux with the optional Qt6::DBus and a running org.freedesktop.Notifications
///    server: a native desktop notification (falling back to `inAppFallback` if
///    the call cannot be sent);
///  - otherwise `nativeDesktop` when given and available - the app passes its
///    TrayNotificationService (QSystemTrayIcon::showMessage: Windows toast/balloon, Linux tray), see
///    tray_notification_service.hpp;
///  - otherwise forwards to `inAppFallback` (AedstToast).
/// `inAppFallback` and `nativeDesktop` must outlive the returned service.
///
/// Still not implemented: WinRT ToastNotificationManager (actions, history;
/// needs an AppUserModelID shortcut). The tray path covers "show a native notification"
/// without it.
[[nodiscard]] std::unique_ptr<NotificationService>
makeNotificationService(NotificationService& inAppFallback, NotificationService* nativeDesktop = nullptr);

} // namespace aedst::platform
