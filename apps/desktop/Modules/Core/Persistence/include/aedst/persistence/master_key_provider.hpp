#pragma once

#include "aedst/core/outcome.hpp"
#include "aedst/core/secure_memory.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <string_view>
#include <utility>
#include <vector>

namespace aedst::persistence {

/// Size in bytes of the AES-256 master key every provider hands out.
inline constexpr std::size_t kMasterKeySize = 32;

/// Key material that wipes itself on destruction. Move-only so a key is never
/// silently duplicated; a moved-from instance is empty.
class SecretBytes final {
public:
    SecretBytes() = default;

    explicit SecretBytes(std::vector<std::uint8_t> bytes) noexcept : bytes_(std::move(bytes)) {}

    SecretBytes(const SecretBytes&) = delete;
    SecretBytes& operator=(const SecretBytes&) = delete;

    SecretBytes(SecretBytes&& other) noexcept : bytes_(std::move(other.bytes_)) { other.bytes_.clear(); }

    SecretBytes& operator=(SecretBytes&& other) noexcept {
        if (this != &other) {
            wipe();
            bytes_ = std::move(other.bytes_);
            other.bytes_.clear();
        }
        return *this;
    }

    ~SecretBytes() { wipe(); }

    [[nodiscard]] std::span<const std::uint8_t> view() const noexcept { return bytes_; }

    [[nodiscard]] std::size_t size() const noexcept { return bytes_.size(); }

    [[nodiscard]] bool empty() const noexcept { return bytes_.empty(); }

private:
    void wipe() noexcept { core::secureWipe(bytes_); }

    std::vector<std::uint8_t> bytes_;
};

/// Source of the 32-byte AES-256-GCM master key used by SecureStorage.
///
/// loadOrCreate() returns the existing key, or generates and persists a new one
/// the first time. Implementations must be safe to call from any thread and must
/// never log or otherwise expose key bytes. SecureStorage caches the result, so
/// implementations need not be fast.
class MasterKeyProvider {
public:
    MasterKeyProvider() = default;
    MasterKeyProvider(const MasterKeyProvider&) = delete;
    MasterKeyProvider& operator=(const MasterKeyProvider&) = delete;
    MasterKeyProvider(MasterKeyProvider&&) = delete;
    MasterKeyProvider& operator=(MasterKeyProvider&&) = delete;
    virtual ~MasterKeyProvider() = default;

    /// Short stable identifier for logs, e.g. "keychain", "file".
    [[nodiscard]] virtual std::string_view name() const noexcept = 0;
    [[nodiscard]] virtual core::Outcome<SecretBytes> loadOrCreate() = 0;
};

/// Random key stored in a file created atomically with mode 0600 on POSIX.
/// Fallback for hosts without a keyring (headless Linux, Flatpak without the
/// Secret Service portal) and the provider used by tests. The key sits beside
/// the data, so it protects against casual copying of the database only.
/// On Windows the file inherits the user-profile ACL; production Windows builds
/// use DpapiMasterKeyProvider instead.
class FileMasterKeyProvider final : public MasterKeyProvider {
public:
    explicit FileMasterKeyProvider(std::filesystem::path keyFile);

    [[nodiscard]] std::string_view name() const noexcept override;
    [[nodiscard]] core::Outcome<SecretBytes> loadOrCreate() override;

private:
    std::filesystem::path keyFile_;
};

#if defined(_WIN32)
/// Random master key wrapped with DPAPI (CryptProtectData, per-user scope plus a
/// fixed application entropy blob) and stored as an opaque file. Another Windows
/// account cannot unwrap it; nothing key-shaped is stored in clear.
class DpapiMasterKeyProvider final : public MasterKeyProvider {
public:
    explicit DpapiMasterKeyProvider(std::filesystem::path wrappedKeyFile);

    [[nodiscard]] std::string_view name() const noexcept override;
    [[nodiscard]] core::Outcome<SecretBytes> loadOrCreate() override;

private:
    std::filesystem::path wrappedKeyFile_;
};
#endif

/// Minimal operations a platform keyring (Secret Service) must
/// offer. Kept separate from MasterKeyProvider so migration/generation logic is
/// shared and testable with a fake backend.
class KeyringBackend {
public:
    KeyringBackend() = default;
    KeyringBackend(const KeyringBackend&) = delete;
    KeyringBackend& operator=(const KeyringBackend&) = delete;
    KeyringBackend(KeyringBackend&&) = delete;
    KeyringBackend& operator=(KeyringBackend&&) = delete;
    virtual ~KeyringBackend() = default;

    [[nodiscard]] virtual std::string_view name() const noexcept = 0;
    /// nullopt when no entry exists; an Error when the keyring is unreachable.
    [[nodiscard]] virtual core::Outcome<std::optional<SecretBytes>> lookup() = 0;
    /// Creates or replaces the entry.
    [[nodiscard]] virtual core::VoidOutcome store(std::span<const std::uint8_t> key) = 0;
};

/// Keyring-backed provider. On first use it migrates a legacy plain key file
/// (`legacyKeyFile`, may be empty) into the keyring and then securely deletes
/// the file; otherwise it generates a fresh random key.
class KeyringMasterKeyProvider final : public MasterKeyProvider {
public:
    KeyringMasterKeyProvider(std::unique_ptr<KeyringBackend> backend, std::filesystem::path legacyKeyFile);

    [[nodiscard]] std::string_view name() const noexcept override;
    [[nodiscard]] core::Outcome<SecretBytes> loadOrCreate() override;

private:
    std::unique_ptr<KeyringBackend> backend_;
    std::filesystem::path legacyKeyFile_;
};

/// Picks the best provider for this host and logs (never the key) which one:
///   Windows: DPAPI                      (`<dataDirectory>/secure.key.dpapi`)
///   Linux:   Secret Service (libsecret; only when built with
///            AEDST_HAVE_LIBSECRET)      (falls back to file if unavailable)
///   other/fallback: FileMasterKeyProvider (`<dataDirectory>/secure.key`)
/// A legacy `<dataDirectory>/secure.key` is migrated into a keyring when one is
/// usable. The keyring is probed once here, so the returned provider is known to
/// have worked at construction time.
[[nodiscard]] std::unique_ptr<MasterKeyProvider>
createPlatformMasterKeyProvider(const std::filesystem::path& dataDirectory);

} // namespace aedst::persistence
