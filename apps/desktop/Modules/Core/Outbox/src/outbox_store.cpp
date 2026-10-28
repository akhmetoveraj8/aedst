#include "aedst/outbox/outbox_store.hpp"

#include <cstdint>
#include <string>
#include <type_traits>
#include <utility>

namespace aedst::outbox::store {
namespace {

using persistence::SqliteConnection;
using persistence::SqliteStatement;

template <typename T>
core::VoidOutcome bindOne(SqliteStatement& statement, int index, const T& value) {
    if constexpr (std::is_convertible_v<const T&, std::string_view>) {
        return statement.bind(index, std::string_view(value));
    } else {
        return statement.bind(index, static_cast<std::int64_t>(value));
    }
}

/// Prepares `sql` and binds `args` to ?1, ?2, ... (text for anything string-like, int64 otherwise).
template <typename... Args>
core::Outcome<SqliteStatement> prepared(SqliteConnection& connection, std::string_view sql, const Args&... args) {
    auto statement = connection.prepare(sql);
    if (!statement) {
        return core::fail(statement.error());
    }
    int index = 0;
    core::VoidOutcome bound = core::ok();
    ((bound = bound ? bindOne(*statement, ++index, args) : std::move(bound)), ...);
    if (!bound) {
        return core::fail(bound.error());
    }
    return statement;
}

template <typename... Args>
core::VoidOutcome run(SqliteConnection& connection, std::string_view sql, const Args&... args) {
    auto statement = prepared(connection, sql, args...);
    if (!statement) {
        return core::fail(statement.error());
    }
    if (auto stepped = statement->step(); !stepped) {
        return core::fail(stepped.error());
    }
    return core::ok();
}

OutboxItem readRow(const SqliteStatement& row) {
    return OutboxItem{.id = row.columnText(0),
                      .type = row.columnText(1),
                      .payload = row.columnText(2),
                      .attempts = static_cast<int>(row.columnInt64(3)),
                      .status = row.columnInt64(4) == 0 ? OutboxStatus::Pending : OutboxStatus::Failed,
                      .createdAtMs = row.columnInt64(5),
                      .lastError = row.isNull(6) ? std::string{} : row.columnText(6)};
}

constexpr std::string_view kColumns = "id, type, payload, attempts, status, created_at, last_error";

template <typename... Args>
core::Outcome<std::vector<OutboxItem>> select(SqliteConnection& connection, std::string_view sql, const Args&... args) {
    auto statement = prepared(connection, sql, args...);
    if (!statement) {
        return core::fail(statement.error());
    }
    std::vector<OutboxItem> items;
    for (;;) {
        auto hasRow = statement->step();
        if (!hasRow) {
            return core::fail(hasRow.error());
        }
        if (!*hasRow) {
            return items;
        }
        items.push_back(readRow(*statement));
    }
}

} // namespace

core::VoidOutcome enqueue(SqliteConnection& connection, const OutboxItem& item) {
    return run(connection, "INSERT OR IGNORE INTO outbox (id, type, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
               item.id, item.type, item.payload, item.createdAtMs);
}

core::Outcome<std::vector<OutboxItem>> pending(SqliteConnection& connection, int limit) {
    return select(connection, "SELECT " + std::string(kColumns) + " FROM outbox WHERE status = 0 ORDER BY seq LIMIT ?1",
                  limit);
}

core::Outcome<std::vector<OutboxItem>> all(SqliteConnection& connection) {
    return select(connection, "SELECT " + std::string(kColumns) + " FROM outbox ORDER BY seq");
}

core::Outcome<int> pendingCount(SqliteConnection& connection) {
    auto statement = prepared(connection, "SELECT COUNT(*) FROM outbox WHERE status = 0");
    if (!statement) {
        return core::fail(statement.error());
    }
    auto hasRow = statement->step();
    if (!hasRow) {
        return core::fail(hasRow.error());
    }
    return *hasRow ? static_cast<int>(statement->columnInt64(0)) : 0;
}

core::VoidOutcome remove(SqliteConnection& connection, std::string_view id) {
    return run(connection, "DELETE FROM outbox WHERE id = ?1", id);
}

core::VoidOutcome recordAttempt(SqliteConnection& connection, std::string_view id, std::string_view errorKind) {
    return run(connection, "UPDATE outbox SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2", errorKind, id);
}

core::VoidOutcome markFailed(SqliteConnection& connection, std::string_view id, std::string_view errorKind) {
    return run(connection, "UPDATE outbox SET status = 1, last_error = ?1 WHERE id = ?2", errorKind, id);
}

core::VoidOutcome clear(SqliteConnection& connection) {
    if (auto deleted = run(connection, "DELETE FROM outbox"); !deleted) {
        return deleted;
    }
    return connection.truncateWal();
}

} // namespace aedst::outbox::store
