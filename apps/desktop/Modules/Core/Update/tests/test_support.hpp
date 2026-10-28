#pragma once

// Shared helpers for the update tests: throw-away Ed25519 keys, signing and
// signed-envelope building. Everything is generated at test time.

#include <openssl/evp.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace aedst::update::test_support {

struct PkeyDeleter {
    void operator()(EVP_PKEY* key) const noexcept { EVP_PKEY_free(key); }
};

struct TestKeyPair {
    std::unique_ptr<EVP_PKEY, PkeyDeleter> privateKey;
    std::array<std::uint8_t, 32> publicKey{};
};

inline TestKeyPair generateKeyPair() {
    TestKeyPair pair;
    std::unique_ptr<EVP_PKEY_CTX, decltype(&EVP_PKEY_CTX_free)> ctx{EVP_PKEY_CTX_new_id(EVP_PKEY_ED25519, nullptr),
                                                                    &EVP_PKEY_CTX_free};
    EVP_PKEY* raw = nullptr;
    if (!ctx || EVP_PKEY_keygen_init(ctx.get()) != 1 || EVP_PKEY_keygen(ctx.get(), &raw) != 1) {
        return pair;
    }
    pair.privateKey.reset(raw);
    std::size_t length = pair.publicKey.size();
    EVP_PKEY_get_raw_public_key(raw, pair.publicKey.data(), &length);
    return pair;
}

inline std::vector<std::uint8_t> sign(const TestKeyPair& pair, std::string_view message) {
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> ctx{EVP_MD_CTX_new(), &EVP_MD_CTX_free};
    std::vector<std::uint8_t> signature(64);
    std::size_t length = signature.size();
    if (!ctx || EVP_DigestSignInit(ctx.get(), nullptr, nullptr, nullptr, pair.privateKey.get()) != 1 ||
        EVP_DigestSign(ctx.get(), signature.data(), &length, reinterpret_cast<const unsigned char*>(message.data()),
                       message.size()) != 1) {
        return {};
    }
    signature.resize(length);
    return signature;
}

inline std::string base64(const std::uint8_t* data, std::size_t size) {
    std::string out(4 * ((size + 2) / 3) + 1, '\0');
    const int written = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(out.data()), data, static_cast<int>(size));
    out.resize(static_cast<std::size_t>(written));
    return out;
}

inline std::string base64(std::string_view text) {
    return base64(reinterpret_cast<const std::uint8_t*>(text.data()), text.size());
}

inline std::string base64(const std::vector<std::uint8_t>& bytes) {
    return base64(bytes.data(), bytes.size());
}

inline std::string toHex(const std::uint8_t* data, std::size_t size) {
    static constexpr std::string_view kDigits = "0123456789abcdef";
    std::string out;
    for (std::size_t i = 0; i < size; ++i) {
        out.push_back(kDigits[data[i] >> 4U]);
        out.push_back(kDigits[data[i] & 0x0FU]);
    }
    return out;
}

inline std::string toHex(const std::array<std::uint8_t, 32>& bytes) {
    return toHex(bytes.data(), bytes.size());
}

inline std::string sha256Hex(std::string_view data) {
    std::array<std::uint8_t, EVP_MAX_MD_SIZE> digest{};
    unsigned int length = 0;
    EVP_Digest(data.data(), data.size(), digest.data(), &length, EVP_sha256(), nullptr);
    return toHex(digest.data(), length);
}

/// {"payload": base64(payload), "signatures": [{"keyId","signature"}...]}
inline std::string makeEnvelope(std::string_view payload,
                                const std::vector<std::pair<std::string, std::string>>& keyIdAndSignatureB64) {
    std::string out = "{\"payload\":\"" + base64(payload) + "\",\"signatures\":[";
    for (std::size_t i = 0; i < keyIdAndSignatureB64.size(); ++i) {
        if (i > 0) {
            out += ",";
        }
        out += "{\"keyId\":\"" + keyIdAndSignatureB64[i].first + "\",\"signature\":\"" +
               keyIdAndSignatureB64[i].second + "\"}";
    }
    out += "]}";
    return out;
}

inline std::string signedEnvelope(const TestKeyPair& pair, const std::string& keyId, std::string_view payload) {
    return makeEnvelope(payload, {{keyId, base64(sign(pair, payload))}});
}

/// A valid manifest for tests; `extra` is spliced in before "artifacts" is closed.
inline std::string manifestJson(const std::string& version = "2.0.0", const std::string& channel = "stable",
                                std::int64_t publishedAt = 1'700'000'000, const std::string& minSupported = "1.0.0",
                                const std::string& sha256 = std::string(64, 'a'), std::uint64_t size = 1234) {
    return "{\"version\":\"" + version + "\",\"channel\":\"" + channel +
           "\",\"releaseNotesUrl\":\"https://aedst.com/releases/" + version + "\",\"minSupportedVersion\":\"" +
           minSupported + "\",\"publishedAt\":" + std::to_string(publishedAt) +
           ",\"artifacts\":[{\"platform\":\"windows\",\"arch\":\"x86_64\",\"url\":\"https://downloads.aedst.com/" +
           version + "/aedst-setup.exe\",\"sha256\":\"" + sha256 + "\",\"size\":" + std::to_string(size) +
           ",\"signature\":\"detached\"},{\"platform\":\"linux\",\"arch\":\"x86_64\",\"url\":"
           "\"https://downloads.aedst.com/" +
           version + "/aedst.AppImage\",\"sha256\":\"" + sha256 + "\",\"size\":" + std::to_string(size) + "}]}";
}

} // namespace aedst::update::test_support
