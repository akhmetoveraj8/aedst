#include "aedst/persistence/migrator.hpp"

#include "aedst/core/logger.hpp"
#include "aedst/persistence/sqlite_connection.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string>

namespace aedst::persistence {
namespace {

// Migration #1 predates the migrator: databases created by earlier builds already
// have this table at user_version 0, hence IF NOT EXISTS.
constexpr std::string_view kCreateAuthSession = R"sql(
CREATE TABLE IF NOT EXISTS auth_session (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    user_id             TEXT    NOT NULL,
    access_token        BLOB    NOT NULL,
    refresh_token       BLOB    NOT NULL,
    access_expires_at   INTEGER NOT NULL,
    refresh_fingerprint TEXT    NOT NULL
);
)sql";

// Offline write queue (Core/Outbox, ADR-0013's desktop counterpart). `seq` is the delivery order, `id` the
// Idempotency-Key (UNIQUE, so a duplicate enqueue is ignored), `status` 0 = pending / 1 = failed (parked).
// `last_error` holds an error KIND, never a message. The payload is NOT encrypted: no secrets, no tokens.
constexpr std::string_view kCreateOutbox = R"sql(
CREATE TABLE IF NOT EXISTS outbox (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    id         TEXT    NOT NULL UNIQUE,
    type       TEXT    NOT NULL,
    payload    TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    status     INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS outbox_status_seq ON outbox (status, seq);
)sql";

// Small key/value cache for non-secret, server-published data that must survive a restart (the last-known server
// capabilities, ADR-0035). `value` is an opaque blob owned by the writer; secrets never go here (see SecureStorage).
constexpr std::string_view kCreateKv = R"sql(
CREATE TABLE IF NOT EXISTS kv (
    key        TEXT    PRIMARY KEY,
    value      BLOB    NOT NULL,
    updated_at INTEGER NOT NULL
);
)sql";

constexpr std::array<Migration, 3> kAppMigrations{{
    {.version = 1, .name = "create_auth_session", .sql = kCreateAuthSession},
    {.version = 2, .name = "create_outbox", .sql = kCreateOutbox},
    {.version = 3, .name = "create_kv", .sql = kCreateKv},
}};

core::Outcome<std::int64_t> readUserVersion(SqliteConnection& connection) {
    auto statement = connection.prepare("PRAGMA user_version");
    if (!statement) {
        return core::fail(statement.error());
    }
    auto hasRow = statement->step();
    if (!hasRow) {
        return core::fail(hasRow.error());
    }
    if (!*hasRow) {
        return core::fail(core::Error::storage("PRAGMA user_version returned no row"));
    }
    return statement->columnInt64(0);
}

} // namespace

std::span<const Migration> appMigrations() noexcept {
    return kAppMigrations;
}

int Migrator::latestVersion() const noexcept {
    return migrations_.empty() ? 0 : migrations_.back().version;
}

core::Outcome<int> Migrator::migrate(SqliteConnection& connection) const {
    for (std::size_t i = 0; i < migrations_.size(); ++i) {
        if (migrations_[i].version != static_cast<int>(i) + 1) {
            return core::fail(core::Error::invalidInput("migrations must be numbered 1..N without gaps"));
        }
    }
    const int latest = latestVersion();

    auto current = readUserVersion(connection);
    if (!current) {
        return core::fail(current.error());
    }
    if (*current > latest) {
        return core::fail(core::Error::storage("database schema version " + std::to_string(*current) +
                                               " is newer than this application supports (" + std::to_string(latest) +
                                               "); refusing to open it"));
    }

    for (const Migration& migration : migrations_) {
        if (migration.version <= *current) {
            continue;
        }

        auto transaction = connection.beginTransaction();
        if (!transaction) {
            return core::fail(transaction.error());
        }
        // Re-check under the write lock: another process may have migrated since
        // we read the version above.
        auto locked = readUserVersion(connection);
        if (!locked) {
            return core::fail(locked.error());
        }
        if (*locked >= migration.version) {
            transaction->rollback();
            current = locked;
            continue;
        }

        const std::string label =
            "migration " + std::to_string(migration.version) + " (" + std::string(migration.name) + ")";
        if (auto applied = connection.execute(migration.sql); !applied) {
            return core::fail(core::Error::storage(label + " failed: " + applied.error().message));
        }
        if (auto stamped = connection.execute("PRAGMA user_version = " + std::to_string(migration.version)); !stamped) {
            return core::fail(core::Error::storage(label + " failed to record version: " + stamped.error().message));
        }
        if (auto committed = transaction->commit(); !committed) {
            return core::fail(core::Error::storage(label + " failed to commit: " + committed.error().message));
        }
        current = migration.version;
        core::AedstLogger::info("Applied {}", label);
    }
    return static_cast<int>(*current);
}

} // namespace aedst::persistence
