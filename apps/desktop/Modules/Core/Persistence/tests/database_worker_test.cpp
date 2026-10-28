#include "aedst/persistence/async_token_store.hpp"
#include "aedst/persistence/database_worker.hpp"
#include "aedst/persistence/migrator.hpp"
#include "in_memory_master_key_provider.hpp"
#include "temp_directory.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

namespace aedst::persistence {
namespace {

using namespace std::chrono_literals;
using test_support::InMemoryMasterKeyProvider;
using test_support::TempDirectory;

/// Stands in for the GUI event loop: completions are queued here by the dispatcher and run only when the
/// test thread pumps, exactly like QMetaObject::invokeMethod(..., Qt::QueuedConnection).
class Pump {
public:
    [[nodiscard]] Dispatcher dispatcher() {
        return [this](std::function<void()> fn) {
            {
                const std::scoped_lock lock(mutex_);
                queue_.push_back(std::move(fn));
            }
            wake_.notify_all();
        };
    }

    /// Runs queued completions on THIS thread until `done()` or the timeout.
    bool runUntil(const std::function<bool()>& done, std::chrono::milliseconds timeout = 10s) {
        const auto deadline = std::chrono::steady_clock::now() + timeout;
        for (;;) {
            if (done()) {
                return true;
            }
            std::function<void()> next;
            {
                std::unique_lock lock(mutex_);
                if (queue_.empty()) {
                    if (!wake_.wait_until(lock, deadline, [this] { return !queue_.empty(); })) {
                        return done();
                    }
                }
                next = std::move(queue_.front());
                queue_.pop_front();
            }
            next();
        }
    }

private:
    std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<std::function<void()>> queue_;
};

class DatabaseWorkerTest : public ::testing::Test {
protected:
    [[nodiscard]] std::filesystem::path databaseFile() const { return dir.path() / "nested" / "app.sqlite3"; }

    template <typename T>
    core::Outcome<T> runAndWait(DatabaseWorker& worker, DatabaseWorker::Work<T> work) {
        std::optional<core::Outcome<T>> result;
        worker.run<T>(std::move(work), pump.dispatcher(), [&result](core::Outcome<T> r) { result = std::move(r); });
        EXPECT_TRUE(pump.runUntil([&] { return result.has_value(); }));
        return result ? std::move(*result) : core::fail(core::Error::unknown("no result"));
    }

