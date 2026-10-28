#include "Presentation/notification_realtime.hpp"
#include "aedst/testing/fake_http_server.hpp"
#include "aedst/testing/test_main.hpp"

#include <QSignalSpy>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>
#include <vector>

namespace aedst::feature::notifications {
namespace {

using namespace std::chrono_literals;
using Mode = NotificationRealtime::Mode;
using aedst::testing::waitUntil;

/// Scripted NotificationStream: every open() is recorded, the test plays the server.
class FakeStream final : public NotificationStream {
public:
    struct Attempt {
        std::string lastEventId;
        Callbacks callbacks;
        bool cancelled{false};
    };

    [[nodiscard]] Cancel open(const std::string& lastEventId, Callbacks callbacks) override {
        attempts.push_back(std::make_shared<Attempt>(Attempt{lastEventId, std::move(callbacks), false}));
        auto attempt = attempts.back();
        return [attempt]() { attempt->cancelled = true; };
    }

    void emit(std::size_t index, std::string id, decltype(NotificationEvent::payload) payload) {
        attempts.at(index)->callbacks.onEvent(NotificationEvent{.id = std::move(id), .payload = std::move(payload)});
    }

    void heartbeat(std::size_t index) { emit(index, {}, HeartbeatEvent{}); }

    void end(std::size_t index, StreamEndKind kind, std::string message = "ended") {
        attempts.at(index)->callbacks.onEnd(StreamEnd{.kind = kind, .message = std::move(message)});
    }

    std::vector<std::shared_ptr<Attempt>> attempts;
};

NotificationRealtime::Timing fastTiming() {
    return NotificationRealtime::Timing{.initialBackoff = 5ms,
                                        .maxBackoff = 20ms,
                                        .multiplier = 2.0,
                                        .idleTimeout = 150ms,
                                        .stableAfter = 40ms,
                                        .failuresBeforePolling = 3,
                                        .pollingRetryInterval = 120ms,
                                        .unsupportedRetryInterval = 250ms};
}

class NotificationRealtimeTest : public ::testing::Test {
protected:
    void SetUp() override {
        stream = std::make_shared<FakeStream>();
        realtime = std::make_unique<NotificationRealtime>(stream, fastTiming(), [] { return 1.0; });
    }

    bool waitForAttempts(std::size_t count, std::chrono::milliseconds timeout = 2s) {
        return waitUntil([&] { return stream->attempts.size() >= count; }, timeout);
    }

