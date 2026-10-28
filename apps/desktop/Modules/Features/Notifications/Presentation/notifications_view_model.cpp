#include "Presentation/notifications_view_model.hpp"

#include "Domain/notification_repository.hpp"
#include "Navigation/notifications_destinations.hpp"
#include "aedst/analytics/analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"
#include "aedst/navigation/router.hpp"
#include "aedst/platform/notification_service.hpp"

#include <QCoreApplication>
#include <QPointer>

#include <algorithm>
#include <chrono>
#include <utility>

namespace aedst::feature::notifications {

NotificationsViewModel::NotificationsViewModel(std::shared_ptr<NotificationRepository> repository,
                                               std::shared_ptr<core::ErrorSink> errors,
                                               std::shared_ptr<analytics::AnalyticsTracker> analytics,
                                               platform::NotificationService* desktopNotifier,
                                               navigation::Router* router, QObject* parent)
    : QObject(parent),
      repository_(std::move(repository)),
      errors_(std::move(errors)),
      analytics_(std::move(analytics)),
      desktopNotifier_(desktopNotifier),
      router_(router),
      detector_(std::chrono::system_clock::now()) {
    pollTimer_.setSingleShot(true);
    pollTimer_.setTimerType(Qt::VeryCoarseTimer); // 30 s and longer: one-second accuracy is plenty
    connect(&pollTimer_, &QTimer::timeout, this, &NotificationsViewModel::pollNow);
    if (desktopNotifier_ != nullptr) {
        // Marshalled to the GUI thread by the service; the link is validated by Router::openLink.
        desktopNotifier_->setActivationHandler(
            [guard = QPointer<NotificationsViewModel>(this)](const std::string& link) {
                if (guard) {
                    emit guard->notificationActivated(QString::fromStdString(link));
                }
            });
    }
}

QString NotificationsViewModel::deliveryMode() const {
    return realtime_ && realtime_->isStreaming() ? QStringLiteral("stream") : QStringLiteral("polling");
}

void NotificationsViewModel::setStream(std::shared_ptr<NotificationStream> stream,
                                       NotificationRealtime::Timing timing) {
    realtime_ = std::make_unique<NotificationRealtime>(std::move(stream), timing);
    connect(realtime_.get(), &NotificationRealtime::eventReceived, this, &NotificationsViewModel::onStreamEvent);
    connect(realtime_.get(), &NotificationRealtime::modeChanged, this, &NotificationsViewModel::onDeliveryModeChanged);
    connect(realtime_.get(), &NotificationRealtime::resyncRequired, this, [this]() {
        // The stream cannot replay what was missed: ask the server for the truth.
        pollNow();
        if (inbox_.count() > 0) {
            reload();
        }
    });
    connect(realtime_.get(), &NotificationRealtime::unauthenticated, this, [this](const QString& message) {
        if (errors_) {
            errors_->report(core::Error::unauthenticated(message.toStdString()), "notifications.stream",
                            core::ErrorVisibility::Silent);
        }
    });
}

void NotificationsViewModel::onDeliveryModeChanged() {
    emit deliveryModeChanged();
    if (!running_) {
        return;
    }
    if (realtime_ && realtime_->isStreaming()) {
        pollTimer_.stop(); // live events replace the poll
    } else if (!pollInFlight_ && !pollTimer_.isActive()) {
        pollNow(); // the stream is not delivering: catch up and keep polling
    }
}

void NotificationsViewModel::onStreamEvent(const NotificationEvent& event) {
    if (!running_) {
        return;
    }
    if (const auto* count = std::get_if<UnreadCountEvent>(&event.payload)) {
        setUnreadCount(count->unread); // authoritative; the created event already announced the item
        return;
    }
    if (const auto* created = std::get_if<NotificationCreatedEvent>(&event.payload)) {
        announce({created->notification});
        if (!created->notification.isRead()) {
            setUnreadCount(unreadCount_ + 1); // the server's counter event follows and corrects it
        }
        if (inbox_.count() > 0 && (!unreadOnly_ || !created->notification.isRead())) {
            inbox_.prependNotification(created->notification);
        }
    }
}

void NotificationsViewModel::start() {
    if (running_) {
        return;
    }
    running_ = true;
    ++session_;
    failedPolls_ = 0;
    detector_.reset(std::chrono::system_clock::now());
    loadPreferences();
    pollNow();
    if (realtime_) {
        realtime_->start();
    }
}

void NotificationsViewModel::stop() {
    running_ = false;
    if (realtime_) {
        realtime_->stop();
    }
    ++session_;
    pollTimer_.stop();
    pollInFlight_ = false;
    inbox_.setNotifications({});
    setNextPageToken({});
    setUnreadCount(0);
    setErrorMessage({});
    setLoading(false);
    preferences_ = {};
    preferencesLoaded_ = false;
    emit preferencesChanged();
}

void NotificationsViewModel::setForeground(bool foreground) {
    if (foreground == foreground_) {
        return;
    }
    foreground_ = foreground;
    if (running_ && foreground_) {
        pollNow(); // catch up immediately when the user comes back
    }
}

void NotificationsViewModel::pollNow() {
    if (!running_ || pollInFlight_ || !online_) {
        return;
    }
    pollTimer_.stop();
    pollInFlight_ = true;
    const quint64 session = session_;
    QPointer<NotificationsViewModel> guard(this);
    repository_->unreadCount([guard, session](core::Outcome<int> result) {
        if (!guard || session != guard->session_) {
            return;
        }
        guard->pollInFlight_ = false;
        if (!result) {
            // Background work: never a toast; Unauthenticated still reaches the sink (sign-out).
            if (guard->errors_) {
                guard->errors_->report(result.error(), "notifications.poll", core::ErrorVisibility::Silent);
            }
            guard->scheduleNextPoll(true);
            return;
        }
        guard->onUnreadCount(*result);
        guard->scheduleNextPoll(false);
    });
}

void NotificationsViewModel::scheduleNextPoll(bool failed) {
    if (!running_ || !online_) {
        return;
    }
    if (realtime_ && realtime_->isStreaming()) {
        return; // live events are flowing: no poll is needed
    }
    failedPolls_ = failed ? std::min(failedPolls_ + 1, 10) : 0;
    const int base = foreground_ ? kPollIntervalMs : kBackgroundPollIntervalMs;
    const qint64 backoff = static_cast<qint64>(base) << std::min(failedPolls_, 4);
    pollTimer_.start(static_cast<int>(std::min<qint64>(backoff, kMaxBackoffMs)));
}

void NotificationsViewModel::onUnreadCount(int count) {
    const int previous = unreadCount_;
    setUnreadCount(count);
    if (count > previous) {
        announceNew();
        if (inbox_.count() > 0) {
            reload(); // the inbox screen was opened before: keep it current
        }
    }
}

void NotificationsViewModel::announceNew() {
    if (desktopNotifier_ == nullptr) {
        return;
    }
    const quint64 session = session_;
    QPointer<NotificationsViewModel> guard(this);
    repository_->list(true, {}, 20, [guard, session](core::Outcome<NotificationPage> result) {
        if (!guard || session != guard->session_ || !result) {
            return;
        }
        guard->announce(result->notifications);
    });
}

void NotificationsViewModel::announce(const std::vector<Notification>& unread) {
    if (desktopNotifier_ == nullptr) {
        return;
    }
    const auto detected = detector_.detect(unread, preferences_);
    const std::string openLabel = QCoreApplication::translate("NotificationsViewModel", "Open").toStdString();
    for (const Notification& notification : detected.announce) {
        desktopNotifier_->showRequest(platform::NotificationRequest{.title = notification.title,
                                                                    .body = notification.body,
                                                                    .severity = platform::NotificationSeverity::Info,
                                                                    .link = notification.link,
                                                                    .tag = notification.id,
                                                                    .actionLabel = openLabel});
    }
    if (detected.overflow > 0) {
        const QString summary = QCoreApplication::translate("NotificationsViewModel", "%n more new notification(s)",
                                                            nullptr, static_cast<int>(detected.overflow));
        desktopNotifier_->showRequest(platform::NotificationRequest{.title = summary.toStdString(),
                                                                    .link = "/notifications",
                                                                    .tag = "aedst-summary",
                                                                    .actionLabel = openLabel});
    }
}

void NotificationsViewModel::setUnreadOnly(bool unreadOnly) {
    if (unreadOnly == unreadOnly_) {
        return;
    }
    unreadOnly_ = unreadOnly;
    emit unreadOnlyChanged();
    reload();
}

void NotificationsViewModel::reload() {
    setErrorMessage({});
    setLoading(true);
    const quint64 session = session_;
    QPointer<NotificationsViewModel> guard(this);
    repository_->list(unreadOnly_, {}, 50, [guard, session](core::Outcome<NotificationPage> result) {
        if (!guard || session != guard->session_) {
            return;
        }
        guard->setLoading(false);
        if (!result) {
            guard->setErrorMessage(QString::fromStdString(result.error().message));
            if (guard->errors_) {
                guard->errors_->report(result.error(), "notifications.inbox", core::ErrorVisibility::Silent);
            }
            return;
        }
        guard->inbox_.setNotifications(std::move(result->notifications));
        guard->setNextPageToken(std::move(result->nextPageToken));
    });
}

void NotificationsViewModel::loadMore() {
    if (!hasMore() || isLoading_) {
        return;
    }
    setLoading(true);
    const quint64 session = session_;
    QPointer<NotificationsViewModel> guard(this);
    repository_->list(unreadOnly_, nextPageToken_, 50, [guard, session](core::Outcome<NotificationPage> result) {
        if (!guard || session != guard->session_) {
            return;
        }
        guard->setLoading(false);
        if (!result) {
            if (guard->errors_) {
                guard->errors_->report(result.error(), "notifications.inbox");
            }
            return;
        }
        guard->inbox_.appendNotifications(std::move(result->notifications));
        guard->setNextPageToken(std::move(result->nextPageToken));
    });
}

void NotificationsViewModel::markRead(const QString& notificationId) {
    const std::vector<std::string> changed =
        inbox_.markRead({notificationId.toStdString()}, std::chrono::system_clock::now());
    if (changed.empty()) {
        return;
    }
    setUnreadCount(std::max(0, unreadCount_ - static_cast<int>(changed.size())));
    QPointer<NotificationsViewModel> guard(this);
    repository_->markRead(changed, [guard](core::VoidOutcome result) {
        if (guard && !result) {
            if (guard->errors_) {
                guard->errors_->report(result.error(), "notifications.mark_read");
            }
            guard->pollNow(); // re-sync the badge with the server
        }
    });
}

void NotificationsViewModel::markAllRead() {
    inbox_.markAllRead(std::chrono::system_clock::now());
    setUnreadCount(0);
    QPointer<NotificationsViewModel> guard(this);
    repository_->markAllRead([guard](core::Outcome<int> result) {
        if (guard && !result) {
            if (guard->errors_) {
                guard->errors_->report(result.error(), "notifications.mark_all_read");
            }
            guard->pollNow();
            guard->reload();
        }
    });
}

void NotificationsViewModel::open(int row) {
    const Notification* item = inbox_.at(row);
    if (item == nullptr) {
        return;
    }
    const QString link = QString::fromStdString(item->link);
    const std::string kind(toString(item->kind));
    markRead(QString::fromStdString(item->id)); // may invalidate `item`
    if (analytics_) {
        analytics_->track(analytics::events::kNotificationOpened, {{"kind", kind}});
    }
    if (router_ != nullptr && !link.isEmpty()) {
        router_->openLink(link);
    }
}

void NotificationsViewModel::setUnreadCount(int count) {
    if (count != unreadCount_) {
        unreadCount_ = count;
        emit unreadCountChanged();
    }
}

void NotificationsViewModel::setLoading(bool loading) {
    if (loading != isLoading_) {
        isLoading_ = loading;
        emit isLoadingChanged();
    }
}

void NotificationsViewModel::setErrorMessage(const QString& message) {
    if (message != errorMessage_) {
        errorMessage_ = message;
        emit errorMessageChanged();
    }
}

void NotificationsViewModel::setNextPageToken(std::string token) {
    const bool before = hasMore();
    nextPageToken_ = std::move(token);
    if (before != hasMore()) {
        emit hasMoreChanged();
    }
}

} // namespace aedst::feature::notifications
