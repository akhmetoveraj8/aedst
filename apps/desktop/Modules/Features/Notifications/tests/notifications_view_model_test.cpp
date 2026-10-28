#include "Domain/notification_repository.hpp"
#include "Presentation/notifications_view_model.hpp"
#include "aedst/analytics/no_op_analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"
#include "aedst/platform/notification_service.hpp"
#include "aedst/testing/fake_http_server.hpp"

#include <QSignalSpy>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>
#include <vector>

// The ViewModel with a scripted repository, a scripted NotificationStream and a recording notifier.
// main() is in notification_realtime_test.cpp (same binary).

namespace aedst::feature::notifications {
namespace {

using namespace std::chrono_literals;
using aedst::testing::waitUntil;

class FakeRepository final : public NotificationRepository {
public:
    void list(bool, const std::string&, int, core::Completion<NotificationPage> done) override {
        ++listCalls;
        done(NotificationPage{.notifications = listed, .nextPageToken = {}});
    }

    void unreadCount(core::Completion<int> done) override {
        ++unreadCalls;
        done(unread);
    }

    void markRead(const std::vector<std::string>&, core::Completion<void> done) override { done(core::ok()); }

    void markAllRead(core::Completion<int> done) override { done(0); }

    void preferences(core::Completion<NotificationPreferences> done) override { done(NotificationPreferences{}); }

    void updatePreferences(const NotificationPreferences& next,
                           core::Completion<NotificationPreferences> done) override {
        done(next);
    }

    int unread{0};
    int unreadCalls{0};
    int listCalls{0};
    std::vector<Notification> listed;
};

class FakeStream final : public NotificationStream {
public:
    [[nodiscard]] Cancel open(const std::string& lastEventId, Callbacks next) override {
        ++opens;
        resumeIds.push_back(lastEventId);
        callbacks = std::move(next);
        return [this]() { ++cancels; };
    }

    void emit(std::string id, decltype(NotificationEvent::payload) payload) {
        callbacks.onEvent(NotificationEvent{.id = std::move(id), .payload = std::move(payload)});
    }

    void end(StreamEndKind kind) { callbacks.onEnd(StreamEnd{.kind = kind, .message = "test"}); }

    Callbacks callbacks;
    int opens{0};
    int cancels{0};
    std::vector<std::string> resumeIds;
};

class RecordingNotifier final : public platform::NotificationService {
public:
    [[nodiscard]] bool isAvailable() const override { return true; }

    void show(std::string_view title, std::string_view body, platform::NotificationSeverity severity) override {
        showRequest({.title = std::string(title), .body = std::string(body), .severity = severity});
    }

    void showRequest(const platform::NotificationRequest& request) override { shown.push_back(request); }

    void click(const std::string& link) { notifyActivated(link); }

    std::vector<platform::NotificationRequest> shown;
};

class RecordingErrors final : public core::ErrorSink {
public:
    void report(const core::Error& error, std::string_view context, core::ErrorVisibility) override {
        reports.emplace_back(std::string(context), error.code);
    }

    std::vector<std::pair<std::string, core::ErrorCode>> reports;
};

NotificationRealtime::Timing fastTiming() {
    return NotificationRealtime::Timing{.initialBackoff = 5ms,
                                        .maxBackoff = 20ms,
                                        .multiplier = 2.0,
                                        .idleTimeout = 5s,
                                        .stableAfter = 40ms,
                                        .failuresBeforePolling = 3,
                                        .pollingRetryInterval = 5s,
                                        .unsupportedRetryInterval = 5s};
}

Notification fresh(std::string id, std::string link = "/tasks/1") {
    return Notification{.id = std::move(id),
                        .kind = NotificationKind::TaskCompleted,
                        .title = "Done",
                        .body = "Task finished",
                        .link = std::move(link),
                        .createdAt = std::chrono::system_clock::now() + std::chrono::seconds{5}};
}

class NotificationsViewModelTest : public ::testing::Test {
protected:
    void SetUp() override {
        repository = std::make_shared<FakeRepository>();
        stream = std::make_shared<FakeStream>();
        notifier = std::make_unique<RecordingNotifier>();
        errors = std::make_shared<RecordingErrors>();
        viewModel = std::make_unique<NotificationsViewModel>(
            repository, errors, std::make_shared<analytics::NoOpAnalyticsTracker>(), notifier.get(), nullptr);
    }

    void useStream() { viewModel->setStream(stream, fastTiming()); }

