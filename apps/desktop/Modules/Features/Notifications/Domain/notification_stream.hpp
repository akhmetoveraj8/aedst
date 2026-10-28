#pragma once

#include "Domain/notification.hpp"

#include <functional>
#include <string>
#include <variant>

namespace aedst::feature::notifications {

/// Authoritative unread counter: sent first on every (re)connection and after the inbox changed on any device.
struct UnreadCountEvent {
    int unread{0};
};

/// A notification was created for the user.
struct NotificationCreatedEvent {
    Notification notification;
};

/// Keep-alive from the server; proves the connection is alive, changes nothing.
struct HeartbeatEvent {};

/// The resume point is older than the server's backlog: drop it and refetch (count and inbox).
struct ResyncRequiredEvent {};

/// One server event. `id` is the opaque, ordered resume token; it is empty for heartbeats.
struct NotificationEvent {
    std::string id;
    std::variant<UnreadCountEvent, NotificationCreatedEvent, HeartbeatEvent, ResyncRequiredEvent> payload;
};

enum class StreamEndKind {
    /// The server closed the stream cleanly.
    Ended,
    /// Connection lost, timeout, server busy or draining: reconnect with backoff.
    Transient,
    /// The server has no such RPC (older deployment): fall back to polling and look again much later.
    Unsupported,
    /// The token was rejected and could not be refreshed: the session is over.
    Unauthenticated,
    /// The server rejected the request itself (bad resume id, permission): do not hammer, fall back to polling.
    Rejected,
};

struct StreamEnd {
    StreamEndKind kind{StreamEndKind::Transient};
    std::string message;
};

/// Domain-owned port over the (future) aedst.notifications.v1.NotificationsService/WatchNotifications
/// server stream. Callbacks run on the owner thread. open() returns a function that cancels the stream
/// silently (no onEnd afterwards). onEnd is invoked exactly once unless cancelled.
class NotificationStream {
public:
    struct Callbacks {
        std::function<void(NotificationEvent)> onEvent;
        std::function<void(StreamEnd)> onEnd;
    };

    using Cancel = std::function<void()>;

    NotificationStream() = default;
    NotificationStream(const NotificationStream&) = delete;
    NotificationStream& operator=(const NotificationStream&) = delete;
    NotificationStream(NotificationStream&&) = delete;
    NotificationStream& operator=(NotificationStream&&) = delete;
    virtual ~NotificationStream() = default;

    /// `lastEventId` is the resume point (empty = from now).
    [[nodiscard]] virtual Cancel open(const std::string& lastEventId, Callbacks callbacks) = 0;
};

} // namespace aedst::feature::notifications
