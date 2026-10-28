#pragma once

#include "aedst/core/outcome.hpp"
#include "aedst/core/secure_memory.hpp"

#include <memory>
#include <optional>
#include <string>

namespace aedst::oidc {

/// What survives an application restart: the refresh token and the subject it belongs to.
/// Access and ID tokens are deliberately NOT persisted: they are short-lived, large (a JWT can
/// exceed the Windows Credential Manager blob limit) and cheap to re-derive from the refresh token.
struct StoredIdentity {
    core::SecretString refreshToken;
    std::string subject;
};

/// Persistent, OS-protected storage for the StoredIdentity. Implementations are asynchronous
/// because the platform keychains talk to other processes (D-Bus Secret Service, KWallet); the
/// completions run on the caller's event loop. There is intentionally NO file fallback: if the
/// OS credential store is unavailable the operation fails with ErrorCode::Storage and the caller
/// tells the user (headless Linux without a Secret Service is the usual cause).
class RefreshTokenStore {
public:
    RefreshTokenStore() = default;
    RefreshTokenStore(const RefreshTokenStore&) = delete;
    RefreshTokenStore& operator=(const RefreshTokenStore&) = delete;
    RefreshTokenStore(RefreshTokenStore&&) = delete;
    RefreshTokenStore& operator=(RefreshTokenStore&&) = delete;
    virtual ~RefreshTokenStore() = default;

    /// nullopt = nothing stored (not an error).
    virtual void load(core::Completion<std::optional<StoredIdentity>> done) = 0;
    virtual void save(const StoredIdentity& identity, core::Completion<void> done) = 0;
    /// Removing a missing entry is not an error.
    virtual void clear(core::Completion<void> done) = 0;
};

/// JSON envelope written to the keychain: {"v":1,"rt":"<refresh token>","sub":"<subject>"}.
[[nodiscard]] std::string serializeIdentity(const StoredIdentity& identity);
/// Strict inverse; a different version or missing/empty fields is an error (never a partial identity).
[[nodiscard]] core::Outcome<StoredIdentity> parseIdentity(const std::string& text);

/// Keychain entry name for one issuer + client: stable, free of the URL, and distinct per
/// environment so staging and production sessions never overwrite each other.
[[nodiscard]] std::string keychainEntryName(const std::string& issuer, const std::string& clientId);

/// Process-memory store for tests and for sessions that must not touch the OS keychain.
class InMemoryRefreshTokenStore final : public RefreshTokenStore {
public:
    void load(core::Completion<std::optional<StoredIdentity>> done) override;
    void save(const StoredIdentity& identity, core::Completion<void> done) override;
    void clear(core::Completion<void> done) override;

    /// Makes every following operation fail with ErrorCode::Storage (simulates a missing keychain).
    void setUnavailable(bool unavailable) { unavailable_ = unavailable; }

    [[nodiscard]] bool hasIdentity() const { return identity_.has_value(); }

private:
    std::optional<StoredIdentity> identity_;
    bool unavailable_{false};
};

/// QtKeychain-backed store (Windows Credential Manager, Linux Secret Service/libsecret/KWallet).
/// `service` is the keychain "service" name, `entry` the key from keychainEntryName().
[[nodiscard]] std::unique_ptr<RefreshTokenStore> makeKeychainRefreshTokenStore(std::string service, std::string entry);

} // namespace aedst::oidc
