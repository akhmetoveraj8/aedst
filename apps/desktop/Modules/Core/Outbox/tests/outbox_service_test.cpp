#include "aedst/outbox/outbox_service.hpp"
#include "aedst/testing/fake_clock.hpp"
#include "aedst/testing/fake_http_server.hpp"
#include "outbox_test_support.hpp"

#include <QCoreApplication>
#include <QMetaObject>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>

// The Qt service on the real SQLite queue: completions travel through a queued call on the application object, exactly
// like AppDependencies wires them, so the event loop has to run (waitUntil).

namespace aedst::outbox {
namespace {

using namespace std::chrono_literals;
using aedst::testing::waitUntil;
using namespace testsupport;

class OutboxServiceTest : public ::testing::Test {
protected:
    void SetUp() override {
        const persistence::Dispatcher toGui = [](std::function<void()> work) {
            QMetaObject::invokeMethod(QCoreApplication::instance(), std::move(work), Qt::QueuedConnection);
        };
        db_.queue = std::make_shared<SqliteOutboxQueue>(db_.worker, toGui);
        script_ = std::make_shared<ScriptedHandler::Script>();
        auto handlers = std::make_shared<OutboxHandlers>();
        ASSERT_TRUE(handlers->add(std::make_shared<ScriptedHandler>("task.create", script_)));
        service_ = std::make_unique<OutboxService>(OutboxService::Dependencies{
            .queue = db_.queue,
            .handlers = handlers,
            .clock = std::make_shared<aedst::testing::FakeClock>(),
            .drainer = {},
            .backoff =
                network::RetryPolicy{.maxAttempts = 0, .initialBackoff = 2ms, .maxBackoff = 4ms, .multiplier = 2.0}});
    }

    void enqueue(const std::string& id) {
        bool stored = false;
        service_->enqueue("task.create", "{}", id,
                          [&stored](core::VoidOutcome result) { stored = result.has_value(); });
        ASSERT_TRUE(waitUntil([&] { return stored; }));
    }

    SqliteFixture db_;
    std::shared_ptr<ScriptedHandler::Script> script_;
    std::unique_ptr<OutboxService> service_;
};

TEST_F(OutboxServiceTest, AnEnqueuedOperationIsDeliveredWithItsIdAsTheIdempotencyKey) {
    int deliveredSignals = 0;
    QObject::connect(service_.get(), &OutboxService::delivered, [&deliveredSignals]() { ++deliveredSignals; });

    enqueue("op-1");

    ASSERT_TRUE(waitUntil(
        [&] { return script_->sent.size() == 1U && service_->pendingCount() == 0 && deliveredSignals == 1; }));
    EXPECT_EQ(script_->sent[0].first, "op-1");
    EXPECT_EQ(script_->sent[0].second, "op-1");
}

TEST_F(OutboxServiceTest, NothingIsAttemptedWhileOfflineAndTheQueueDrainsWhenTheNetworkReturns) {
    service_->setOnline(false);

    enqueue("op-1");
    ASSERT_TRUE(waitUntil([&] { return service_->pendingCount() == 1; }));
    waitUntil([] { return false; }, 60ms);
    EXPECT_TRUE(script_->sent.empty());

    service_->setOnline(true);

    ASSERT_TRUE(waitUntil([&] { return script_->sent.size() == 1U && service_->pendingCount() == 0; }));
}

TEST_F(OutboxServiceTest, ARetryableFailureIsRetriedAfterTheBackoffWithTheSameKey) {
    script_->outcomes.push_back(DeliveryResult::retryable("network"));

    enqueue("op-1");

    ASSERT_TRUE(waitUntil([&] { return script_->sent.size() == 2U && service_->pendingCount() == 0; }));
    EXPECT_EQ(script_->sent[0].second, "op-1");
    EXPECT_EQ(script_->sent[1].second, "op-1");
}

TEST_F(OutboxServiceTest, ABlockedRunWaitsForTheNextTriggerInsteadOfRetrying) {
    script_->outcomes.push_back(DeliveryResult::blocked("unauthenticated"));

    enqueue("op-1");
    ASSERT_TRUE(waitUntil([&] { return script_->sent.size() == 1U; }));
    waitUntil([] { return false; }, 80ms);
    EXPECT_EQ(script_->sent.size(), 1U) << "no timer after a blocked run";
    EXPECT_EQ(service_->pendingCount(), 1);

    service_->kick();

    ASSERT_TRUE(waitUntil([&] { return script_->sent.size() == 2U && service_->pendingCount() == 0; }));
}

TEST_F(OutboxServiceTest, PurgeForgetsEveryQueuedOperation) {
    service_->setOnline(false);
    enqueue("op-1");
    enqueue("op-2");
    ASSERT_TRUE(waitUntil([&] { return service_->pendingCount() == 2; }));

    bool purged = false;
    service_->purge([&purged](core::VoidOutcome result) { purged = result.has_value(); });

    ASSERT_TRUE(waitUntil([&] { return purged && service_->pendingCount() == 0; }));
    // The fixture's own queue completes inline on the database thread; the service's one needs the event loop.
    SqliteOutboxQueue direct(db_.worker, inlineDispatcher());
    const auto rows = await<std::vector<OutboxItem>>(
        [&](core::Completion<std::vector<OutboxItem>> done) { direct.snapshot(std::move(done)); });
    ASSERT_TRUE(rows.has_value());
    EXPECT_TRUE(rows->empty());
    service_->setOnline(true);
    waitUntil([] { return false; }, 60ms);
    EXPECT_TRUE(script_->sent.empty());
}

TEST_F(OutboxServiceTest, ADuplicateEnqueueIsDeliveredOnce) {
    service_->setOnline(false);
    enqueue("op-1");
    enqueue("op-1");

    service_->setOnline(true);

    ASSERT_TRUE(waitUntil([&] { return script_->sent.size() == 1U && service_->pendingCount() == 0; }));
    waitUntil([] { return false; }, 40ms);
    EXPECT_EQ(script_->sent.size(), 1U);
}

} // namespace
} // namespace aedst::outbox
