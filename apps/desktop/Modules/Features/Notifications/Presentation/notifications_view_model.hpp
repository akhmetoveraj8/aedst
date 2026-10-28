#pragma once

#include "Domain/new_notification_detector.hpp"
#include "Domain/notification_stream.hpp"
#include "Presentation/notification_list_model.hpp"
#include "Presentation/notification_realtime.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

#include <memory>
#include <string>

namespace aedst::analytics {
class AnalyticsTracker;
} // namespace aedst::analytics

namespace aedst::core {
class ErrorSink;
} // namespace aedst::core

namespace aedst::navigation {
class Router;
} // namespace aedst::navigation

namespace aedst::platform {
class NotificationService;
} // namespace aedst::platform

namespace aedst::feature::notifications {

class NotificationRepository;

/// Inbox, unread badge, mark read, preferences, and native desktop notifications.
///
/// Delivery model on desktop (no FCM/APNs/Web Push channel exists for it):
///  - STREAM: when a NotificationStream is installed (setStream) and the server offers
///    WatchNotifications, events arrive live: a created notification is announced at once, the
///    unread counter is whatever the server last said. Polling is OFF while the stream is healthy.
///  - POLLING: otherwise, and whenever the stream is not healthy (connecting, backing off, repeatedly
///    failing, or the RPC is missing on the server), the client POLLS GetUnreadCount
///    (kPollIntervalMs while the window is active, kBackgroundPollIntervalMs otherwise; exponential
///    backoff up to kMaxBackoffMs on retryable errors). When the count rises it fetches the newest unread
///    notifications. NotificationRealtime owns reconnects, resume by event id and the fall back.
/// NewNotificationDetector picks what to show through platform::NotificationService (Windows toast /
/// D-Bus / tray / in-app fallback), honouring the server-side preferences, and a click on a native
/// notification opens its link (notificationActivated -> Router). Everything runs only between start()
/// (signed in) and stop() (signed out).
class NotificationsViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(int unreadCount READ unreadCount NOTIFY unreadCountChanged)
    Q_PROPERTY(QAbstractItemModel* inbox READ inbox CONSTANT)
    Q_PROPERTY(bool unreadOnly READ unreadOnly WRITE setUnreadOnly NOTIFY unreadOnlyChanged)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(bool hasMore READ hasMore NOTIFY hasMoreChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)
    // Preferences (aedst.notifications.v1.Preferences).
    Q_PROPERTY(bool preferencesLoaded READ preferencesLoaded NOTIFY preferencesChanged)
    Q_PROPERTY(bool desktopNotifications READ desktopNotifications NOTIFY preferencesChanged)
    Q_PROPERTY(bool taskCompleted READ taskCompleted NOTIFY preferencesChanged)
    Q_PROPERTY(bool taskDueSoon READ taskDueSoon NOTIFY preferencesChanged)
    Q_PROPERTY(bool mediaReady READ mediaReady NOTIFY preferencesChanged)
    Q_PROPERTY(bool isSavingPreferences READ isSavingPreferences NOTIFY isSavingPreferencesChanged)
    // "stream" while live events are flowing, "polling" otherwise (diagnostics, settings screen).
    Q_PROPERTY(QString deliveryMode READ deliveryMode NOTIFY deliveryModeChanged)

public:
    static NotificationsViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<NotificationsViewModel>::create(engine, script);
    }

    static constexpr int kPollIntervalMs = 30'000;
    static constexpr int kBackgroundPollIntervalMs = 120'000;
    static constexpr int kMaxBackoffMs = 300'000;

    NotificationsViewModel(std::shared_ptr<NotificationRepository> repository, std::shared_ptr<core::ErrorSink> errors,
                           std::shared_ptr<analytics::AnalyticsTracker> analytics,
                           platform::NotificationService* desktopNotifier, navigation::Router* router,
                           QObject* parent = nullptr);

    [[nodiscard]] int unreadCount() const noexcept { return unreadCount_; }

    [[nodiscard]] QAbstractItemModel* inbox() noexcept { return &inbox_; }

    [[nodiscard]] NotificationListModel& inboxModel() noexcept { return inbox_; }

    [[nodiscard]] bool unreadOnly() const noexcept { return unreadOnly_; }

    void setUnreadOnly(bool unreadOnly);

    [[nodiscard]] bool isLoading() const noexcept { return isLoading_; }

    [[nodiscard]] bool hasMore() const { return !nextPageToken_.empty(); }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    [[nodiscard]] bool preferencesLoaded() const noexcept { return preferencesLoaded_; }

    [[nodiscard]] bool desktopNotifications() const noexcept { return preferences_.pushEnabled; }

    [[nodiscard]] bool taskCompleted() const noexcept { return preferences_.taskCompleted; }

    [[nodiscard]] bool taskDueSoon() const noexcept { return preferences_.taskDueSoon; }

    [[nodiscard]] bool mediaReady() const noexcept { return preferences_.mediaReady; }

    [[nodiscard]] bool isSavingPreferences() const noexcept { return isSavingPreferences_; }

    [[nodiscard]] QString deliveryMode() const;

    /// Installs the live channel. Call once before start(); without it the client only polls.
    void setStream(std::shared_ptr<NotificationStream> stream, NotificationRealtime::Timing timing = {});

    [[nodiscard]] NotificationRealtime* realtime() noexcept { return realtime_.get(); }

    /// Signed in: reset the detector to "now", load preferences, poll immediately.
    Q_INVOKABLE void start();
    /// Signed out: stop polling and forget everything user-specific.
    Q_INVOKABLE void stop();
    /// Window became active/inactive: poll faster while the user looks at the app.
    Q_INVOKABLE void setForeground(bool foreground);
    /// Reachability from ConnectivityMonitor: offline stops the poll timer (no request can succeed); coming back
    /// online polls immediately. The stream (when present) reconnects on its own.
    void setOnline(bool online);

    [[nodiscard]] bool isOnline() const noexcept { return online_; }

    /// The machine woke up from sleep: replace the (dead) stream and poll once. No-op while signed out or offline.
    void onSystemResumed();
    Q_INVOKABLE void pollNow();

    Q_INVOKABLE void reload();
    Q_INVOKABLE void loadMore();
    Q_INVOKABLE void markRead(const QString& notificationId);
    Q_INVOKABLE void markAllRead();
    /// Marks the row read and opens its link (allow-listed by Router::openLink).
    Q_INVOKABLE void open(int row);
    Q_INVOKABLE void openPreferences();
    Q_INVOKABLE void loadPreferences();
    Q_INVOKABLE void savePreferences(bool desktopNotifications, bool taskCompleted, bool taskDueSoon, bool mediaReady);

