#include "aedst/persistence/migrator.hpp"
#include "aedst/persistence/secure_storage.hpp"
#include "aedst/persistence/sqlite_connection.hpp"

#include <gtest/gtest.h>

#include <array>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <utility>

namespace aedst::persistence {
namespace {

std::int64_t userVersion(SqliteConnection& connection) {
    auto statement = connection.prepare("PRAGMA user_version");
    EXPECT_TRUE(statement.has_value());
    EXPECT_TRUE(statement->step().value_or(false));
    return statement->columnInt64(0);
}

bool tableExists(SqliteConnection& connection, const std::string& name) {
    auto statement = connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1");
    EXPECT_TRUE(statement.has_value());
    EXPECT_TRUE(statement->bind(1, std::string_view{name}));
    return statement->step().value_or(false);
}

class MigratorTest : public ::testing::Test {
protected:
    void SetUp() override {
        auto connection = SqliteConnection::openInMemory();
        ASSERT_TRUE(connection.has_value());
        connection_ = std::make_unique<SqliteConnection>(std::move(*connection));
    }

    std::unique_ptr<SqliteConnection> connection_;
};

constexpr std::array<Migration, 2> kTwoSteps{{
    {.version = 1, .name = "create_a", .sql = "CREATE TABLE a (id INTEGER PRIMARY KEY);"},
    {.version = 2,
     .name = "create_b",
     .sql = "CREATE TABLE b (id INTEGER PRIMARY KEY); INSERT INTO b (id) VALUES (1);"},
}};

TEST_F(MigratorTest, FreshDatabaseReachesLatestVersion) {
    const Migrator migrator(kTwoSteps);

    auto version = migrator.migrate(*connection_);

    ASSERT_TRUE(version.has_value()) << version.error().message;
    EXPECT_EQ(*version, 2);
    EXPECT_EQ(userVersion(*connection_), 2);
    EXPECT_TRUE(tableExists(*connection_, "a"));
    EXPECT_TRUE(tableExists(*connection_, "b"));
}

TEST_F(MigratorTest, RerunIsANoOp) {
    const Migrator migrator(kTwoSteps);
    ASSERT_TRUE(migrator.migrate(*connection_).has_value());
    // A second run would fail with "table a already exists" if it re-applied step 1.
    auto again = migrator.migrate(*connection_);

    ASSERT_TRUE(again.has_value()) << again.error().message;
    EXPECT_EQ(*again, 2);
}

TEST_F(MigratorTest, AppliesOnlyMissingMigrationsToAnOlderDatabase) {
    const Migrator first(std::span<const Migration>(kTwoSteps).first(1));
    ASSERT_TRUE(first.migrate(*connection_).has_value());
    ASSERT_EQ(userVersion(*connection_), 1);

    const Migrator full(kTwoSteps);
    auto version = full.migrate(*connection_);

    ASSERT_TRUE(version.has_value()) << version.error().message;
    EXPECT_EQ(*version, 2);
    EXPECT_TRUE(tableExists(*connection_, "b"));
}

TEST_F(MigratorTest, RefusesDatabaseNewerThanKnown) {
    ASSERT_TRUE(connection_->execute("PRAGMA user_version = 99"));
    const Migrator migrator(kTwoSteps);

    auto version = migrator.migrate(*connection_);

    ASSERT_FALSE(version.has_value());
    EXPECT_EQ(version.error().code, core::ErrorCode::Storage);
    EXPECT_NE(version.error().message.find("newer"), std::string::npos);
    EXPECT_EQ(userVersion(*connection_), 99);
    EXPECT_FALSE(tableExists(*connection_, "a"));
}

TEST_F(MigratorTest, FailingMigrationRollsBackAndKeepsVersion) {
    static constexpr std::array<Migration, 2> kFailing{{
        {.version = 1, .name = "ok", .sql = "CREATE TABLE good (id INTEGER PRIMARY KEY);"},
        {.version = 2, .name = "broken", .sql = "CREATE TABLE half_done (id INTEGER PRIMARY KEY); THIS IS NOT SQL;"},
    }};
    const Migrator migrator(kFailing);

    auto version = migrator.migrate(*connection_);

    ASSERT_FALSE(version.has_value());
    EXPECT_NE(version.error().message.find("broken"), std::string::npos);
    EXPECT_EQ(userVersion(*connection_), 1); // step 1 committed, step 2 rolled back
    EXPECT_TRUE(tableExists(*connection_, "good"));
    EXPECT_FALSE(tableExists(*connection_, "half_done"));
}

TEST_F(MigratorTest, RejectsMigrationListWithGaps) {
    static constexpr std::array<Migration, 1> kGap{{
        {.version = 2, .name = "skips_one", .sql = "CREATE TABLE x (id INTEGER);"},
    }};
    const Migrator migrator(kGap);

    auto version = migrator.migrate(*connection_);

    ASSERT_FALSE(version.has_value());
    EXPECT_EQ(version.error().code, core::ErrorCode::InvalidInput);
    EXPECT_FALSE(tableExists(*connection_, "x"));
}

TEST_F(MigratorTest, AppMigrationsCreateAuthSessionTable) {
    const Migrator migrator(appMigrations());

    auto version = migrator.migrate(*connection_);

    ASSERT_TRUE(version.has_value()) << version.error().message;
    EXPECT_EQ(*version, migrator.latestVersion());
    EXPECT_TRUE(tableExists(*connection_, "auth_session"));
}

TEST_F(MigratorTest, AppMigrationsAdoptPreMigratorDatabase) {
    // A database created by an earlier build: table present, user_version 0.
    ASSERT_TRUE(connection_->execute("CREATE TABLE auth_session (id INTEGER PRIMARY KEY CHECK (id = 1), "
                                     "user_id TEXT NOT NULL, access_token BLOB NOT NULL, refresh_token BLOB NOT NULL, "
                                     "access_expires_at INTEGER NOT NULL, refresh_fingerprint TEXT NOT NULL)"));
    const Migrator migrator(appMigrations());

    auto version = migrator.migrate(*connection_);

    ASSERT_TRUE(version.has_value()) << version.error().message;
    EXPECT_EQ(userVersion(*connection_), migrator.latestVersion());
}

// --- Schema history: a shipped migration is never edited, every older database upgrades -----------------------

/// SHA-256 of each shipped migration's SQL text, in order. A shipped migration must never change (databases of
/// users already ran it); fix mistakes with a NEW migration. When you append migration N+1, append its hash here,
/// and leave the existing entries alone. The test fails with the computed hash of whatever differs.
constexpr std::array<std::string_view, 3> kShippedMigrationHashes{
    "e5532b7c31d8aea3a84ba5d0de57ac3c57fe55c47bdc7457ede7b5bed46f29e1", // 1 create_auth_session
    "de4541bfb0574a2025deb4b403899efdd4cad1f9f5c5cc883b23b460ffcf9ab9", // 2 create_outbox
    "6b63e87e599197035b756042ec22e42bef7ce5fabdb54046424f7c92246be493", // 3 create_kv
};

TEST(SchemaHistoryTest, ShippedMigrationsAreFrozen) {
    const auto migrations = appMigrations();
    ASSERT_GE(migrations.size(), kShippedMigrationHashes.size()) << "a shipped migration was removed";
    for (std::size_t i = 0; i < kShippedMigrationHashes.size(); ++i) {
        const auto hash = SecureStorage::sha256Hex(migrations[i].sql);
        ASSERT_TRUE(hash.has_value());
        EXPECT_EQ(*hash, std::string(kShippedMigrationHashes[i]))
            << "migration " << migrations[i].version << " (" << migrations[i].name
            << ") was edited after it shipped; add a new migration instead";
    }
}

TEST(SchemaHistoryTest, EveryMigrationHasAHashOnceItIsAppended) {
    // Appending a migration without recording its hash silently lets the next edit through.
    EXPECT_EQ(appMigrations().size(), kShippedMigrationHashes.size())
        << "append the SHA-256 of the new migration to kShippedMigrationHashes";
}

TEST(SchemaHistoryTest, ADatabaseAtEveryPreviousVersionUpgradesAndKeepsItsRows) {
    const auto all = appMigrations();
    for (std::size_t from = 0; from < all.size(); ++from) {
        auto opened = SqliteConnection::openInMemory();
        ASSERT_TRUE(opened.has_value());
        SqliteConnection connection = std::move(*opened);

        // Build exactly what a build that knew only the first `from` migrations would have left behind.
        auto previous = Migrator(all.first(from)).migrate(connection);
        ASSERT_TRUE(previous.has_value()) << previous.error().message;
        ASSERT_EQ(userVersion(connection), static_cast<std::int64_t>(from));
        if (from >= 1) {
            ASSERT_TRUE(connection.execute("INSERT INTO auth_session (id, user_id, access_token, refresh_token, "
                                           "access_expires_at, refresh_fingerprint) "
                                           "VALUES (1, 'u1', x'01', x'02', 42, 'fp')"));
        }

        const Migrator current(all);
        auto upgraded = current.migrate(connection);
        ASSERT_TRUE(upgraded.has_value()) << "from version " << from << ": " << upgraded.error().message;
        EXPECT_EQ(*upgraded, current.latestVersion()) << "from version " << from;
        EXPECT_EQ(userVersion(connection), current.latestVersion());

        if (from >= 1) {
            auto row = connection.prepare("SELECT user_id, access_expires_at FROM auth_session WHERE id = 1");
            ASSERT_TRUE(row.has_value());
            ASSERT_TRUE(row->step().value_or(false)) << "the row written at version " << from << " was lost";
            EXPECT_EQ(row->columnText(0), "u1");
            EXPECT_EQ(row->columnInt64(1), 42);
        }
        // A second run of the same build is a no-op.
        auto again = current.migrate(connection);
        ASSERT_TRUE(again.has_value());
        EXPECT_EQ(*again, current.latestVersion());
    }
}

TEST(SchemaHistoryTest, TheLatestSchemaHasTheExpectedAuthSessionColumns) {
    auto opened = SqliteConnection::openInMemory();
    ASSERT_TRUE(opened.has_value());
    SqliteConnection connection = std::move(*opened);
    ASSERT_TRUE(Migrator(appMigrations()).migrate(connection).has_value());

    auto columns = connection.prepare("SELECT name FROM pragma_table_info('auth_session') ORDER BY cid");
    ASSERT_TRUE(columns.has_value());
    std::string names;
    while (columns->step().value_or(false)) {
        names += columns->columnText(0) + ",";
    }
    EXPECT_EQ(names, "id,user_id,access_token,refresh_token,access_expires_at,refresh_fingerprint,");
}

TEST(SchemaHistoryTest, ConnectionsUseTheDocumentedPragmas) {
    auto opened = SqliteConnection::openInMemory();
    ASSERT_TRUE(opened.has_value());
    SqliteConnection connection = std::move(*opened);
    const auto pragma = [&connection](const char* name) {
        auto statement = connection.prepare(std::string("PRAGMA ") + name);
        EXPECT_TRUE(statement.has_value());
        EXPECT_TRUE(statement->step().value_or(false));
        return statement->columnInt64(0);
    };
    EXPECT_EQ(pragma("foreign_keys"), 1);
    EXPECT_EQ(pragma("busy_timeout"), 5000);
    EXPECT_EQ(pragma("secure_delete"), 1);
}

TEST(TransactionTest, RollsBackUnlessCommitted) {
    auto opened = SqliteConnection::openInMemory();
    ASSERT_TRUE(opened.has_value());
    SqliteConnection connection = std::move(*opened);
    ASSERT_TRUE(connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)"));

    {
        auto transaction = connection.beginTransaction();
        ASSERT_TRUE(transaction.has_value());
        ASSERT_TRUE(connection.execute("INSERT INTO t (id) VALUES (1)"));
    } // destroyed without commit
    {
        auto transaction = connection.beginTransaction();
        ASSERT_TRUE(transaction.has_value());
        ASSERT_TRUE(connection.execute("INSERT INTO t (id) VALUES (2)"));
        ASSERT_TRUE(transaction->commit());
    }

    auto count = connection.prepare("SELECT id FROM t");
    ASSERT_TRUE(count.has_value());
    ASSERT_TRUE(count->step().value_or(false));
    EXPECT_EQ(count->columnInt64(0), 2);
    EXPECT_FALSE(count->step().value_or(true));
}

} // namespace
} // namespace aedst::persistence
