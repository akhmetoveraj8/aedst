#include "aedst/persistence/token_store.hpp"

#include "aedst/core/secure_memory.hpp"
#include "aedst/persistence/migrator.hpp"
#include "aedst/persistence/secure_storage.hpp"
#include "aedst/persistence/sqlite_connection.hpp"

#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace aedst::persistence {
namespace {

std::span<const std::uint8_t> bytesOf(std::string_view text) {
    return {reinterpret_cast<const std::uint8_t*>(text.data()), text.size()};
}

/// Copies decrypted bytes into a string and wipes the source buffer.
std::string takeString(std::vector<std::uint8_t>& bytes) {
    std::string text(bytes.begin(), bytes.end());
    core::secureWipe(bytes);
    return text;
}

} // namespace

TokenStore::TokenStore(std::shared_ptr<SqliteConnection> connection, std::shared_ptr<const SecureStorage> secureStorage)
    : connection_(std::move(connection)), secureStorage_(std::move(secureStorage)) {}

core::VoidOutcome TokenStore::migrate() {
    const Migrator migrator(appMigrations());
    auto version = migrator.migrate(*connection_);
    if (!version) {
        return core::fail(version.error());
    }
    return core::ok();
}

core::VoidOutcome TokenStore::save(const StoredTokens& tokens) {
    auto access = secureStorage_->protect(bytesOf(tokens.accessToken));
    if (!access) {
        return core::fail(access.error());
    }
    auto refresh = secureStorage_->protect(bytesOf(tokens.refreshToken));
    if (!refresh) {
        return core::fail(refresh.error());
    }
    auto fingerprint = SecureStorage::sha256Hex(tokens.refreshToken);
    if (!fingerprint) {
        return core::fail(fingerprint.error());
    }

    auto statement =
        connection_->prepare("INSERT OR REPLACE INTO auth_session "
                             "(id, user_id, access_token, refresh_token, access_expires_at, refresh_fingerprint) "
                             "VALUES (1, ?1, ?2, ?3, ?4, ?5)");
    if (!statement) {
        return core::fail(statement.error());
    }
    for (auto bound : {statement->bind(1, tokens.userId), statement->bind(2, std::span<const std::uint8_t>(*access)),
                       statement->bind(3, std::span<const std::uint8_t>(*refresh)),
                       statement->bind(4, tokens.accessTokenExpiresAtEpochSeconds), statement->bind(5, *fingerprint)}) {
        if (!bound) {
            return bound;
        }
    }
    if (auto stepped = statement->step(); !stepped) {
        return core::fail(stepped.error());
    }
    return core::ok();
}

core::Outcome<std::optional<StoredTokens>> TokenStore::load() const {
    auto statement = connection_->prepare(
        "SELECT user_id, access_token, refresh_token, access_expires_at FROM auth_session WHERE id = 1");
    if (!statement) {
        return core::fail(statement.error());
    }
    auto hasRow = statement->step();
    if (!hasRow) {
        return core::fail(hasRow.error());
    }
    if (!*hasRow) {
        return std::optional<StoredTokens>{};
    }

    auto access = secureStorage_->unprotect(statement->columnBlob(1));
    if (!access) {
        return core::fail(access.error());
    }
    auto refresh = secureStorage_->unprotect(statement->columnBlob(2));
    if (!refresh) {
        core::secureWipe(*access);
        return core::fail(refresh.error());
    }

    return std::optional<StoredTokens>{StoredTokens{
        .userId = statement->columnText(0),
        .accessToken = takeString(*access),
        .refreshToken = takeString(*refresh),
        .accessTokenExpiresAtEpochSeconds = statement->columnInt64(3),
    }};
}

core::VoidOutcome TokenStore::clear() {
    if (auto deleted = connection_->execute("DELETE FROM auth_session"); !deleted) {
        return deleted;
    }
    // Deleted pages are zero-filled (secure_delete) but the previous row image may
    // still sit in the WAL until it is checkpointed away.
    return connection_->truncateWal();
}

} // namespace aedst::persistence
