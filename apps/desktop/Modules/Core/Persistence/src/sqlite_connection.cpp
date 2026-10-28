#include "aedst/persistence/sqlite_connection.hpp"

#include <sqlite3.h>

#include <string>
#include <string_view>
#include <utility>

namespace aedst::persistence {
namespace {

// busy_timeout first so the WAL switch below waits for a competing process
// instead of failing. secure_delete zero-fills freed content; TokenStore::clear()
// additionally truncates the WAL so nothing lingers there either.
constexpr std::string_view kFilePragmas = "PRAGMA busy_timeout = 5000;"
                                          "PRAGMA journal_mode = WAL;"
                                          "PRAGMA synchronous = NORMAL;"
                                          "PRAGMA foreign_keys = ON;"
                                          "PRAGMA secure_delete = ON;";

constexpr std::string_view kMemoryPragmas = "PRAGMA busy_timeout = 5000;"
                                            "PRAGMA foreign_keys = ON;"
                                            "PRAGMA secure_delete = ON;";

} // namespace

void SqliteConnection::Closer::operator()(sqlite3* database) const noexcept {
    sqlite3_close_v2(database);
}

SqliteConnection::SqliteConnection(sqlite3* database) noexcept : database_(database) {}

core::Outcome<SqliteConnection> SqliteConnection::open(const std::filesystem::path& file) {
    sqlite3* raw = nullptr;
    constexpr int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX;
    // sqlite3 expects UTF-8 on every platform; path::string() would be the ANSI code page on Windows.
    const std::u8string utf8Path = file.u8string();
    const int rc = sqlite3_open_v2(reinterpret_cast<const char*>(utf8Path.c_str()), &raw, flags, nullptr);

    // sqlite3 allocates a handle even on failure; owning it here guarantees it is closed.
    SqliteConnection connection(raw);
    if (rc != SQLITE_OK) {
        return core::fail(core::Error::storage("sqlite3_open_v2 failed: " + connection.lastErrorMessage()));
    }
    if (auto pragmas = connection.execute(kFilePragmas); !pragmas) {
        return core::fail(pragmas.error());
    }
    return connection;
}

core::Outcome<SqliteConnection> SqliteConnection::openInMemory() {
    sqlite3* raw = nullptr;
    const int rc = sqlite3_open_v2(":memory:", &raw, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr);
    SqliteConnection connection(raw);
    if (rc != SQLITE_OK) {
        return core::fail(core::Error::storage("sqlite3_open_v2(:memory:) failed: " + connection.lastErrorMessage()));
    }
    if (auto pragmas = connection.execute(kMemoryPragmas); !pragmas) {
        return core::fail(pragmas.error());
    }
    return connection;
}

core::VoidOutcome SqliteConnection::execute(std::string_view sql) {
    const std::string statement(sql);
    char* errorMessage = nullptr;
    const int rc = sqlite3_exec(database_.get(), statement.c_str(), nullptr, nullptr, &errorMessage);
    if (rc != SQLITE_OK) {
        std::string message = errorMessage != nullptr ? errorMessage : lastErrorMessage();
        sqlite3_free(errorMessage);
        return core::fail(core::Error::storage(std::move(message)));
    }
    return core::ok();
}

core::Outcome<SqliteStatement> SqliteConnection::prepare(std::string_view sql) {
    sqlite3_stmt* raw = nullptr;
    const int rc = sqlite3_prepare_v2(database_.get(), sql.data(), static_cast<int>(sql.size()), &raw, nullptr);
    SqliteStatement statement(raw);
    if (rc != SQLITE_OK) {
        return core::fail(core::Error::storage("prepare failed: " + lastErrorMessage()));
    }
    return statement;
}

core::Outcome<Transaction> SqliteConnection::beginTransaction() {
    // IMMEDIATE takes the write lock up front, so a concurrent writer surfaces as
    // a busy error here rather than as a failure in the middle of the transaction.
    if (auto begun = execute("BEGIN IMMEDIATE"); !begun) {
        return core::fail(begun.error());
    }
    return Transaction(this);
}

core::VoidOutcome SqliteConnection::truncateWal() {
    return execute("PRAGMA wal_checkpoint(TRUNCATE)");
}

sqlite3* SqliteConnection::handle() const noexcept {
    return database_.get();
}

std::string SqliteConnection::lastErrorMessage() const {
    if (!database_) {
        return "no database handle";
    }
    return sqlite3_errmsg(database_.get());
}

// --- Transaction ---------------------------------------------------------------------

Transaction::Transaction(SqliteConnection* connection) noexcept : connection_(connection) {}

Transaction::Transaction(Transaction&& other) noexcept : connection_(std::exchange(other.connection_, nullptr)) {}

Transaction& Transaction::operator=(Transaction&& other) noexcept {
    if (this != &other) {
        rollback();
        connection_ = std::exchange(other.connection_, nullptr);
    }
    return *this;
}

Transaction::~Transaction() {
    rollback();
}

core::VoidOutcome Transaction::commit() {
    if (connection_ == nullptr) {
        return core::fail(core::Error::storage("transaction is not active"));
    }
    auto committed = connection_->execute("COMMIT");
    if (committed) {
        connection_ = nullptr;
    }
    return committed;
}

void Transaction::rollback() noexcept {
    if (connection_ != nullptr) {
        SqliteConnection* const connection = std::exchange(connection_, nullptr);
        try {
            // Nothing useful can be done if ROLLBACK itself fails.
            [[maybe_unused]] const auto ignored = connection->execute("ROLLBACK");
        } catch (...) { // NOLINT(bugprone-empty-catch): only std::bad_alloc is possible here
        }
    }
}

} // namespace aedst::persistence
