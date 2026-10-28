#pragma once

#include "Domain/notification_stream.hpp"

#include <QObject>
#include <QString>
#include <QTimer>

#include <chrono>
#include <functional>
#include <memory>
#include <string>

namespace aedst::feature::notifications {

/// Keeps a NotificationStream open for a signed-in user and says when it can be trusted.
///
///  - Reconnect: exponential backoff with equal jitter after a transient end, reset only after a stream
///    stayed up for `stableAfter` (a server that accepts and immediately drops cannot make us hammer it).
///  - Resume: the id of the last event is passed to the next open(); a `ResyncRequired` event or a
///    rejected resume point clears it and asks the owner to refetch (resyncRequired()).
///  - Watchdog: no event, heartbeats included, for `idleTimeout` means a half-open connection; the stream is
///    cancelled and reopened.
///  - Degradation: after `failuresBeforePolling` consecutive failures, or when the server has no such RPC, the mode
///    becomes Polling and the owner falls back to polling GetUnreadCount. The stream is tried again every
///    `pollingRetryInterval` (`unsupportedRetryInterval` when the RPC is missing on the server).
///  - An `Unauthenticated` end stops everything: the session is over, the owner reports it.
///
/// The owner polls whenever isStreaming() is false and stops polling while it is true.
/// Single-threaded: lives on the thread that owns the stream callbacks.
class NotificationRealtime final : public QObject {
    Q_OBJECT

public:
    enum class Mode {
        Stopped,
        /// Opening a stream, nothing received yet.
        Connecting,
        /// Receiving events: polling is not needed.
        Streaming,
        /// Waiting to reconnect after a transient failure.
        Backoff,
        /// Streaming is unavailable for now; the owner polls. A retry is scheduled.
        Polling,
    };
    Q_ENUM(Mode)

    struct Timing {
        std::chrono::milliseconds initialBackoff{1'000};
        std::chrono::milliseconds maxBackoff{60'000};
        double multiplier{2.0};
        /// Silence longer than this means a dead connection (the server sends heartbeats every 25-30 s).
        std::chrono::milliseconds idleTimeout{90'000};
        /// A stream that lived at least this long counts as healthy when it ends.
        std::chrono::milliseconds stableAfter{10'000};
        int failuresBeforePolling{3};
        std::chrono::milliseconds pollingRetryInterval{300'000};
        std::chrono::milliseconds unsupportedRetryInterval{3'600'000};
    };

    explicit NotificationRealtime(std::shared_ptr<NotificationStream> stream, Timing timing = {},
                                  std::function<double()> jitter = {}, QObject* parent = nullptr);
    ~NotificationRealtime() override;

    void start();
    void stop();
    /// The machine woke up: its sockets are dead although nothing reported it. Drops the stream and opens a new one
    /// now, without waiting for the idle watchdog or a backoff. No-op while stopped.
    void reconnectNow();

    [[nodiscard]] Mode mode() const noexcept { return mode_; }

    [[nodiscard]] bool isStreaming() const noexcept { return mode_ == Mode::Streaming; }

    [[nodiscard]] const std::string& lastEventId() const noexcept { return lastEventId_; }

    [[nodiscard]] int consecutiveFailures() const noexcept { return failures_; }

    [[nodiscard]] static QString toString(Mode mode);

signals:
    void modeChanged();
    /// Created and unread-count events (heartbeats and resync markers are consumed here).
    void eventReceived(const aedst::feature::notifications::NotificationEvent& event);
    /// The server's backlog no longer covers us: refetch the unread count and the inbox.
    void resyncRequired();
    /// The session is over (token rejected and not refreshable).
    void unauthenticated(const QString& message);

private:
    void connectNow();
    void onEvent(quint64 connection, NotificationEvent event);
    void onEnd(quint64 connection, StreamEnd end);
    void handleEnd(StreamEnd end);
    void cancelStream();
    void scheduleReconnect(std::chrono::milliseconds delay);
    void setMode(Mode mode);
    [[nodiscard]] std::chrono::milliseconds backoffDelay() const;
    [[nodiscard]] std::chrono::milliseconds jittered(std::chrono::milliseconds base) const;
    void armIdleWatchdog();

    std::shared_ptr<NotificationStream> stream_;
    Timing timing_;
    std::function<double()> jitter_;
    NotificationStream::Cancel cancel_;
    QTimer reconnectTimer_;
    QTimer idleTimer_;

    Mode mode_{Mode::Stopped};
    std::string lastEventId_;
    int failures_{0};
    quint64 connection_{0};
    std::chrono::steady_clock::time_point connectedAt_{};
};

} // namespace aedst::feature::notifications

Q_DECLARE_METATYPE(aedst::feature::notifications::NotificationEvent)
