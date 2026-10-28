#include "aedst/persistence/kv_store.hpp"

#include "aedst/persistence/sqlite_connection.hpp"

#include <utility>

namespace aedst::persistence::kv {

core::VoidOutcome put(SqliteConnection& connection, std::string_view key, std::span<const std::uint8_t> value,
                      std::int64_t nowMs) {
    auto statement = connection.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)");
    if (!statement) {
        return core::fail(statement.error());
    }
    for (auto bound : {statement->bind(1, key), statement->bind(2, value), statement->bind(3, nowMs)}) {
        if (!bound) {
            return core::fail(bound.error());
        }
    }
    if (auto stepped = statement->step(); !stepped) {
        return core::fail(stepped.error());
    }
    return core::ok();
}

core::Outcome<std::optional<std::vector<std::uint8_t>>> get(SqliteConnection& connection, std::string_view key) {
    auto statement = connection.prepare("SELECT value FROM kv WHERE key = ?1");
    if (!statement) {
        return core::fail(statement.error());
    }
    if (auto bound = statement->bind(1, key); !bound) {
        return core::fail(bound.error());
    }
    auto hasRow = statement->step();
    if (!hasRow) {
        return core::fail(hasRow.error());
    }
    if (!*hasRow) {
        return std::optional<std::vector<std::uint8_t>>{};
    }
    return std::optional<std::vector<std::uint8_t>>{statement->columnBlob(0)};
}

core::VoidOutcome remove(SqliteConnection& connection, std::string_view key) {
    auto statement = connection.prepare("DELETE FROM kv WHERE key = ?1");
    if (!statement) {
        return core::fail(statement.error());
    }
    if (auto bound = statement->bind(1, key); !bound) {
        return core::fail(bound.error());
    }
    if (auto stepped = statement->step(); !stepped) {
        return core::fail(stepped.error());
    }
    return core::ok();
}

} // namespace aedst::persistence::kv
