#include "aedst/persistence/secure_storage.hpp"
#include "aedst/persistence/sqlite_connection.hpp"
#include "aedst/persistence/token_store.hpp"
#include "in_memory_master_key_provider.hpp"
#include "temp_directory.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace aedst::persistence {
namespace {

std::shared_ptr<SecureStorage> makeStorage() {
    return std::make_shared<SecureStorage>(std::make_shared<test_support::InMemoryMasterKeyProvider>());
}

class TokenStoreTest : public ::testing::Test {
protected:
    void SetUp() override {
        auto connection = SqliteConnection::openInMemory();
        ASSERT_TRUE(connection.has_value());
        connection_ = std::make_shared<SqliteConnection>(std::move(*connection));
        store_ = std::make_unique<TokenStore>(connection_, makeStorage());
        ASSERT_TRUE(store_->migrate());
    }

    std::shared_ptr<SqliteConnection> connection_;
    std::unique_ptr<TokenStore> store_;
};

TEST_F(TokenStoreTest, LoadIsEmptyBeforeSave) {
    auto loaded = store_->load();

    ASSERT_TRUE(loaded.has_value());
    EXPECT_FALSE(loaded->has_value());
}

TEST_F(TokenStoreTest, SaveThenLoadReturnsSameTokens) {
    const StoredTokens tokens{
        .userId = "user-1",
        .accessToken = "access-token",
        .refreshToken = "refresh-token",
        .accessTokenExpiresAtEpochSeconds = 1'800'000'000,
    };

    ASSERT_TRUE(store_->save(tokens));
    auto loaded = store_->load();

    ASSERT_TRUE(loaded.has_value()) << loaded.error().message;
    ASSERT_TRUE(loaded->has_value());
    EXPECT_EQ(**loaded, tokens);
}

TEST_F(TokenStoreTest, SaveReplacesPreviousSession) {
    ASSERT_TRUE(store_->save({.userId = "u1", .accessToken = "a1", .refreshToken = "r1"}));
    ASSERT_TRUE(store_->save({.userId = "u2", .accessToken = "a2", .refreshToken = "r2"}));

    auto loaded = store_->load();
    ASSERT_TRUE(loaded.has_value());
    ASSERT_TRUE(loaded->has_value());
    EXPECT_EQ((*loaded)->userId, "u2");
    EXPECT_EQ((*loaded)->accessToken, "a2");
}

TEST_F(TokenStoreTest, TokensAreNotStoredInPlaintext) {
    ASSERT_TRUE(store_->save({.userId = "u", .accessToken = "plain-access", .refreshToken = "plain-refresh"}));

    auto select = connection_->prepare("SELECT access_token FROM auth_session");
    ASSERT_TRUE(select.has_value());
    ASSERT_TRUE(select->step().value_or(false));
    const auto blob = select->columnBlob(0);
    const std::string raw(blob.begin(), blob.end());
    EXPECT_EQ(raw.find("plain-access"), std::string::npos);
}

TEST_F(TokenStoreTest, ClearRemovesSession) {
    ASSERT_TRUE(store_->save({.userId = "u", .accessToken = "a", .refreshToken = "r"}));
    ASSERT_TRUE(store_->clear());

    auto loaded = store_->load();
    ASSERT_TRUE(loaded.has_value());
    EXPECT_FALSE(loaded->has_value());
}

TEST_F(TokenStoreTest, MigrateIsIdempotent) {
    ASSERT_TRUE(store_->save({.userId = "u", .accessToken = "a", .refreshToken = "r"}));

    ASSERT_TRUE(store_->migrate());

    auto loaded = store_->load();
    ASSERT_TRUE(loaded.has_value());
    EXPECT_TRUE(loaded->has_value());
}

/// Uses a real database file so the on-disk bytes (main file + WAL) can be inspected.
class TokenStoreOnDiskTest : public ::testing::Test {
protected:
    void SetUp() override {
        dbFile_ = dir_.path() / "aedst.sqlite3";
        auto connection = SqliteConnection::open(dbFile_);
        ASSERT_TRUE(connection.has_value()) << connection.error().message;
        connection_ = std::make_shared<SqliteConnection>(std::move(*connection));
        store_ = std::make_unique<TokenStore>(connection_, makeStorage());
        ASSERT_TRUE(store_->migrate());
    }

