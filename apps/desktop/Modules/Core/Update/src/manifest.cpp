#include "aedst/update/manifest.hpp"

#include "aedst/update/semver.hpp"
#include "aedst/update/url_validation.hpp"

#include <QByteArray>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QJsonValue>
#include <QString>

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>

namespace aedst::update {
namespace {

using core::Error;
using core::fail;

constexpr std::size_t kMaxFieldLength = 2048;
constexpr double kMaxSafeInteger = 9007199254740992.0; // 2^53: exactly representable

bool hasControlChars(const std::string& text) {
    for (const char c : text) {
        const auto u = static_cast<unsigned char>(c);
        if (u < 0x20U || u == 0x7FU) {
            return true;
        }
    }
    return false;
}

core::Outcome<std::string> readString(const QJsonObject& object, const char* key, std::size_t maxLength) {
    const QJsonValue value = object.value(QString::fromLatin1(key));
    if (!value.isString()) {
        return fail(Error::invalidInput(std::string{"manifest: missing or non-string field '"} + key + "'"));
    }
    std::string text = value.toString().toStdString();
    if (text.empty() || text.size() > maxLength || hasControlChars(text)) {
        return fail(Error::invalidInput(std::string{"manifest: invalid field '"} + key + "'"));
    }
    return text;
}

core::Outcome<std::int64_t> readInteger(const QJsonObject& object, const char* key, std::int64_t minimum,
                                        std::int64_t maximum) {
    const QJsonValue value = object.value(QString::fromLatin1(key));
    if (!value.isDouble()) {
        return fail(Error::invalidInput(std::string{"manifest: missing or non-numeric field '"} + key + "'"));
    }
    const double number = value.toDouble();
    if (!std::isfinite(number) || std::trunc(number) != number || std::fabs(number) > kMaxSafeInteger) {
        return fail(Error::invalidInput(std::string{"manifest: field '"} + key + "' is not an integer"));
    }
    const auto integer = static_cast<std::int64_t>(number);
    if (integer < minimum || integer > maximum) {
        return fail(Error::invalidInput(std::string{"manifest: field '"} + key + "' is out of range"));
    }
    return integer;
}

bool isToken(const std::string& text, std::size_t maxLength, bool allowDash) {
    if (text.empty() || text.size() > maxLength) {
        return false;
    }
    for (const char c : text) {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || (allowDash && c == '-');
        if (!ok) {
            return false;
        }
    }
    return true;
}

bool isLowerHex64(const std::string& text) {
    if (text.size() != 64) {
        return false;
    }
    for (const char c : text) {
        const bool digit = c >= '0' && c <= '9';
        const bool lower = c >= 'a' && c <= 'f';
        if (!digit && !lower) {
            return false;
        }
    }
    return true;
}

core::Outcome<ArtifactInfo> parseArtifact(const QJsonValue& value) {
    if (!value.isObject()) {
        return fail(Error::invalidInput("manifest: artifact is not an object"));
    }
    const QJsonObject object = value.toObject();
    ArtifactInfo artifact;

    auto platform = readString(object, "platform", 16);
    if (!platform || !isToken(*platform, 16, false)) {
        return fail(Error::invalidInput("manifest: invalid artifact platform"));
    }
    auto arch = readString(object, "arch", 16);
    if (!arch || !isToken(*arch, 16, false)) {
        return fail(Error::invalidInput("manifest: invalid artifact arch"));
    }
    auto url = readString(object, "url", kMaxFieldLength);
    if (!url || !isSecureHttpsUrl(*url)) {
        return fail(Error::invalidInput("manifest: artifact url must be a valid https URL"));
    }
    auto sha256 = readString(object, "sha256", 64);
    if (!sha256 || !isLowerHex64(*sha256)) {
        return fail(Error::invalidInput("manifest: artifact sha256 must be 64 lowercase hex characters"));
    }
    auto size = readInteger(object, "size", 1, static_cast<std::int64_t>(kMaxArtifactBytes));
    if (!size) {
        return fail(size.error());
    }
    if (object.contains(QStringLiteral("signature"))) {
        auto signature = readString(object, "signature", kMaxFieldLength);
        if (!signature) {
            return fail(signature.error());
        }
        artifact.signature = std::move(*signature);
    }
    artifact.platform = std::move(*platform);
    artifact.arch = std::move(*arch);
    artifact.url = std::move(*url);
    artifact.sha256 = std::move(*sha256);
    artifact.size = static_cast<std::uint64_t>(*size);
    return artifact;
}

} // namespace

core::Outcome<UpdateManifest> parseManifest(std::string_view json) {
    QJsonParseError parseError;
    const QJsonDocument document =
        QJsonDocument::fromJson(QByteArray::fromRawData(json.data(), static_cast<qsizetype>(json.size())), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return fail(Error::invalidInput("manifest: not a JSON object"));
    }
    const QJsonObject root = document.object();
    UpdateManifest manifest;

    auto version = readString(root, "version", 64);
    if (!version) {
        return fail(version.error());
    }
    if (!parseSemVer(*version)) {
        return fail(Error::invalidInput("manifest: version is not valid semver"));
    }
    auto channel = readString(root, "channel", 32);
    if (!channel || !isToken(*channel, 32, true)) {
        return fail(Error::invalidInput("manifest: invalid channel"));
    }
    auto notes = readString(root, "releaseNotesUrl", kMaxFieldLength);
    if (!notes || !isSecureHttpsUrl(*notes)) {
        return fail(Error::invalidInput("manifest: releaseNotesUrl must be a valid https URL"));
    }
    auto publishedAt = readInteger(root, "publishedAt", 1, static_cast<std::int64_t>(kMaxSafeInteger));
    if (!publishedAt) {
        return fail(publishedAt.error());
    }
    if (root.contains(QStringLiteral("minSupportedVersion"))) {
        auto minimum = readString(root, "minSupportedVersion", 64);
        if (!minimum || !parseSemVer(*minimum)) {
            return fail(Error::invalidInput("manifest: minSupportedVersion is not valid semver"));
        }
        manifest.minSupportedVersion = std::move(*minimum);
    }

    if (root.contains(QStringLiteral("rollback"))) {
        const QJsonValue rollback = root.value(QStringLiteral("rollback"));
        if (!rollback.isBool()) {
            return fail(Error::invalidInput("manifest: rollback must be a boolean"));
        }
        manifest.rollback = rollback.toBool();
    }

    const QJsonValue artifactsValue = root.value(QStringLiteral("artifacts"));
    if (!artifactsValue.isArray()) {
        return fail(Error::invalidInput("manifest: artifacts must be an array"));
    }
    const QJsonArray artifacts = artifactsValue.toArray();
    if (artifacts.isEmpty() || static_cast<std::size_t>(artifacts.size()) > kMaxManifestArtifacts) {
        return fail(Error::invalidInput("manifest: artifacts must have 1..32 entries"));
    }
    for (const QJsonValue& entry : artifacts) {
        auto artifact = parseArtifact(entry);
        if (!artifact) {
            return fail(artifact.error());
        }
        if (findArtifact(manifest, artifact->platform, artifact->arch) != nullptr) {
            return fail(Error::invalidInput("manifest: duplicate platform/arch artifact"));
        }
        manifest.artifacts.push_back(std::move(*artifact));
    }

    manifest.version = std::move(*version);
    manifest.channel = std::move(*channel);
    manifest.releaseNotesUrl = std::move(*notes);
    manifest.publishedAt = *publishedAt;
    return manifest;
}

const ArtifactInfo* findArtifact(const UpdateManifest& manifest, std::string_view platform, std::string_view arch) {
    for (const ArtifactInfo& artifact : manifest.artifacts) {
        if (artifact.platform == platform && artifact.arch == arch) {
            return &artifact;
        }
    }
    return nullptr;
}

} // namespace aedst::update