    std::shared_ptr<FakeStream> stream;
    std::unique_ptr<NotificationRealtime> realtime;
};

TEST_F(NotificationRealtimeTest, ConnectsAndBecomesStreamingOnTheFirstEvent) {
    QSignalSpy forwarded(realtime.get(), &NotificationRealtime::eventReceived);
    QSignalSpy modes(realtime.get(), &NotificationRealtime::modeChanged);

    realtime->start();
    EXPECT_EQ(realtime->mode(), Mode::Connecting);
    ASSERT_EQ(stream->attempts.size(), 1U);
    EXPECT_TRUE(stream->attempts[0]->lastEventId.empty());
    EXPECT_FALSE(realtime->isStreaming());

    stream->heartbeat(0);

    EXPECT_EQ(realtime->mode(), Mode::Streaming);
    EXPECT_TRUE(realtime->isStreaming());
    EXPECT_EQ(forwarded.count(), 0) << "heartbeats keep the stream alive but are not events";
    EXPECT_EQ(modes.count(), 2); // Stopped -> Connecting -> Streaming
}

TEST_F(NotificationRealtimeTest, EventsAreForwardedAndTheLastIdIsUsedToResume) {
    QSignalSpy forwarded(realtime.get(), &NotificationRealtime::eventReceived);
    realtime->start();

    stream->emit(0, "e1", NotificationCreatedEvent{Notification{.id = "n1", .title = "hello"}});
    stream->emit(0, "e2", UnreadCountEvent{3});
    stream->heartbeat(0); // no id: must not overwrite the resume point

    EXPECT_EQ(forwarded.count(), 2);
    EXPECT_EQ(realtime->lastEventId(), "e2");

    stream->end(0, StreamEndKind::Transient, "connection reset");
    EXPECT_EQ(realtime->mode(), Mode::Backoff);
    ASSERT_TRUE(waitForAttempts(2));
    EXPECT_EQ(stream->attempts[1]->lastEventId, "e2") << "the new stream resumes after the last event";
}

TEST_F(NotificationRealtimeTest, ConsecutiveFailuresBackOffThenFallBackToPolling) {
    realtime->start();

    stream->end(0, StreamEndKind::Transient); // failure 1
    EXPECT_EQ(realtime->mode(), Mode::Backoff);
    ASSERT_TRUE(waitForAttempts(2));
    stream->end(1, StreamEndKind::Transient); // failure 2
    EXPECT_EQ(realtime->mode(), Mode::Backoff);
    ASSERT_TRUE(waitForAttempts(3));
    stream->end(2, StreamEndKind::Transient); // failure 3 -> give up streaming for a while

    EXPECT_EQ(realtime->mode(), Mode::Polling);
    EXPECT_EQ(realtime->consecutiveFailures(), 3);

    // The stream is tried again after pollingRetryInterval.
    ASSERT_TRUE(waitForAttempts(4));
    EXPECT_EQ(realtime->mode(), Mode::Connecting);
}

TEST_F(NotificationRealtimeTest, AStreamThatStayedUpResetsTheFailureCount) {
    realtime->start();
    for (std::size_t cycle = 0; cycle < 5; ++cycle) {
        ASSERT_TRUE(waitForAttempts(cycle + 1));
        stream->heartbeat(cycle);
        waitUntil([] { return false; }, 60ms); // longer than stableAfter
        stream->end(cycle, StreamEndKind::Transient);
        EXPECT_EQ(realtime->mode(), Mode::Backoff)
            << "cycle " << cycle << ": a healthy stream dropping is not a failure streak";
        EXPECT_EQ(realtime->consecutiveFailures(), 1);
    }
}

TEST_F(NotificationRealtimeTest, AFlappingServerCannotResetTheBackoff) {
    realtime->start();
    for (std::size_t cycle = 0; cycle < 3; ++cycle) {
        ASSERT_TRUE(waitForAttempts(cycle + 1));
        stream->heartbeat(cycle);                     // accepted...
        stream->end(cycle, StreamEndKind::Transient); // ...and dropped at once
    }
    EXPECT_EQ(realtime->mode(), Mode::Polling);
}

TEST_F(NotificationRealtimeTest, ACleanServerCloseReconnectsPromptly) {
    realtime->start();
    stream->heartbeat(0);
    waitUntil([] { return false; }, 60ms);

    stream->end(0, StreamEndKind::Ended);

    EXPECT_EQ(realtime->mode(), Mode::Backoff);
    ASSERT_TRUE(waitForAttempts(2));
}

TEST_F(NotificationRealtimeTest, ARpcMissingOnTheServerFallsBackToPollingAndLooksAgainMuchLater) {
    realtime->start();

    stream->end(0, StreamEndKind::Unsupported, "unimplemented");

    EXPECT_EQ(realtime->mode(), Mode::Polling);
    EXPECT_FALSE(waitForAttempts(2, 100ms)) << "no hammering a server that does not know the RPC";
    EXPECT_TRUE(waitForAttempts(2, 1s)) << "but it is retried: the server may be upgraded";
}

TEST_F(NotificationRealtimeTest, ARejectedResumePointIsDroppedAndTheOwnerResyncs) {
    QSignalSpy resync(realtime.get(), &NotificationRealtime::resyncRequired);
    realtime->start();
    stream->emit(0, "stale", UnreadCountEvent{1});
    ASSERT_EQ(realtime->lastEventId(), "stale");

    stream->end(0, StreamEndKind::Rejected, "invalid last_event_id");

    EXPECT_EQ(realtime->mode(), Mode::Polling);
    EXPECT_TRUE(realtime->lastEventId().empty());
    EXPECT_EQ(resync.count(), 1);
    ASSERT_TRUE(waitForAttempts(2));
    EXPECT_TRUE(stream->attempts[1]->lastEventId.empty());
}

TEST_F(NotificationRealtimeTest, AResyncEventDropsTheResumePointAndIsNotForwarded) {
    QSignalSpy forwarded(realtime.get(), &NotificationRealtime::eventReceived);
    QSignalSpy resync(realtime.get(), &NotificationRealtime::resyncRequired);
    realtime->start();
    stream->emit(0, "e1", UnreadCountEvent{1});

    stream->emit(0, "e2", ResyncRequiredEvent{});

    EXPECT_EQ(resync.count(), 1);
    EXPECT_EQ(forwarded.count(), 1);
    EXPECT_TRUE(realtime->lastEventId().empty());
    EXPECT_TRUE(realtime->isStreaming());
}

TEST_F(NotificationRealtimeTest, ARejectedSessionStopsEverything) {
    QSignalSpy unauthenticated(realtime.get(), &NotificationRealtime::unauthenticated);
    realtime->start();

    stream->end(0, StreamEndKind::Unauthenticated, "token revoked");

    EXPECT_EQ(realtime->mode(), Mode::Stopped);
    ASSERT_EQ(unauthenticated.count(), 1);
    EXPECT_EQ(unauthenticated.takeFirst().at(0).toString(), QStringLiteral("token revoked"));
    EXPECT_FALSE(waitForAttempts(2, 150ms)) << "no reconnect loop after the session ended";
}

TEST_F(NotificationRealtimeTest, SilenceLongerThanTheIdleTimeoutMeansADeadConnection) {
    realtime->start();
    stream->heartbeat(0);

    ASSERT_TRUE(waitForAttempts(2, 1s)) << "the watchdog reopens a half-open connection";
    EXPECT_TRUE(stream->attempts[0]->cancelled);
}

TEST_F(NotificationRealtimeTest, HeartbeatsKeepTheWatchdogQuiet) {
    realtime->start();
    for (int i = 0; i < 6; ++i) {
        stream->heartbeat(0);
        waitUntil([] { return false; }, 50ms); // 300 ms in total, idleTimeout is 150 ms
    }
    EXPECT_EQ(stream->attempts.size(), 1U);
    EXPECT_TRUE(realtime->isStreaming());
}

TEST_F(NotificationRealtimeTest, StopCancelsTheStreamAndIgnoresLateCallbacks) {
    QSignalSpy forwarded(realtime.get(), &NotificationRealtime::eventReceived);
    realtime->start();
    stream->heartbeat(0);

    realtime->stop();

    EXPECT_EQ(realtime->mode(), Mode::Stopped);
    EXPECT_TRUE(stream->attempts[0]->cancelled);
    stream->emit(0, "late", UnreadCountEvent{9}); // the transport had already queued it
    stream->end(0, StreamEndKind::Transient);
    EXPECT_EQ(forwarded.count(), 0);
    EXPECT_EQ(realtime->mode(), Mode::Stopped);
    EXPECT_FALSE(waitForAttempts(2, 100ms));
}

TEST_F(NotificationRealtimeTest, CallbacksOfAReplacedAttemptAreIgnored) {
    QSignalSpy forwarded(realtime.get(), &NotificationRealtime::eventReceived);
    realtime->start();
    stream->end(0, StreamEndKind::Transient);
    ASSERT_TRUE(waitForAttempts(2));

    stream->emit(0, "old", UnreadCountEvent{5}); // the dead attempt
    EXPECT_EQ(forwarded.count(), 0);
    EXPECT_NE(realtime->mode(), Mode::Streaming);

    stream->emit(1, "new", UnreadCountEvent{6});
    EXPECT_EQ(forwarded.count(), 1);
    EXPECT_EQ(realtime->lastEventId(), "new");
}

TEST_F(NotificationRealtimeTest, StartIsIdempotentAndRestartableAfterStop) {
    realtime->start();
    realtime->start();
    EXPECT_EQ(stream->attempts.size(), 1U);

    realtime->stop();
    realtime->start();
    EXPECT_EQ(stream->attempts.size(), 2U);
    EXPECT_TRUE(stream->attempts[1]->lastEventId.empty()) << "a new session never resumes the old one";
}

TEST_F(NotificationRealtimeTest, ModeNames) {
    EXPECT_EQ(NotificationRealtime::toString(Mode::Streaming), QStringLiteral("streaming"));
    EXPECT_EQ(NotificationRealtime::toString(Mode::Polling), QStringLiteral("polling"));
    EXPECT_EQ(NotificationRealtime::toString(Mode::Backoff), QStringLiteral("backoff"));
}

} // namespace
} // namespace aedst::feature::notifications

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
