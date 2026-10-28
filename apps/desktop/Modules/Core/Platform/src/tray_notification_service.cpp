#include "aedst/platform/tray_notification_service.hpp"

#include <QApplication>
#include <QColor>
#include <QFont>
#include <QGuiApplication>
#include <QIcon>
#include <QPainter>
#include <QPalette>
#include <QPixmap>
#include <QSystemTrayIcon>

#include <algorithm>
#include <utility>

namespace aedst::platform {
namespace {

constexpr qsizetype kMaxTitleChars = 256;
constexpr qsizetype kMaxBodyChars = 2048;
constexpr int kMessageTimeoutMs = 8000;

[[nodiscard]] QString toQString(std::string_view text, qsizetype maxChars) {
    return QString::fromUtf8(text.data(), static_cast<qsizetype>(text.size())).left(maxChars);
}

/// The window icon when the app ships one (App/resources/icons), otherwise a plain
/// generated glyph: a tray entry with a null icon is silently not shown on Windows.
[[nodiscard]] QIcon trayIcon() {
    QIcon icon = QGuiApplication::windowIcon();
    if (!icon.isNull()) {
        return icon;
    }
    QPixmap pixmap(32, 32);
    pixmap.fill(Qt::transparent);
    QPainter painter(&pixmap);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setBrush(QGuiApplication::palette().color(QPalette::WindowText));
    painter.setPen(Qt::NoPen);
    painter.drawRoundedRect(QRectF(2, 2, 28, 28), 6, 6);
    painter.setPen(QGuiApplication::palette().color(QPalette::Window));
    QFont font = painter.font();
    font.setBold(true);
    font.setPixelSize(18);
    painter.setFont(font);
    painter.drawText(pixmap.rect(), Qt::AlignCenter, QStringLiteral("A"));
    painter.end();
    return QIcon(pixmap);
}

[[nodiscard]] QSystemTrayIcon::MessageIcon toMessageIcon(NotificationSeverity severity) {
    switch (severity) {
    case NotificationSeverity::Warning:
        return QSystemTrayIcon::Warning;
    case NotificationSeverity::Error:
        return QSystemTrayIcon::Critical;
    case NotificationSeverity::Info:
        break;
    }
    return QSystemTrayIcon::Information;
}

} // namespace

TrayNotificationService::TrayNotificationService(NotificationService& inAppFallback, QObject* parent)
    : QObject(parent), fallback_(inAppFallback) {
    if (!isSupported()) {
        return;
    }
    tray_ = std::make_unique<QSystemTrayIcon>(trayIcon());
    updateToolTip();
    connect(tray_.get(), &QSystemTrayIcon::messageClicked, this, [this]() {
        emit messageClicked();
        notifyActivated(std::exchange(lastLink_, std::string{}));
    });
    connect(tray_.get(), &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick) {
            emit activated();
        }
    });
    tray_->show();
}

TrayNotificationService::~TrayNotificationService() = default;

bool TrayNotificationService::isSupported() {
    // qobject_cast: a QGuiApplication-only process (unit tests) must not touch Qt Widgets.
    return qobject_cast<QApplication*>(QCoreApplication::instance()) != nullptr &&
           QSystemTrayIcon::isSystemTrayAvailable() && QSystemTrayIcon::supportsMessages();
}

bool TrayNotificationService::isAvailable() const {
    return (tray_ && tray_->isVisible()) || fallback_.isAvailable();
}

void TrayNotificationService::show(std::string_view title, std::string_view body, NotificationSeverity severity) {
    lastLink_.clear();
    if (!tray_ || !tray_->isVisible()) {
        fallback_.show(title, body, severity);
        return;
    }
    tray_->showMessage(toQString(title, kMaxTitleChars), toQString(body, kMaxBodyChars), toMessageIcon(severity),
                       kMessageTimeoutMs);
}

void TrayNotificationService::showRequest(const NotificationRequest& request) {
    show(request.title, request.body, request.severity);
    if (tray_ && tray_->isVisible()) {
        lastLink_ = request.link; // show() cleared it; set after, so a click on this balloon activates it
    }
}

void TrayNotificationService::setBadgeCount(int count) {
    count = std::max(count, 0);
    if (count == badgeCount_) {
        return;
    }
    badgeCount_ = count;
    updateToolTip();
    emit badgeCountChanged();
}

void TrayNotificationService::updateToolTip() {
    if (!tray_) {
        return;
    }
    const QString name = QGuiApplication::applicationDisplayName().isEmpty()
                             ? QGuiApplication::applicationName()
                             : QGuiApplication::applicationDisplayName();
    tray_->setToolTip(badgeCount_ > 0 ? tr("%1 - %n unread", nullptr, badgeCount_).arg(name) : name);
}

} // namespace aedst::platform
