#include "aedst/persistence/sqlite_statement.hpp"

#include <sqlite3.h>

namespace aedst::persistence {
namespace {
// SQLITE_TRANSIENT is a C-style cast macro (-Wold-style-cast); spell it once here.
const sqlite3_destructor_type kTransient = reinterpret_cast<sqlite3_destructor_type>(-1);
} // namespace

void SqliteStatement::Finalizer::operator()(sqlite3_stmt* statement) const noexcept {
    sqlite3_finalize(statement);
}

SqliteStatement::SqliteStatement(sqlite3_stmt* statement) noexcept : statement_(statement) {}

core::VoidOutcome SqliteStatement::bind(int index, std::string_view value) {
    return check(sqlite3_bind_text(statement_.get(), index, value.empty() ? "" : value.data(),
                                   static_cast<int>(value.size()), kTransient));
}

core::VoidOutcome SqliteStatement::bind(int index, std::int64_t value) {
    return check(sqlite3_bind_int64(statement_.get(), index, static_cast<sqlite3_int64>(value)));
}

core::VoidOutcome SqliteStatement::bind(int index, std::span<const std::uint8_t> blob) {
    if (blob.empty()) {
        // A null data pointer would bind SQL NULL; an empty blob is a distinct value.
        return check(sqlite3_bind_zeroblob(statement_.get(), index, 0));
    }
    return check(sqlite3_bind_blob(statement_.get(), index, blob.data(), static_cast<int>(blob.size()), kTransient));
}

core::VoidOutcome SqliteStatement::bindNull(int index) {
    return check(sqlite3_bind_null(statement_.get(), index));
}

core::Outcome<bool> SqliteStatement::step() {
    const int rc = sqlite3_step(statement_.get());
    if (rc == SQLITE_ROW) {
        return true;
    }
    if (rc == SQLITE_DONE) {
        return false;
    }
    if (auto error = check(rc); !error) {
        return core::fail(error.error());
    }
    return false;
}

core::VoidOutcome SqliteStatement::reset() {
    if (auto cleared = check(sqlite3_clear_bindings(statement_.get())); !cleared) {
        return cleared;
    }
    return check(sqlite3_reset(statement_.get()));
}

std::string SqliteStatement::columnText(int column) const {
    const unsigned char* text = sqlite3_column_text(statement_.get(), column);
    if (text == nullptr) {
        return {};
    }
    const int size = sqlite3_column_bytes(statement_.get(), column);
    return {reinterpret_cast<const char*>(text), static_cast<std::size_t>(size)};
}

std::int64_t SqliteStatement::columnInt64(int column) const {
    return static_cast<std::int64_t>(sqlite3_column_int64(statement_.get(), column));
}

std::vector<std::uint8_t> SqliteStatement::columnBlob(int column) const {
    const auto* data = static_cast<const std::uint8_t*>(sqlite3_column_blob(statement_.get(), column));
    const int size = sqlite3_column_bytes(statement_.get(), column);
    if (data == nullptr || size <= 0) {
        return {};
    }
    return {data, data + size};
}

bool SqliteStatement::isNull(int column) const {
    return sqlite3_column_type(statement_.get(), column) == SQLITE_NULL;
}

core::VoidOutcome SqliteStatement::check(int resultCode) const {
    if (resultCode == SQLITE_OK || resultCode == SQLITE_ROW || resultCode == SQLITE_DONE) {
        return core::ok();
    }
    sqlite3* database = statement_ ? sqlite3_db_handle(statement_.get()) : nullptr;
    std::string message = database != nullptr ? sqlite3_errmsg(database) : sqlite3_errstr(resultCode);
    return core::fail(core::Error::storage(std::move(message)));
}

} // namespace aedst::persistence
