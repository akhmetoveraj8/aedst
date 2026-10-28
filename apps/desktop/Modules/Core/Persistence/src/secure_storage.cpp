#include "aedst/persistence/secure_storage.hpp"

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <memory>
#include <mutex>
#include <string>
#include <utility>

namespace aedst::persistence {
namespace {

constexpr std::array<char, 16> kHexDigits{'0', '1', '2', '3', '4', '5', '6', '7',
                                          '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'};

constexpr std::size_t kVersionSize = 1;
constexpr std::size_t kIvSize = 12;
constexpr std::size_t kTagSize = 16;
constexpr std::size_t kHeaderSize = kVersionSize + kIvSize;

// Bound to every ciphertext so blobs produced for another purpose never verify.
constexpr std::string_view kAad = "aedst.secure.v1";

using CipherContext = std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)>;

CipherContext makeContext() {
    return {EVP_CIPHER_CTX_new(), &EVP_CIPHER_CTX_free};
}

const unsigned char* aadData() noexcept {
    return reinterpret_cast<const unsigned char*>(kAad.data());
}

int aadSize() noexcept {
    return static_cast<int>(kAad.size());
}

} // namespace

SecureStorage::SecureStorage(std::shared_ptr<MasterKeyProvider> keyProvider) : keyProvider_(std::move(keyProvider)) {}

core::Outcome<std::string> SecureStorage::sha256Hex(std::string_view input) {
    std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
    unsigned int length = 0;
    if (EVP_Digest(input.data(), input.size(), digest.data(), &length, EVP_sha256(), nullptr) != 1) {
        return core::fail(core::Error::storage("EVP_Digest(sha256) failed"));
    }
    std::string hex;
    hex.reserve(static_cast<std::size_t>(length) * 2U);
    for (unsigned int i = 0; i < length; ++i) {
        const unsigned char byte = digest.at(i);
        hex.push_back(kHexDigits.at(static_cast<std::size_t>(byte >> 4U)));
        hex.push_back(kHexDigits.at(byte & 0x0FU));
    }
    return hex;
}

core::VoidOutcome SecureStorage::ensureKeyLocked() const {
    if (key_) {
        return core::ok();
    }
    if (!keyProvider_) {
        return core::fail(core::Error::storage("no master key provider configured"));
    }
    auto key = keyProvider_->loadOrCreate();
    if (!key) {
        return core::fail(key.error());
    }
    if (key->size() != kMasterKeySize) {
        return core::fail(core::Error::storage("master key provider returned a key of the wrong size"));
    }
    key_ = std::move(*key);
    return core::ok();
}

core::Outcome<std::vector<std::uint8_t>> SecureStorage::protect(std::span<const std::uint8_t> plaintext) const {
    if (plaintext.size() > kMaxPlaintextSize) {
        return core::fail(core::Error::invalidInput("plaintext too large for secure storage"));
    }

    const std::scoped_lock lock(mutex_);
    if (auto ready = ensureKeyLocked(); !ready) {
        return core::fail(ready.error());
    }

    std::vector<std::uint8_t> blob(kHeaderSize + plaintext.size() + kTagSize);
    const std::span<std::uint8_t> out(blob);
    out[0] = kFormatVersion;
    const auto iv = out.subspan(kVersionSize, kIvSize);
    const auto body = out.subspan(kHeaderSize, plaintext.size());
    const auto tag = out.last(kTagSize);
    if (RAND_bytes(iv.data(), static_cast<int>(iv.size())) != 1) {
        return core::fail(core::Error::storage("RAND_bytes failed"));
    }

    const CipherContext ctx = makeContext();
    if (!ctx || EVP_EncryptInit_ex(ctx.get(), EVP_aes_256_gcm(), nullptr, key_->view().data(), iv.data()) != 1) {
        return core::fail(core::Error::storage("AES-256-GCM encryption init failed"));
    }
    int length = 0;
    if (EVP_EncryptUpdate(ctx.get(), nullptr, &length, aadData(), aadSize()) != 1) {
        return core::fail(core::Error::storage("AES-256-GCM AAD update failed"));
    }
    if (!plaintext.empty() &&
        EVP_EncryptUpdate(ctx.get(), body.data(), &length, plaintext.data(), static_cast<int>(plaintext.size())) != 1) {
        return core::fail(core::Error::storage("AES-256-GCM encryption failed"));
    }
    std::array<unsigned char, kTagSize> finalBlock{}; // GCM emits nothing here; OpenSSL still wants a buffer
    int finalLength = 0;
    if (EVP_EncryptFinal_ex(ctx.get(), finalBlock.data(), &finalLength) != 1 ||
        EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_GET_TAG, static_cast<int>(kTagSize), tag.data()) != 1) {
        return core::fail(core::Error::storage("AES-256-GCM encryption failed"));
    }
    return blob;
}

core::Outcome<std::vector<std::uint8_t>> SecureStorage::unprotect(std::span<const std::uint8_t> ciphertext) const {
    if (ciphertext.size() < kHeaderSize + kTagSize) {
        return core::fail(core::Error::storage("ciphertext too short"));
    }
    if (ciphertext[0] != kFormatVersion) {
        return core::fail(core::Error::storage("unsupported secure storage format version"));
    }
    if (ciphertext.size() - kHeaderSize - kTagSize > kMaxPlaintextSize) {
        return core::fail(core::Error::storage("ciphertext too large"));
    }

    const std::scoped_lock lock(mutex_);
    if (auto ready = ensureKeyLocked(); !ready) {
        return core::fail(ready.error());
    }

    const auto iv = ciphertext.subspan(kVersionSize, kIvSize);
    const auto body = ciphertext.subspan(kHeaderSize, ciphertext.size() - kHeaderSize - kTagSize);
    std::array<std::uint8_t, kTagSize> tag{};
    const auto tagSpan = ciphertext.last(kTagSize);
    std::copy(tagSpan.begin(), tagSpan.end(), tag.begin());

    std::vector<std::uint8_t> plaintext(body.size());
    const CipherContext ctx = makeContext();
    int length = 0;
    if (!ctx || EVP_DecryptInit_ex(ctx.get(), EVP_aes_256_gcm(), nullptr, key_->view().data(), iv.data()) != 1 ||
        EVP_DecryptUpdate(ctx.get(), nullptr, &length, aadData(), aadSize()) != 1) {
        return core::fail(core::Error::storage("AES-256-GCM decryption setup failed"));
    }
    if (!body.empty() &&
        EVP_DecryptUpdate(ctx.get(), plaintext.data(), &length, body.data(), static_cast<int>(body.size())) != 1) {
        core::secureWipe(plaintext);
        return core::fail(core::Error::storage("AES-256-GCM decryption failed"));
    }
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_TAG, static_cast<int>(kTagSize), tag.data()) != 1) {
        core::secureWipe(plaintext);
        return core::fail(core::Error::storage("AES-256-GCM decryption setup failed"));
    }
    // Final fails when the tag doesn't verify: tampered data, wrong key or wrong AAD.
    std::array<unsigned char, kTagSize> finalBlock{};
    int finalLength = 0;
    if (EVP_DecryptFinal_ex(ctx.get(), finalBlock.data(), &finalLength) != 1) {
        core::secureWipe(plaintext);
        return core::fail(core::Error::storage("AES-256-GCM authentication failed"));
    }
    return plaintext;
}

} // namespace aedst::persistence
