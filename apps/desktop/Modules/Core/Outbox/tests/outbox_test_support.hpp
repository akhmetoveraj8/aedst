#pragma once

#include "aedst/core/outcome.hpp"
#include "aedst/outbox/outbox_drainer.hpp"
#include "aedst/outbox/outbox_handler.hpp"
#include "aedst/outbox/outbox_queue.hpp"
#include "aedst/persistence/database_worker.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <deque>
#include <filesystem>
#include <functional>
#include <future>
#include <memory>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace aedst::outbox::testsupport {

/// Unique scratch directory removed on destruction.
class TempDir final {
public:
    TempDir() {
        static std::atomic<unsigned> counter{0};
        const auto ticks = std::chrono::steady_clock::now().time_since_epoch().count();
        path_ = std::filesystem::temp_directory_path() /
                ("aedst-outbox-" + std::to_string(ticks) + "-" + std::to_string(counter.fetch_add(1)));
        std::filesystem::create_directories(path_);
    }

    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;
    TempDir(TempDir&&) = delete;
    TempDir& operator=(TempDir&&) = delete;

    ~TempDir() {
        std::error_code ignored;
        std::filesystem::remove_all(path_, ignored);
    }

    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

private:
    std::filesystem::path path_;
};

/// Completions are delivered inline on the database thread: enough for tests that block on a future, and it
/// exercises the drainer on a thread other than the test's.
inline persistence::Dispatcher inlineDispatcher() {
    return [](std::function<void()> work) { work(); };
}

/// Starts an asynchronous operation and blocks until its completion ran (or fails the test after 10 s).
template <typename T>
core::Outcome<T> await(const std::function<void(core::Completion<T>)>& start) {
    auto promise = std::make_shared<std::promise<core::Outcome<T>>>();
    auto future = promise->get_future();
    start([promise](core::Outcome<T> result) { promise->set_value(std::move(result)); });
    if (future.wait_for(std::chrono::seconds{10}) != std::future_status::ready) {
        ADD_FAILURE() << "an outbox operation did not complete";
        return core::fail(core::Error::unknown("timeout"));
    }
    return future.get();
}

/// A SQLite queue on a real file in a temp directory (the DatabaseWorker migrates it before the first job).
struct SqliteFixture {
    TempDir directory;
    std::shared_ptr<persistence::DatabaseWorker> worker =
        std::make_shared<persistence::DatabaseWorker>(directory.path() / "aedst.sqlite3");
    std::shared_ptr<SqliteOutboxQueue> queue = std::make_shared<SqliteOutboxQueue>(worker, inlineDispatcher());

    core::VoidOutcome enqueue(const std::string& id, const std::string& type, const std::string& payload = "{}") {
        OutboxItem item{.id = id, .type = type, .payload = payload, .createdAtMs = 1'700'000'000'000};
        return await<void>([&](core::Completion<void> done) { queue->enqueue(item, std::move(done)); });
    }

    std::vector<OutboxItem> snapshot() {
        auto rows = await<std::vector<OutboxItem>>(
            [&](core::Completion<std::vector<OutboxItem>> done) { queue->snapshot(std::move(done)); });
        return rows ? std::move(*rows) : std::vector<OutboxItem>{};
    }

    core::Outcome<RunReport> run(const std::shared_ptr<const OutboxHandlers>& handlers) {
        const auto drainer = OutboxDrainer::create(queue, handlers);
        return await<RunReport>([&](core::Completion<RunReport> done) { drainer->run(std::move(done)); });
    }
};

/// Handler that records what it was asked to deliver and answers from a script.
class ScriptedHandler final : public OutboxHandler {
public:
    struct Script {
        std::vector<std::pair<std::string, std::string>> sent; // {item id, idempotency key}
        std::deque<DeliveryResult> outcomes;                   // consumed one per delivery
    };

    ScriptedHandler(std::string type, std::shared_ptr<Script> script)
        : type_(std::move(type)), script_(std::move(script)) {}

    [[nodiscard]] std::string type() const override { return type_; }

    void deliver(const OutboxDelivery& delivery, DeliveryCompletion done) override {
        script_->sent.emplace_back(delivery.item.id, delivery.idempotencyKey);
        DeliveryResult result = DeliveryResult::delivered();
        if (!script_->outcomes.empty()) {
            result = std::move(script_->outcomes.front());
            script_->outcomes.pop_front();
        }
        done(std::move(result));
    }

private:
    std::string type_;
    std::shared_ptr<Script> script_;
};

} // namespace aedst::outbox::testsupport
