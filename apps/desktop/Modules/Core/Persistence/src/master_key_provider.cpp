#include "aedst/persistence/master_key_provider.hpp"

#include "aedst/core/logger.hpp"
#include "key_file.hpp"

#include <array>
#include <memory>
#include <string>
#include <utility>

namespace aedst::persistence {

// --- FileMasterKeyProvider ---------------------------------------------------------

FileMasterKeyProvider::FileMasterKeyProvider(std::filesystem::path keyFile) : keyFile_(std::move(keyFile)) {}

std::string_view FileMasterKeyProvider::name() const noexcept {
    return "file";
}

core::Outcome<SecretBytes> FileMasterKeyProvider::loadOrCreate() {
    auto existing = detail::readKeyFile(keyFile_);
    if (!existing) {
        return core::fail(existing.error());
    }
    if (*existing) {
        return std::move(**existing);
    }

    auto key = detail::generateMasterKey();
    if (!key) {
        return core::fail(key.error());
    }
    auto created = detail::createFileExclusive(keyFile_, key->view());
    if (!created) {
        return core::fail(created.error());
    }
    if (*created) {
        return std::move(*key);
    }

    // Another process created the key between our read and our create: use theirs.
    auto winner = detail::readKeyFile(keyFile_);
    if (!winner) {
        return core::fail(winner.error());
    }
    if (!*winner) {
        return core::fail(core::Error::storage("secure storage key file vanished during creation"));
    }
    return std::move(**winner);
}

// --- KeyringMasterKeyProvider --------------------------------------------------------

KeyringMasterKeyProvider::KeyringMasterKeyProvider(std::unique_ptr<KeyringBackend> backend,
                                                   std::filesystem::path legacyKeyFile)
    : backend_(std::move(backend)), legacyKeyFile_(std::move(legacyKeyFile)) {}

std::string_view KeyringMasterKeyProvider::name() const noexcept {
    return backend_->name();
}

core::Outcome<SecretBytes> KeyringMasterKeyProvider::loadOrCreate() {
    auto found = backend_->lookup();
    if (!found) {
        return core::fail(found.error());
    }
    if (*found) {
        if ((*found)->size() != kMasterKeySize) {
            // Never overwrite silently: that would orphan everything encrypted with it.
            return core::fail(core::Error::storage("keyring master key entry is corrupt (unexpected size)"));
        }
        return std::move(**found);
    }

    // No key in the keyring yet: migrate the legacy plain key file if there is one.
    if (!legacyKeyFile_.empty()) {
        auto legacy = detail::readKeyFile(legacyKeyFile_);
        if (!legacy) {
            core::AedstLogger::warn("Ignoring unusable legacy key file: {}", legacy.error().message);
        } else if (*legacy) {
            if (auto stored = backend_->store((*legacy)->view()); !stored) {
                // Keep the file: the caller falls back to it, no data is lost.
                return core::fail(stored.error());
            }
            if (auto removed = detail::secureDeleteFile(legacyKeyFile_); !removed) {
                core::AedstLogger::warn("Legacy key file could not be fully erased: {}", removed.error().message);
            }
            core::AedstLogger::info("Migrated legacy key file into the {} keyring", backend_->name());
            return std::move(**legacy);
        }
    }

    auto key = detail::generateMasterKey();
    if (!key) {
        return core::fail(key.error());
    }
    if (auto stored = backend_->store(key->view()); !stored) {
        return core::fail(stored.error());
    }
    return std::move(*key);
}

// --- Provider selection --------------------------------------------------------------

std::unique_ptr<MasterKeyProvider> createPlatformMasterKeyProvider(const std::filesystem::path& dataDirectory) {
    const std::filesystem::path legacyKeyFile = dataDirectory / "secure.key";

#if defined(_WIN32)
    {
        auto dpapi = std::make_unique<DpapiMasterKeyProvider>(dataDirectory / "secure.key.dpapi");
        const auto probe = dpapi->loadOrCreate();
        if (probe) {
            core::AedstLogger::info("Secure storage master key provider: {}", dpapi->name());
            return dpapi;
        }
        core::AedstLogger::warn("DPAPI master key provider unavailable, falling back to key file: {}",
                                probe.error().message);
    }
#else
    std::array<std::unique_ptr<KeyringBackend>, 1> backends{detail::makeLibsecretBackend()};
    for (auto& backend : backends) {
        if (!backend) {
            continue;
        }
        auto provider = std::make_unique<KeyringMasterKeyProvider>(std::move(backend), legacyKeyFile);
        const auto probe = provider->loadOrCreate();
        if (probe) {
            core::AedstLogger::info("Secure storage master key provider: {}", provider->name());
            return provider;
        }
        core::AedstLogger::warn("Keyring '{}' unavailable, trying next provider: {}", provider->name(),
                                probe.error().message);
    }
#endif

    core::AedstLogger::warn(
        "Secure storage master key provider: file (no usable OS keyring; key stored beside the data)");
    return std::make_unique<FileMasterKeyProvider>(legacyKeyFile);
}

} // namespace aedst::persistence
