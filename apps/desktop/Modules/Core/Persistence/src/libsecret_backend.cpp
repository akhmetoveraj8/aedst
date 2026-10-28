#include "key_file.hpp"

#if defined(AEDST_HAVE_LIBSECRET) && !defined(_WIN32)

#include <array>
#include <cstddef>
#include <cstdint>
#include <libsecret/secret.h>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace aedst::persistence::detail {
namespace {

constexpr std::string_view kSchemaName = "com.aedst.Desktop";
constexpr const char* kAttributeName = "account";
constexpr const char* kAccount = "master-key";
constexpr const char* kLabel = "AEDST Desktop master key";

constexpr std::array<char, 16> kHexDigits{'0', '1', '2', '3', '4', '5', '6', '7',
                                          '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'};

int hexValue(char digit) noexcept {
    if (digit >= '0' && digit <= '9') {
        return digit - '0';
    }
    if (digit >= 'a' && digit <= 'f') {
        return digit - 'a' + 10;
    }
    if (digit >= 'A' && digit <= 'F') {
        return digit - 'A' + 10;
    }
    return -1;
}

std::string takeErrorMessage(GError* error) {
    std::string message = (error != nullptr && error->message != nullptr) ? error->message : "unknown error";
    if (error != nullptr) {
        g_error_free(error);
    }
    return message;
}

/// Secret Service stores the key as a 64-character hex string (libsecret
/// passwords are NUL-terminated text, not raw bytes).
class LibsecretBackend final : public KeyringBackend {
public:
    LibsecretBackend()
        : schema_(secret_schema_new(kSchemaName.data(), SECRET_SCHEMA_NONE, kAttributeName,
                                    SECRET_SCHEMA_ATTRIBUTE_STRING, nullptr),
                  &secret_schema_unref) {}

    [[nodiscard]] std::string_view name() const noexcept override { return "libsecret"; }

    [[nodiscard]] core::Outcome<std::optional<SecretBytes>> lookup() override {
        GError* error = nullptr;
        gchar* secret = secret_password_lookup_sync(schema_.get(), nullptr, &error, kAttributeName, kAccount, nullptr);
        if (error != nullptr) {
            return core::fail(core::Error::storage("Secret Service lookup failed: " + takeErrorMessage(error)));
        }
        if (secret == nullptr) {
            return std::optional<SecretBytes>{};
        }

        const std::string_view hex(secret);
        std::vector<std::uint8_t> key;
        bool valid = hex.size() == kMasterKeySize * 2U;
        if (valid) {
            key.reserve(kMasterKeySize);
            for (std::size_t i = 0; i < hex.size(); i += 2U) {
                const int high = hexValue(hex[i]);
                const int low = hexValue(hex[i + 1U]);
                if (high < 0 || low < 0) {
                    valid = false;
                    break;
                }
                key.push_back(static_cast<std::uint8_t>((high << 4) | low));
            }
        }
        secret_password_free(secret); // wipes the buffer before freeing
        if (!valid) {
            core::secureWipe(key);
            return core::fail(core::Error::storage("Secret Service master key entry is corrupt"));
        }
        return std::optional<SecretBytes>{SecretBytes{std::move(key)}};
    }

    [[nodiscard]] core::VoidOutcome store(std::span<const std::uint8_t> key) override {
        std::string hex;
        hex.reserve(key.size() * 2U);
        for (const std::uint8_t byte : key) {
            hex.push_back(kHexDigits.at(static_cast<std::size_t>(byte >> 4U)));
            hex.push_back(kHexDigits.at(byte & 0x0FU));
        }
        const core::SecretString secretHex(std::move(hex));

        GError* error = nullptr;
        const gboolean stored =
            secret_password_store_sync(schema_.get(), SECRET_COLLECTION_DEFAULT, kLabel, secretHex.reveal().c_str(),
                                       nullptr, &error, kAttributeName, kAccount, nullptr);
        if (error != nullptr) {
            return core::fail(core::Error::storage("Secret Service store failed: " + takeErrorMessage(error)));
        }
        if (stored == FALSE) {
            return core::fail(core::Error::storage("Secret Service store failed"));
        }
        return core::ok();
    }

private:
    std::unique_ptr<SecretSchema, decltype(&secret_schema_unref)> schema_;
};

} // namespace

std::unique_ptr<KeyringBackend> makeLibsecretBackend() {
    return std::make_unique<LibsecretBackend>();
}

} // namespace aedst::persistence::detail

#else

namespace aedst::persistence::detail {

std::unique_ptr<KeyringBackend> makeLibsecretBackend() {
    return nullptr;
}

} // namespace aedst::persistence::detail

#endif
