#include "aedst/update/manifest_verifier.hpp"

#include "aedst/core/logger.hpp"
#include "hex.hpp"

#include <QByteArray>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QJsonValue>
#include <QString>

#include <openssl/evp.h>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#ifndef AEDST_UPDATE_PUBLIC_KEYS
#define AEDST_UPDATE_PUBLIC_KEYS ""
#endif

namespace aedst::update {
namespace {

using core::Error;
using core::fail;

constexpr std::size_t kMaxKeyIdLength = 32;
constexpr std::size_t kMaxSignaturesPerEnvelope = 8;

struct PkeyDeleter {
    void operator()(EVP_PKEY* key) const noexcept { EVP_PKEY_free(key); }
};

struct MdCtxDeleter {
    void operator()(EVP_MD_CTX* ctx) const noexcept { EVP_MD_CTX_free(ctx); }
};

bool isKeyIdChar(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' ||
           c == '-';
}

bool isValidKeyId(std::string_view id) {
    return !id.empty() && id.size() <= kMaxKeyIdLength && std::all_of(id.begin(), id.end(), isKeyIdChar);
}

/// Strict base64 (standard alphabet, padded); nullopt on any error.
std::optional<std::vector<std::uint8_t>> decodeBase64(const QString& text, std::size_t maxDecodedBytes) {
    const QByteArray ascii = text.toLatin1();
    if (static_cast<std::size_t>(ascii.size()) > (maxDecodedBytes / 3 + 1) * 4) {
        return std::nullopt;
    }
    const auto result =
        QByteArray::fromBase64Encoding(ascii, QByteArray::Base64Encoding | QByteArray::AbortOnBase64DecodingErrors);
    if (!result || static_cast<std::size_t>(result.decoded.size()) > maxDecodedBytes) {
        return std::nullopt;
    }
    const auto* begin = reinterpret_cast<const std::uint8_t*>(result.decoded.constData());
    return std::vector<std::uint8_t>(begin, begin + result.decoded.size());
}

} // namespace

core::Outcome<std::vector<TrustedKey>> parseTrustedKeys(std::string_view spec) {
    std::vector<TrustedKey> keys;
    if (spec.empty()) {
        return keys;
    }
    std::size_t start = 0;
    while (start <= spec.size()) {
        std::size_t comma = spec.find(',', start);
        if (comma == std::string_view::npos) {
            comma = spec.size();
        }
        const std::string_view entry = spec.substr(start, comma - start);
        const std::size_t colon = entry.find(':');
        if (colon == std::string_view::npos) {
            return fail(Error::invalidInput("trusted keys: expected keyId:hex"));
        }
        const std::string_view keyId = entry.substr(0, colon);
        const auto raw = detail::decodeHex(entry.substr(colon + 1));
        if (!isValidKeyId(keyId) || !raw || raw->size() != kEd25519PublicKeyBytes) {
            return fail(Error::invalidInput("trusted keys: invalid keyId or public key"));
        }
        for (const TrustedKey& existing : keys) {
            if (existing.keyId == keyId) {
                return fail(Error::invalidInput("trusted keys: duplicate keyId"));
            }
        }
        TrustedKey key;
        key.keyId = std::string{keyId};
        std::copy(raw->begin(), raw->end(), key.publicKey.begin());
        keys.push_back(std::move(key));
        if (comma == spec.size()) {
            break;
        }
        start = comma + 1;
    }
    return keys;
}

std::vector<TrustedKey> embeddedTrustedKeys() {
    auto keys = parseTrustedKeys(AEDST_UPDATE_PUBLIC_KEYS);
    if (!keys) {
        // aedst-allow: Update is a Qt-free layer that uses QtJson only to parse (AedstLogger consumer, ADR-0024)
        core::AedstLogger::error("update: AEDST_UPDATE_PUBLIC_KEYS is malformed; no update key is trusted");
        return {};
    }
    return std::move(*keys);
}

bool verifyEd25519(std::span<const std::uint8_t> publicKey, std::span<const std::uint8_t> message,
                   std::span<const std::uint8_t> signature) {
    if (publicKey.size() != kEd25519PublicKeyBytes || signature.size() != kEd25519SignatureBytes || message.empty()) {
        return false;
    }
    const std::unique_ptr<EVP_PKEY, PkeyDeleter> key{
        EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nullptr, publicKey.data(), publicKey.size())};
    if (!key) {
        return false;
    }
    const std::unique_ptr<EVP_MD_CTX, MdCtxDeleter> ctx{EVP_MD_CTX_new()};
    if (!ctx) {
        return false;
    }
    // Ed25519 is a "pure" scheme: no digest is passed to DigestVerifyInit.
    if (EVP_DigestVerifyInit(ctx.get(), nullptr, nullptr, nullptr, key.get()) != 1) {
        return false;
    }
    return EVP_DigestVerify(ctx.get(), signature.data(), signature.size(), message.data(), message.size()) == 1;
}