    std::shared_ptr<FakeRepository> repository;
    std::shared_ptr<FakeStream> stream;
    std::unique_ptr<RecordingNotifier> notifier;
    std::shared_ptr<RecordingErrors> errors;
    std::unique_ptr<NotificationsViewModel> viewModel;
};

TEST_F(NotificationsViewModelTest, WithoutAStreamTheClientPollsExactlyAsBefore) {
    repository->unread = 4;
    viewModel->start();
    EXPECT_EQ(repository->unreadCalls, 1);
    EXPECT_EQ(viewModel->unreadCount(), 4);
    EXPECT_EQ(viewModel->deliveryMode(), QStringLiteral("polling"));
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, OfflineStopsPollingAndComingBackOnlinePollsAtOnce) {
    repository->unread = 1;
    viewModel->start();
    ASSERT_EQ(repository->unreadCalls, 1);

    viewModel->setOnline(false);
    viewModel->pollNow(); // nothing can succeed while offline: no request is made
    EXPECT_EQ(repository->unreadCalls, 1);

    viewModel->setOnline(true);
    EXPECT_EQ(repository->unreadCalls, 2);
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, AHealthyStreamTakesOverFromPolling) {
    useStream();
    QSignalSpy mode(viewModel.get(), &NotificationsViewModel::deliveryModeChanged);

    viewModel->start();
    ASSERT_EQ(stream->opens, 1);
    EXPECT_EQ(repository->unreadCalls, 1) << "one poll gives the baseline while the stream connects";
    EXPECT_EQ(viewModel->deliveryMode(), QStringLiteral("polling"));

    stream->emit("e1", UnreadCountEvent{7});

    EXPECT_EQ(viewModel->deliveryMode(), QStringLiteral("stream"));
    EXPECT_EQ(viewModel->unreadCount(), 7) << "the server's counter is authoritative";
    EXPECT_GE(mode.count(), 1);
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, WhenTheStreamBreaksPollingResumesAtOnce) {
    useStream();
    viewModel->start();
    stream->emit("e1", UnreadCountEvent{1});
    const int pollsWhileStreaming = repository->unreadCalls;

    stream->end(StreamEndKind::Transient);

    EXPECT_EQ(viewModel->deliveryMode(), QStringLiteral("polling"));
    EXPECT_EQ(repository->unreadCalls, pollsWhileStreaming + 1) << "no blind spot while reconnecting";
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, ACreatedEventIsAnnouncedNativelyWithItsLinkAndTag) {
    useStream();
    viewModel->start();

    stream->emit("e1", NotificationCreatedEvent{fresh("n-1", "/tasks/42")});

    ASSERT_EQ(notifier->shown.size(), 1U);
    const platform::NotificationRequest& request = notifier->shown.front();
    EXPECT_EQ(request.title, "Done");
    EXPECT_EQ(request.link, "/tasks/42");
    EXPECT_EQ(request.tag, "n-1");
    EXPECT_FALSE(request.actionLabel.empty());
    EXPECT_EQ(viewModel->unreadCount(), 1) << "counted at once, corrected by the next counter event";
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, TheSameNotificationIsNeverAnnouncedTwice) {
    useStream();
    viewModel->start();
    stream->emit("e1", NotificationCreatedEvent{fresh("n-1")});
    stream->emit("e2", NotificationCreatedEvent{fresh("n-1")}); // replay after a reconnect

    EXPECT_EQ(notifier->shown.size(), 1U);
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, OldBacklogIsNotReplayedAsToasts) {
    useStream();
    viewModel->start();
    Notification old = fresh("old");
    old.createdAt = std::chrono::system_clock::now() - std::chrono::hours{2};

    stream->emit("e1", NotificationCreatedEvent{old});

    EXPECT_TRUE(notifier->shown.empty());
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, ClickingANativeNotificationReportsItsLink) {
    useStream();
    QSignalSpy activated(viewModel.get(), &NotificationsViewModel::notificationActivated);

    notifier->click("/tasks/42");

    ASSERT_EQ(activated.count(), 1);
    EXPECT_EQ(activated.takeFirst().at(0).toString(), QStringLiteral("/tasks/42"));
}

TEST_F(NotificationsViewModelTest, AResyncRequestRefetchesTheCounter) {
    useStream();
    viewModel->start();
    stream->emit("e1", UnreadCountEvent{1});
    const int polls = repository->unreadCalls;

    stream->emit("e2", ResyncRequiredEvent{});

    EXPECT_EQ(repository->unreadCalls, polls + 1);
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, ARejectedSessionOnTheStreamIsReportedToTheErrorSink) {
    useStream();
    viewModel->start();

    stream->end(StreamEndKind::Unauthenticated);

    bool reported = false;
    for (const auto& [context, code] : errors->reports) {
        reported = reported || (context == "notifications.stream" && code == core::ErrorCode::Unauthenticated);
    }
    EXPECT_TRUE(reported) << "ErrorCenter turns this into the sign-out";
    viewModel->stop();
}

TEST_F(NotificationsViewModelTest, StopCancelsTheStreamAndForgetsTheCounter) {
    useStream();
    viewModel->start();
    stream->emit("e1", UnreadCountEvent{5});

    viewModel->stop();

    EXPECT_EQ(stream->cancels, 1);
    EXPECT_EQ(viewModel->unreadCount(), 0);
    EXPECT_EQ(viewModel->deliveryMode(), QStringLiteral("polling"));
}

TEST_F(NotificationsViewModelTest, EventsAfterStopAreIgnored) {
    useStream();
    viewModel->start();
    viewModel->stop();

    viewModel->realtime()->eventReceived(NotificationEvent{.id = "x", .payload = UnreadCountEvent{9}});

    EXPECT_EQ(viewModel->unreadCount(), 0);
}

} // namespace
} // namespace aedst::feature::notifications
