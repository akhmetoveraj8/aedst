#include "Presentation/notification_realtime.hpp"

#include "aedst/logging/log_categories.hpp"
#include "aedst/network/call_options.hpp"

#include <QRandomGenerator>

#include <algorithm>
#include <utility>

namespace aedst::feature::notifications {

NotificationRealtime::NotificationRealtime(std::shared_ptr<NotificationStream> stream, Timing timing,
                                           std::function<double()> jitter, QObject* parent)
    : QObject(parent), stream_(std::move(stream)), timing_(timing), jitter_(std::move(jitter)) {
    if (!jitter_) {
        jitter_ = [] { return QRandomGenerator::global()->generateDouble(); };
    }
    reconnectTimer_.setSingleShot(true);
    idleTimer_.setSingleShot(true);
    connect(&reconnectTimer_, &QTimer::timeout, this, &NotificationRealtime::connectNow);
    connect(&idleTimer_, &QTimer::timeout, this, [this]() {
        qCWarning(lcNotifications, "Notification stream idle for %lld ms; reconnecting",
                  static_cast<long long>(timing_.idleTimeout.count()));
        cancelStream();
        handleEnd(StreamEnd{.kind = StreamEndKind::Transient, .message = "idle timeout"});
    });
}

NotificationRealtime::~NotificationRealtime() {
    cancelStream();
}

QString NotificationRealtime::toString(Mode mode) {
    switch (mode) {
    case Mode::Stopped:
        return QStringLiteral("stopped");
    case Mode::Connecting:
        return QStringLiteral("connecting");
    case Mode::Streaming:
        return QStringLiteral("streaming");
    case Mode::Backoff:
        return QStringLiteral("backoff");
    case Mode::Polling:
        return QStringLiteral("polling");
    }
    return QStringLiteral("unknown");
}

void NotificationRealtime::setMode(Mode mode) {
    if (mode == mode_) {
        return;
    }
    qCInfo(lcNotifications, "Notification delivery: %s -> %s", qUtf8Printable(toString(mode_)),
           qUtf8Printable(toString(mode)));
    mode_ = mode;
    emit modeChanged();
}

void NotificationRealtime::start() {
    if (mode_ != Mode::Stopped) {
        return;
    }
    failures_ = 0;
    connectNow();
}

void NotificationRealtime::stop() {
    cancelStream();
    reconnectTimer_.stop();
    idleTimer_.stop();
    lastEventId_.clear();
    failures_ = 0;
    setMode(Mode::Stopped);
}

void NotificationRealtime::reconnectNow() {
    if (mode_ == Mode::Stopped) {
        return;
    }
    qCInfo(lcNotifications, "Reconnecting the notification stream after resume");
    failures_ = 0; // the outage was the machine's, not the server's
    connectNow();
}

void NotificationRealtime::cancelStream() {
    ++connection_; // late callbacks of the old attempt are ignored
    idleTimer_.stop();
    if (cancel_) {
        auto cancel = std::exchange(cancel_, nullptr);
        cancel();
    }
}

void NotificationRealtime::connectNow() {
    cancelStream();
    reconnectTimer_.stop();
    setMode(Mode::Connecting);
    const quint64 connection = connection_;
    connectedAt_ = std::chrono::steady_clock::now();
    armIdleWatchdog(); // also covers a connection that never delivers its first event
    cancel_ = stream_->open(
        lastEventId_,
        NotificationStream::Callbacks{
            .onEvent = [this, connection](NotificationEvent event) { onEvent(connection, std::move(event)); },
            .onEnd = [this, connection](StreamEnd end) { onEnd(connection, std::move(end)); },
        });
}

void NotificationRealtime::armIdleWatchdog() {
    idleTimer_.start(static_cast<int>(timing_.idleTimeout.count()));
}

void NotificationRealtime::onEvent(quint64 connection, NotificationEvent event) {
    if (connection != connection_) {
        return;
    }
    armIdleWatchdog();
    if (mode_ != Mode::Streaming) {
        connectedAt_ = std::chrono::steady_clock::now();
        setMode(Mode::Streaming);
    }
    if (std::holds_alternative<HeartbeatEvent>(event.payload)) {
        return;
    }
    if (std::holds_alternative<ResyncRequiredEvent>(event.payload)) {
        lastEventId_.clear();
        emit resyncRequired();
        return;
    }
    if (!event.id.empty()) {
        lastEventId_ = event.id;
    }
    emit eventReceived(event);
}

std::chrono::milliseconds NotificationRealtime::jittered(std::chrono::milliseconds base) const {
    const double unit = std::clamp(jitter_(), 0.0, 1.0);
    return std::chrono::milliseconds{
        static_cast<std::chrono::milliseconds::rep>(static_cast<double>(base.count()) * (0.5 + 0.5 * unit))};
}

std::chrono::milliseconds NotificationRealtime::backoffDelay() const {
    const network::RetryPolicy policy{.maxAttempts = 1'000,
                                      .initialBackoff = timing_.initialBackoff,
                                      .maxBackoff = timing_.maxBackoff,
                                      .multiplier = timing_.multiplier};
    // failures_ == 1 -> the first retry delay (initialBackoff); delayBefore() already applies the jitter.
    return policy.delayBefore(std::max(failures_, 1) + 1, std::clamp(jitter_(), 0.0, 1.0));
}

void NotificationRealtime::scheduleReconnect(std::chrono::milliseconds delay) {
    reconnectTimer_.start(static_cast<int>(std::max<std::chrono::milliseconds::rep>(delay.count(), 1)));
}

void NotificationRealtime::onEnd(quint64 connection, StreamEnd end) {
    if (connection != connection_) {
        return; // a callback of a stream that was cancelled or replaced
    }
    cancel_ = nullptr;
    handleEnd(std::move(end));
}

void NotificationRealtime::handleEnd(StreamEnd end) {
    idleTimer_.stop();
    ++connection_;

    const bool wasStable =
        mode_ == Mode::Streaming && std::chrono::steady_clock::now() - connectedAt_ >= timing_.stableAfter;
    qCInfo(lcNotifications, "Notification stream ended (%d): %s", static_cast<int>(end.kind), end.message.c_str());

    switch (end.kind) {
    case StreamEndKind::Unauthenticated:
        reconnectTimer_.stop();
        lastEventId_.clear();
        setMode(Mode::Stopped);
        emit unauthenticated(QString::fromStdString(end.message));
        return;
    case StreamEndKind::Unsupported:
        failures_ = 0;
        setMode(Mode::Polling);
        scheduleReconnect(jittered(timing_.unsupportedRetryInterval));
        return;
    case StreamEndKind::Rejected:
        // Most likely a resume point the server refuses: start from "now" and let the owner resync.
        lastEventId_.clear();
        failures_ = 0;
        setMode(Mode::Polling);
        scheduleReconnect(jittered(timing_.pollingRetryInterval));
        emit resyncRequired();
        return;
    case StreamEndKind::Ended:
    case StreamEndKind::Transient:
        break;
    }

    failures_ = wasStable ? 1 : failures_ + 1;
    if (failures_ >= timing_.failuresBeforePolling) {
        setMode(Mode::Polling);
        scheduleReconnect(jittered(timing_.pollingRetryInterval));
        return;
    }
    setMode(Mode::Backoff);
    scheduleReconnect(backoffDelay());
}

} // namespace aedst::feature::notifications