    [[nodiscard]] std::filesystem::path walFile() const {
        std::filesystem::path wal = dbFile_;
        wal += "-wal";
        return wal;
    }

    /// Main database file followed by the -wal file, as raw bytes.
    [[nodiscard]] std::string diskBytes() const {
        return test_support::readAllBytes(dbFile_) + test_support::readAllBytes(walFile());
    }

    test_support::TempDirectory dir_;
    std::filesystem::path dbFile_;
    std::shared_ptr<SqliteConnection> connection_;
    std::unique_ptr<TokenStore> store_;
};

TEST_F(TokenStoreOnDiskTest, ClearLeavesNoTokenBytesOnDisk) {
    const std::string accessToken = "plaintext-access-token-0123456789";
    const std::string refreshToken = "plaintext-refresh-token-9876543210";
    ASSERT_TRUE(store_->save({.userId = "user", .accessToken = accessToken, .refreshToken = refreshToken}));

    // Capture the stored ciphertext so absence can be checked for it as well.
    auto select = connection_->prepare("SELECT access_token, refresh_token FROM auth_session");
    ASSERT_TRUE(select.has_value());
    ASSERT_TRUE(select->step().value_or(false));
    const auto accessBlob = select->columnBlob(0);
    const auto refreshBlob = select->columnBlob(1);
    const std::string accessCipher(accessBlob.begin(), accessBlob.end());
    const std::string refreshCipher(refreshBlob.begin(), refreshBlob.end());
    ASSERT_TRUE(select->reset());

    const std::string before = diskBytes();
    EXPECT_EQ(before.find(accessToken), std::string::npos);
    EXPECT_EQ(before.find(refreshToken), std::string::npos);
    // Sanity: the check below is only meaningful if the ciphertext was on disk.
    EXPECT_NE(before.find(accessCipher), std::string::npos);

    ASSERT_TRUE(store_->clear());

    const std::string after = diskBytes();
    EXPECT_EQ(after.find(accessToken), std::string::npos);
    EXPECT_EQ(after.find(refreshToken), std::string::npos);
    EXPECT_EQ(after.find(accessCipher), std::string::npos);
    EXPECT_EQ(after.find(refreshCipher), std::string::npos);
}

TEST_F(TokenStoreOnDiskTest, ClearTruncatesWal) {
    ASSERT_TRUE(store_->save({.userId = "u", .accessToken = "a", .refreshToken = "r"}));
    ASSERT_TRUE(store_->clear());

    const auto wal = walFile();
    std::error_code ec;
    if (std::filesystem::exists(wal, ec)) {
        EXPECT_EQ(std::filesystem::file_size(wal), 0U);
    }
}

/// Budget for GUI-thread use: TokenStore runs on the GUI thread on purpose (see
/// the threading contract in token_store.hpp). If this fails, that decision must
/// be revisited rather than the bound loosened.
TEST(PerformanceBudget, TokenStoreRoundTrips) {
    auto connection = SqliteConnection::openInMemory();
    ASSERT_TRUE(connection.has_value());
    auto shared = std::make_shared<SqliteConnection>(std::move(*connection));
    TokenStore store(shared, makeStorage());
    ASSERT_TRUE(store.migrate());

    const StoredTokens tokens{
        .userId = "user-1",
        .accessToken = std::string(900, 'a'), // realistic JWT size
        .refreshToken = std::string(300, 'r'),
        .accessTokenExpiresAtEpochSeconds = 1'800'000'000,
    };
    constexpr int kRoundTrips = 100;
    constexpr std::chrono::milliseconds kBudget{50};

    // Best of three so a scheduler hiccup on a busy CI runner does not fail the build.
    std::chrono::nanoseconds best = std::chrono::nanoseconds::max();
    for (int attempt = 0; attempt < 3; ++attempt) {
        const auto start = std::chrono::steady_clock::now();
        for (int i = 0; i < kRoundTrips; ++i) {
            ASSERT_TRUE(store.save(tokens));
            auto loaded = store.load();
            ASSERT_TRUE(loaded.has_value());
            ASSERT_TRUE(loaded->has_value());
        }
        best = std::min(best,
                        std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start));
    }

    EXPECT_LT(best, kBudget) << kRoundTrips << " round trips took "
                             << std::chrono::duration_cast<std::chrono::microseconds>(best).count() << " us";
}

} // namespace
} // namespace aedst::persistence
