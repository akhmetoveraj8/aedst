#include "aedst/platform/notification_service.hpp"

#include <QMetaMethod>

#include <memory>
#include <string_view>

#if defined(AEDST_PLATFORM_HAS_DBUS)
#include "dbus_notification_service.hpp"
#endif
#if defined(AEDST_PLATFORM_HAS_WINDOWS_TOAST)
#include "windows_toast_notification_service.hpp"
#endif

namespace aedst::platform {
namespace {

constexpr qsizetype kMaxTitleChars = 256;
constexpr qsizetype kMaxBodyChars = 2048;

class ForwardingNotificationService final : public NotificationService {
public:
    explicit ForwardingNotificationService(NotificationService& target) : target_(target) {}

    [[nodiscard]] bool isAvailable() const override { return target_.isAvailable(); }

    void show(std::string_view title, std::string_view body, NotificationSeverity severity) override {
        target_.show(title, body, severity);
    }

    void showRequest(const NotificationRequest& request) override { target_.showRequest(request); }

    void setActivationHandler(NotificationActivationHandler handler) override {
        target_.setActivationHandler(std::move(handler));
    }

private:
    NotificationService& target_;
};

} // namespace

InAppNotificationService::InAppNotificationService(QObject* parent) : QObject(parent) {}

bool InAppNotificationService::isAvailable() const {
    return isSignalConnected(QMetaMethod::fromSignal(&InAppNotificationService::notificationRaised));
}

void InAppNotificationService::show(std::string_view title, std::string_view body, NotificationSeverity severity) {
    const QString qTitle = QString::fromUtf8(title.data(), static_cast<qsizetype>(title.size())).left(kMaxTitleChars);
    const QString qBody = QString::fromUtf8(body.data(), static_cast<qsizetype>(body.size())).left(kMaxBodyChars);
    const std::string_view severityName = toString(severity);
    emit notificationRaised(qTitle, qBody,
                            QString::fromUtf8(severityName.data(), static_cast<qsizetype>(severityName.size())));
}

std::unique_ptr<NotificationService> makeNotificationService(NotificationService& inAppFallback,
                                                             NotificationService* nativeDesktop) {
#if defined(AEDST_PLATFORM_HAS_WINDOWS_TOAST)
    // Native toast with an action button and click activation. The tray balloon (or the in-app toast) takes over
    // when Windows refuses toasts (disabled by the user or by policy, no Start Menu shortcut, COM failure).
    NotificationService& toastFallback =
        (nativeDesktop != nullptr && nativeDesktop->isAvailable()) ? *nativeDesktop : inAppFallback;
    auto toast = std::make_unique<WindowsToastNotificationService>(toastFallback);
    if (toast->isAvailable()) {
        return toast;
    }
#endif
#if defined(AEDST_PLATFORM_HAS_DBUS)
    auto native = std::make_unique<DBusNotificationService>(inAppFallback);
    if (native->isAvailable()) {
        return native;
    }
#endif
    if (nativeDesktop != nullptr && nativeDesktop->isAvailable()) {
        return std::make_unique<ForwardingNotificationService>(*nativeDesktop);
    }
    return std::make_unique<ForwardingNotificationService>(inAppFallback);
}

} // namespace aedst::platform
