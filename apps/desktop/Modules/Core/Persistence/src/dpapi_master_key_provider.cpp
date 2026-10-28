#include "aedst/persistence/master_key_provider.hpp"

#if defined(_WIN32)

#include "key_file.hpp"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include <windows.h>

#include <dpapi.h>
#include <wincrypt.h>

namespace aedst::persistence {
namespace {

// Application-specific entropy: not a secret, but it stops another program
// running as the same user from unwrapping our blob with a bare
// CryptUnprotectData call.
constexpr std::string_view kEntropy = "aedst.desktop.master-key.v1";

// A wrapped 32-byte key is a few hundred bytes; anything far bigger is not ours.
constexpr std::size_t kMaxWrappedSize = 16U * 1024U;

DATA_BLOB entropyBlob() {
    return DATA_BLOB{static_cast<DWORD>(kEntropy.size()),
                     const_cast<BYTE*>(reinterpret_cast<const BYTE*>(kEntropy.data()))};
}

/// DPAPI output buffer: wiped, then released with LocalFree.
class LocalBlob final {
public:
    LocalBlob() = default;
    LocalBlob(const LocalBlob&) = delete;
    LocalBlob& operator=(const LocalBlob&) = delete;
    LocalBlob(LocalBlob&&) = delete;
    LocalBlob& operator=(LocalBlob&&) = delete;

    ~LocalBlob() {
        if (blob.pbData != nullptr) {
            core::secureWipe(blob.pbData, blob.cbData);
            LocalFree(blob.pbData);
        }
    }

    DATA_BLOB blob{};
};

core::Outcome<std::vector<std::uint8_t>> wrap(const SecretBytes& key) {
    const auto plain = key.view();
    DATA_BLOB input{static_cast<DWORD>(plain.size()), const_cast<BYTE*>(plain.data())};
    DATA_BLOB entropy = entropyBlob();
    LocalBlob output;
    if (CryptProtectData(&input, L"aedst-master-key", &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN,
                         &output.blob) == FALSE) {
        return core::fail(core::Error::storage("CryptProtectData failed: " + std::to_string(GetLastError())));
    }
    return std::vector<std::uint8_t>(output.blob.pbData, output.blob.pbData + output.blob.cbData);
}

core::Outcome<SecretBytes> unwrap(const std::vector<std::uint8_t>& wrapped) {
    DATA_BLOB input{static_cast<DWORD>(wrapped.size()), const_cast<BYTE*>(wrapped.data())};
    DATA_BLOB entropy = entropyBlob();
    LocalBlob output;
    if (CryptUnprotectData(&input, nullptr, &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output.blob) ==
        FALSE) {
        return core::fail(core::Error::storage("CryptUnprotectData failed: " + std::to_string(GetLastError())));
    }
    if (output.blob.cbData != kMasterKeySize) {
        return core::fail(core::Error::storage("DPAPI-wrapped master key has unexpected size"));
    }
    return SecretBytes{std::vector<std::uint8_t>(output.blob.pbData, output.blob.pbData + output.blob.cbData)};
}

core::Outcome<std::optional<SecretBytes>> loadExisting(const std::filesystem::path& file) {
    auto wrapped = detail::readFileBytes(file, kMaxWrappedSize);
    if (!wrapped) {
        return core::fail(wrapped.error());
    }
    if (!*wrapped) {
        return std::optional<SecretBytes>{};
    }
    auto key = unwrap(**wrapped);
    if (!key) {
        return core::fail(key.error());
    }
    return std::optional<SecretBytes>{std::move(*key)};
}

} // namespace

DpapiMasterKeyProvider::DpapiMasterKeyProvider(std::filesystem::path wrappedKeyFile)
    : wrappedKeyFile_(std::move(wrappedKeyFile)) {}

std::string_view DpapiMasterKeyProvider::name() const noexcept {
    return "dpapi";
}

core::Outcome<SecretBytes> DpapiMasterKeyProvider::loadOrCreate() {
    auto existing = loadExisting(wrappedKeyFile_);
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
    auto wrapped = wrap(*key);
    if (!wrapped) {
        return core::fail(wrapped.error());
    }
    auto created = detail::createFileExclusive(wrappedKeyFile_, *wrapped);
    if (!created) {
        return core::fail(created.error());
    }
    if (*created) {
        return std::move(*key);
    }

    auto winner = loadExisting(wrappedKeyFile_);
    if (!winner) {
        return core::fail(winner.error());
    }
    if (!*winner) {
        return core::fail(core::Error::storage("DPAPI key file vanished during creation"));
    }
    return std::move(**winner);
}

} // namespace aedst::persistence

#endif // _WIN32