ManifestVerifier::ManifestVerifier(std::vector<TrustedKey> trustedKeys) : trustedKeys_(std::move(trustedKeys)) {}

core::Outcome<UpdateManifest> ManifestVerifier::verify(std::string_view envelopeJson) const {
    if (trustedKeys_.empty()) {
        return fail(Error::unauthenticated("update: no trusted signing keys are configured"));
    }
    if (envelopeJson.empty() || envelopeJson.size() > kMaxEnvelopeBytes) {
        return fail(Error::invalidInput("update: envelope has an invalid size"));
    }
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(
        QByteArray::fromRawData(envelopeJson.data(), static_cast<qsizetype>(envelopeJson.size())), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return fail(Error::invalidInput("update: envelope is not a JSON object"));
    }
    const QJsonObject root = document.object();
    const QJsonValue payloadValue = root.value(QStringLiteral("payload"));
    const QJsonValue signaturesValue = root.value(QStringLiteral("signatures"));
    if (!payloadValue.isString() || !signaturesValue.isArray()) {
        return fail(Error::invalidInput("update: envelope needs payload and signatures"));
    }
    const auto payload = decodeBase64(payloadValue.toString(), kMaxEnvelopeBytes);
    if (!payload || payload->empty()) {
        return fail(Error::invalidInput("update: payload is not valid base64"));
    }
    const QJsonArray signatures = signaturesValue.toArray();
    if (signatures.isEmpty() || static_cast<std::size_t>(signatures.size()) > kMaxSignaturesPerEnvelope) {
        return fail(Error::invalidInput("update: envelope needs 1..8 signatures"));
    }

    bool verified = false;
    for (const QJsonValue& entry : signatures) {
        if (!entry.isObject()) {
            continue;
        }
        const QJsonObject object = entry.toObject();
        const QJsonValue keyIdValue = object.value(QStringLiteral("keyId"));
        const QJsonValue signatureValue = object.value(QStringLiteral("signature"));
        if (!keyIdValue.isString() || !signatureValue.isString()) {
            continue;
        }
        const std::string keyId = keyIdValue.toString().toStdString();
        const auto signature = decodeBase64(signatureValue.toString(), kEd25519SignatureBytes);
        if (!signature || signature->size() != kEd25519SignatureBytes) {
            continue;
        }
        for (const TrustedKey& trusted : trustedKeys_) {
            if (trusted.keyId == keyId && verifyEd25519(trusted.publicKey, *payload, *signature)) {
                verified = true;
                break;
            }
        }
        if (verified) {
            break;
        }
    }
    if (!verified) {
        return fail(Error::unauthenticated("update: manifest signature verification failed"));
    }
    const std::string_view manifestBytes{reinterpret_cast<const char*>(payload->data()), payload->size()};
    return parseManifest(manifestBytes);
}

} // namespace aedst::update