    TempDirectory dir;
    Pump pump;
};

TEST_F(DatabaseWorkerTest, WorkRunsOnTheWorkerThreadAndCompletionsOnTheCallersThread) {
    DatabaseWorker worker(databaseFile());
    std::thread::id workThread;
    std::thread::id completionThread;

    std::optional<core::Outcome<int>> result;
    worker.run<int>(
        [&workThread](const std::shared_ptr<SqliteConnection>&) -> core::Outcome<int> {
            workThread = std::this_thread::get_id();
            return 7;
        },
        pump.dispatcher(),
        [&](core::Outcome<int> r) {
            completionThread = std::this_thread::get_id();
            result = std::move(r);
        });
    ASSERT_TRUE(pump.runUntil([&] { return result.has_value(); }));

    ASSERT_TRUE(result->has_value());
    EXPECT_EQ(**result, 7);
    EXPECT_EQ(workThread, worker.threadId());
    EXPECT_NE(workThread, std::this_thread::get_id()) << "SQLite work must not run on the caller (GUI) thread";
    EXPECT_EQ(completionThread, std::this_thread::get_id());
}

TEST_F(DatabaseWorkerTest, TheDatabaseIsCreatedMigratedAndInWalMode) {
    DatabaseWorker worker(databaseFile()); // the parent directory does not exist yet

    const auto version = runAndWait<std::int64_t>(worker, [](const std::shared_ptr<SqliteConnection>& connection) {
        auto statement = connection->prepare("PRAGMA user_version");
        if (!statement) {
            return core::Outcome<std::int64_t>(core::fail(statement.error()));
        }
        static_cast<void>(statement->step());
        return core::Outcome<std::int64_t>(statement->columnInt64(0));
    });
    ASSERT_TRUE(version.has_value()) << version.error().message;
    EXPECT_EQ(*version, Migrator(appMigrations()).latestVersion());

    const auto mode = runAndWait<std::string>(worker, [](const std::shared_ptr<SqliteConnection>& connection) {
        auto statement = connection->prepare("PRAGMA journal_mode");
        if (!statement) {
            return core::Outcome<std::string>(core::fail(statement.error()));
        }
        static_cast<void>(statement->step());
        return core::Outcome<std::string>(statement->columnText(0));
    });
    ASSERT_TRUE(mode.has_value());
    EXPECT_EQ(*mode, "wal");
    EXPECT_TRUE(std::filesystem::exists(databaseFile()));
}

TEST_F(DatabaseWorkerTest, TasksRunInSubmissionOrder) {
    DatabaseWorker worker(databaseFile());
    std::vector<int> order; // touched on the worker thread only until the last completion
    std::atomic<int> completed{0};

    for (int i = 0; i < 200; ++i) {
        worker.run<int>(
            [&order, i](const std::shared_ptr<SqliteConnection>&) -> core::Outcome<int> {
                order.push_back(i);
                return i;
            },
            pump.dispatcher(), [&completed](core::Outcome<int>) { ++completed; });
    }
    ASSERT_TRUE(pump.runUntil([&] { return completed.load() == 200; }));

    ASSERT_EQ(order.size(), 200U);
    for (int i = 0; i < 200; ++i) {
        ASSERT_EQ(order[static_cast<std::size_t>(i)], i);
    }
}

TEST_F(DatabaseWorkerTest, ManyThreadsCanSubmitConcurrently) {
    DatabaseWorker worker(databaseFile());
    int counter = 0; // only the worker thread increments it
    std::atomic<int> completed{0};
    constexpr int kThreads = 4;
    constexpr int kPerThread = 150;

    std::vector<std::thread> submitters;
    for (int t = 0; t < kThreads; ++t) {
        submitters.emplace_back([&] {
            for (int i = 0; i < kPerThread; ++i) {
                worker.run<int>(
                    [&counter](const std::shared_ptr<SqliteConnection>&) -> core::Outcome<int> { return ++counter; },
                    pump.dispatcher(), [&completed](core::Outcome<int>) { ++completed; });
            }
        });
    }
    for (std::thread& thread : submitters) {
        thread.join();
    }
    ASSERT_TRUE(pump.runUntil([&] { return completed.load() == kThreads * kPerThread; }));
    EXPECT_EQ(counter, kThreads * kPerThread);
}

TEST_F(DatabaseWorkerTest, WorkQueuedBeforeDestructionStillFinishes) {
    std::atomic<int> executed{0};
    std::atomic<int> completed{0};
    {
        DatabaseWorker worker(databaseFile());
        for (int i = 0; i < 50; ++i) {
            worker.run<int>(
                [&executed](const std::shared_ptr<SqliteConnection>&) -> core::Outcome<int> { return ++executed; },
                pump.dispatcher(), [&completed](core::Outcome<int>) { ++completed; });
        }
    } // the destructor drains the queue and joins
    EXPECT_EQ(executed.load(), 50);
    ASSERT_TRUE(pump.runUntil([&] { return completed.load() == 50; }));
}

TEST_F(DatabaseWorkerTest, AnUnopenableDatabaseFailsEveryTaskWithoutRunningIt) {
    // The "directory" for the database is a regular file: the worker cannot create the data directory.
    const auto blocker = dir.path() / "blocker";
    std::ofstream(blocker) << "not a directory";
    DatabaseWorker worker(blocker / "app.sqlite3");
    bool ran = false;

    const auto result = runAndWait<int>(worker, [&ran](const std::shared_ptr<SqliteConnection>&) -> core::Outcome<int> {
        ran = true;
        return 1;
    });

    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::Storage);
    EXPECT_FALSE(ran);
}

TEST_F(DatabaseWorkerTest, ADatabaseFromANewerBuildIsRefusedNotDowngraded) {
    const auto file = dir.path() / "newer.sqlite3";
    {
        auto opened = SqliteConnection::open(file);
        ASSERT_TRUE(opened.has_value());
        ASSERT_TRUE(opened->execute("PRAGMA user_version = 99"));
    }
    DatabaseWorker worker(file);
    bool ran = false;

    const auto result = runAndWait<int>(worker, [&ran](const std::shared_ptr<SqliteConnection>&) -> core::Outcome<int> {
        ran = true;
        return 1;
    });

    ASSERT_FALSE(result.has_value());
    EXPECT_NE(result.error().message.find("newer"), std::string::npos) << result.error().message;
    EXPECT_FALSE(ran);
}

// --- AsyncTokenStore ---------------------------------------------------------------------------------

class AsyncTokenStoreTest : public DatabaseWorkerTest {
protected:
    [[nodiscard]] std::unique_ptr<AsyncTokenStore> makeStore(std::shared_ptr<DatabaseWorker> worker,
                                                             std::thread::id* keyProviderThread = nullptr) {
        return std::make_unique<AsyncTokenStore>(
            std::move(worker),
            [keyProviderThread]() -> std::unique_ptr<MasterKeyProvider> {
                if (keyProviderThread != nullptr) {
                    *keyProviderThread = std::this_thread::get_id();
                }
                return std::make_unique<InMemoryMasterKeyProvider>();
            },
            pump.dispatcher());
    }

