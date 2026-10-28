#include "Data/local_token_store_adapter.hpp"
#include "aedst/persistence/async_token_store.hpp"
#include "aedst/persistence/database_worker.hpp"
#include "aedst/persistence/master_key_provider.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <system_error>
#include <thread>

namespace aedst::feature::auth {
namespace {

using namespace std::chrono_literals;

/// The GUI event loop stand-in: completions queue here and run when the test thread pumps.
class Pump {
public:
    [[nodiscard]] persistence::Dispatcher dispatcher() {
        return [this](std::function<void()> fn) {
            {
                const std::scoped_lock lock(mutex_);
                queue_.push_back(std::move(fn));
            }
            wake_.notify_all();
        };
    }

    bool runUntil(const std::function<bool()>& done, std::chrono::milliseconds timeout = 10s) {
        const auto deadline = std::chrono::steady_clock::now() + timeout;
        for (;;) {
            if (done()) {
                return true;
            }
            std::function<void()> next;
            {
                std::unique_lock lock(mutex_);
                if (queue_.empty() && !wake_.wait_until(lock, deadline, [this] { return !queue_.empty(); })) {
                    return done();
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

class FixedKeyProvider final : public persistence::MasterKeyProvider {
public:
    [[nodiscard]] std::string_view name() const noexcept override { return "fixed"; }

    [[nodiscard]] core::Outcome<persistence::SecretBytes> loadOrCreate() override {
        return persistence::SecretBytes{std::vector<std::uint8_t>(persistence::kMasterKeySize, 0x37)};
    }
};

class TempDir final {
public:
    TempDir() {
        path_ = std::filesystem::temp_directory_path() /
                ("aedst-auth-adapter-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        std::filesystem::create_directories(path_);
    }

    ~TempDir() {
        std::error_code ignored;
        std::filesystem::remove_all(path_, ignored);
    }

    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    [[nodiscard]] const std::filesystem::path& path() const { return path_; }

private:
    std::filesystem::path path_;
};

Session session(const std::string& user = "user-1") {
    return Session{.userId = user,
                   .accessToken = "access-secret",
                   .refreshToken = "refresh-secret",
                   .accessTokenExpiresAt = std::chrono::system_clock::time_point{std::chrono::seconds{1'900'000'000}}};
}

class LocalTokenStoreAdapterTest : public ::testing::Test {
protected:
    [[nodiscard]] std::shared_ptr<LocalTokenStoreAdapter> makeAdapter(const std::filesystem::path& file) {
        auto worker = std::make_shared<persistence::DatabaseWorker>(file);
        auto store = std::make_shared<persistence::AsyncTokenStore>(
            std::move(worker), [] { return std::make_unique<FixedKeyProvider>(); }, pump.dispatcher());
        return std::make_shared<LocalTokenStoreAdapter>(std::move(store));
    }

    core::VoidOutcome await(const std::function<void(core::Completion<void>)>& start) {
        std::optional<core::VoidOutcome> result;
        start([&result](core::VoidOutcome r) { result = std::move(r); });
        EXPECT_TRUE(pump.runUntil([&] { return result.has_value(); }));
        return result ? std::move(*result) : core::fail(core::Error::unknown("no result"));
    }

    [[nodiscard]] std::filesystem::path databaseFile() const { return dir.path() / "aedst.sqlite3"; }

    TempDir dir;
    Pump pump;
};

TEST_F(LocalTokenStoreAdapterTest, ReadsAreServedFromMemoryAndStartEmpty) {
    const auto adapter = makeAdapter(databaseFile());

    const auto loaded = adapter->load();
    ASSERT_TRUE(loaded.has_value());
    EXPECT_FALSE(loaded->has_value());
    EXPECT_FALSE(adapter->accessToken().has_value());
}

TEST_F(LocalTokenStoreAdapterTest, TheCacheChangesOnlyAfterTheWriteSucceeded) {
    const auto adapter = makeAdapter(databaseFile());
    std::optional<core::VoidOutcome> saved;

    adapter->save(session(), [&saved](core::VoidOutcome r) { saved = std::move(r); });
    EXPECT_FALSE(adapter->accessToken().has_value()) << "not signed in until the disk write is confirmed";

    ASSERT_TRUE(pump.runUntil([&] { return saved.has_value(); }));
    ASSERT_TRUE(saved->has_value()) << saved->error().message;
    EXPECT_EQ(adapter->accessToken().value_or(""), "access-secret");
    const auto loaded = adapter->load();
    ASSERT_TRUE(loaded.has_value() && loaded->has_value());
    EXPECT_EQ((*loaded)->userId, "user-1");
    EXPECT_EQ((*loaded)->refreshToken.reveal(), "refresh-secret");
}

TEST_F(LocalTokenStoreAdapterTest, ASavedSessionIsFoundByAFreshAdapterAfterPreload) {
    {
        const auto first = makeAdapter(databaseFile());
        ASSERT_TRUE(await([&](auto done) { first->save(session("user-9"), std::move(done)); }).has_value());
    } // the first worker is joined here

    const auto second = makeAdapter(databaseFile());
    EXPECT_FALSE(second->accessToken().has_value()) << "before preload() nothing is known";
    const auto preloaded = await([&](auto done) { second->preload(std::move(done)); });
    ASSERT_TRUE(preloaded.has_value()) << preloaded.error().message;

    const auto loaded = second->load();
    ASSERT_TRUE(loaded.has_value() && loaded->has_value());
    EXPECT_EQ((*loaded)->userId, "user-9");
    EXPECT_EQ(second->accessToken().value_or(""), "access-secret");
}

TEST_F(LocalTokenStoreAdapterTest, ASessionThatCannotBeStoredIsNeverCached) {
    const auto blocker = dir.path() / "blocker";
    std::ofstream(blocker) << "x"; // a file where the data directory should be
    const auto adapter = makeAdapter(blocker / "aedst.sqlite3");

    const auto saved = await([&](auto done) { adapter->save(session(), std::move(done)); });

    ASSERT_FALSE(saved.has_value());
    EXPECT_EQ(saved.error().code, core::ErrorCode::Storage);
    EXPECT_FALSE(adapter->accessToken().has_value());
    const auto loaded = adapter->load();
    ASSERT_TRUE(loaded.has_value());
    EXPECT_FALSE(loaded->has_value());
}

TEST_F(LocalTokenStoreAdapterTest, ClearWipesTheTokensFromMemoryImmediatelyAndFromDiskAfterwards) {
    const auto adapter = makeAdapter(databaseFile());
    ASSERT_TRUE(await([&](auto done) { adapter->save(session(), std::move(done)); }).has_value());
    ASSERT_TRUE(adapter->accessToken().has_value());

    std::optional<core::VoidOutcome> cleared;
    adapter->clear([&cleared](core::VoidOutcome r) { cleared = std::move(r); });
    EXPECT_FALSE(adapter->accessToken().has_value())
        << "sign-out must not leave a token usable while the disk catches up";
    EXPECT_FALSE(cleared.has_value());

    ASSERT_TRUE(pump.runUntil([&] { return cleared.has_value(); }));
    ASSERT_TRUE(cleared->has_value()) << cleared->error().message;

    const auto fresh = makeAdapter(databaseFile());
    ASSERT_TRUE(await([&](auto done) { fresh->preload(std::move(done)); }).has_value());
    EXPECT_FALSE(fresh->accessToken().has_value());
}

TEST_F(LocalTokenStoreAdapterTest, PreloadOfAnEmptyDatabaseLeavesTheAdapterSignedOut) {
    const auto adapter = makeAdapter(databaseFile());
    const auto preloaded = await([&](auto done) { adapter->preload(std::move(done)); });
    ASSERT_TRUE(preloaded.has_value()) << preloaded.error().message;
    EXPECT_FALSE(adapter->load()->has_value());
}

TEST_F(LocalTokenStoreAdapterTest, PreloadReportsAnUnreadableDatabase) {
    const auto blocker = dir.path() / "blocker";
    std::ofstream(blocker) << "x";
    const auto adapter = makeAdapter(blocker / "aedst.sqlite3");

    const auto preloaded = await([&](auto done) { adapter->preload(std::move(done)); });

    ASSERT_FALSE(preloaded.has_value());
    EXPECT_EQ(preloaded.error().code, core::ErrorCode::Storage);
}

} // namespace
} // namespace aedst::feature::auth