signals:
    void unreadCountChanged();
    void unreadOnlyChanged();
    void isLoadingChanged();
    void hasMoreChanged();
    void errorMessageChanged();
    void preferencesChanged();
    void isSavingPreferencesChanged();
    void deliveryModeChanged();
    /// The user clicked a native notification: bring the window forward and open `link`.
    void notificationActivated(const QString& link);

private:
    void onUnreadCount(int count);
    void onStreamEvent(const NotificationEvent& event);
    void onDeliveryModeChanged();
    void announce(const std::vector<Notification>& unread);
    void announceNew();
    void scheduleNextPoll(bool failed);
    void setUnreadCount(int count);
    void setLoading(bool loading);
    void setErrorMessage(const QString& message);
    void setNextPageToken(std::string token);

    std::shared_ptr<NotificationRepository> repository_;
    std::shared_ptr<core::ErrorSink> errors_;
    std::shared_ptr<analytics::AnalyticsTracker> analytics_;
    platform::NotificationService* desktopNotifier_;
    navigation::Router* router_;

    NotificationListModel inbox_;
    NewNotificationDetector detector_;
    NotificationPreferences preferences_;
    QTimer pollTimer_;
    std::unique_ptr<NotificationRealtime> realtime_;
    QString errorMessage_;
    std::string nextPageToken_;
    int unreadCount_{0};
    int failedPolls_{0};
    bool running_{false};
    bool foreground_{true};
    bool online_{true};
    bool unreadOnly_{false};
    bool isLoading_{false};
    bool preferencesLoaded_{false};
    bool isSavingPreferences_{false};
    bool pollInFlight_{false};
    quint64 session_{0};
};

} // namespace aedst::feature::notifications