    template <typename T, typename Call>
    core::Outcome<T> await(Call&& call) {
        std::optional<core::Outcome<T>> result;
        call([&result](core::Outcome<T> r) { result = std::move(r); });
        EXPECT_TRUE(pump.runUntil([&] { return result.has_value(); }));
        return result ? std::move(*result) : core::fail(core::Error::unknown("no result"));
    }

    static StoredTokens tokens() {
        return StoredTokens{.userId = "user-1",
                            .accessToken = "access-secret",
                            .refreshToken = "refresh-secret",
                            .accessTokenExpiresAtEpochSeconds = 1'800'000'000};
    }
};

TEST_F(AsyncTokenStoreTest, SaveLoadClearRoundTripOffTheCallerThread) {
    auto worker = std::make_shared<DatabaseWorker>(databaseFile());
    std::thread::id keyThread;
    auto store = makeStore(worker, &keyThread);

    const auto empty = await<std::optional<StoredTokens>>([&](auto done) { store->load(std::move(done)); });
    ASSERT_TRUE(empty.has_value()) << empty.error().message;
    EXPECT_FALSE(empty->has_value());

    const auto saved = await<void>([&](auto done) { store->save(tokens(), std::move(done)); });
    ASSERT_TRUE(saved.has_value()) << saved.error().message;

    const auto loaded = await<std::optional<StoredTokens>>([&](auto done) { store->load(std::move(done)); });
    ASSERT_TRUE(loaded.has_value()) << loaded.error().message;
    ASSERT_TRUE(loaded->has_value());
    EXPECT_EQ((*loaded)->userId, "user-1");
    EXPECT_EQ((*loaded)->accessToken, "access-secret");
    EXPECT_EQ((*loaded)->refreshToken, "refresh-secret");

    EXPECT_EQ(keyThread, worker->threadId()) << "the OS keyring is probed on the database thread, not the GUI thread";

    const auto cleared = await<void>([&](auto done) { store->clear(std::move(done)); });
    ASSERT_TRUE(cleared.has_value());
    const auto after = await<std::optional<StoredTokens>>([&](auto done) { store->load(std::move(done)); });
    ASSERT_TRUE(after.has_value());
    EXPECT_FALSE(after->has_value());
}

TEST_F(AsyncTokenStoreTest, TheSessionSurvivesANewWorkerOnTheSameFile) {
    {
        auto worker = std::make_shared<DatabaseWorker>(databaseFile());
        auto store = makeStore(worker);
        ASSERT_TRUE(await<void>([&](auto done) { store->save(tokens(), std::move(done)); }).has_value());
    } // worker joined, file closed

    auto worker = std::make_shared<DatabaseWorker>(databaseFile());
    auto store = makeStore(worker);
    const auto loaded = await<std::optional<StoredTokens>>([&](auto done) { store->load(std::move(done)); });
    ASSERT_TRUE(loaded.has_value()) << loaded.error().message;
    ASSERT_TRUE(loaded->has_value());
    EXPECT_EQ((*loaded)->refreshToken, "refresh-secret");
}

TEST_F(AsyncTokenStoreTest, AnUnavailableDatabaseSurfacesAsAStorageErrorOnEveryOperation) {
    const auto blocker = dir.path() / "blocker";
    std::ofstream(blocker) << "x";
    auto worker = std::make_shared<DatabaseWorker>(blocker / "db.sqlite3");
    auto store = makeStore(worker);

    const auto saved = await<void>([&](auto done) { store->save(tokens(), std::move(done)); });
    ASSERT_FALSE(saved.has_value());
    EXPECT_EQ(saved.error().code, core::ErrorCode::Storage);
    const auto loaded = await<std::optional<StoredTokens>>([&](auto done) { store->load(std::move(done)); });
    EXPECT_FALSE(loaded.has_value());
}

} // namespace
} // namespace aedst::persistence
