#include "aedst/oidc/id_token_claims.hpp"

#include <QByteArray>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <algorithm>

namespace aedst::oidc {
namespace {

constexpr std::size_t kMaxTokenBytes = 16U * 1024U;

[[nodiscard]] core::Error invalidToken(const char* what) {
    return core::Error::unauthenticated(std::string("OIDC: invalid ID token (") + what + ")");
}

} // namespace

std::string decodeBase64Url(std::string_view segment) {
    const QByteArray decoded =
        QByteArray::fromBase64(QByteArray(segment.data(), static_cast<qsizetype>(segment.size())),
                               QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals);
    return std::string(decoded.constData(), static_cast<std::size_t>(decoded.size()));
}

core::Outcome<OidcUser> validateIdToken(std::string_view jwt, const OidcConfig& config,
                                        std::chrono::system_clock::time_point now, std::chrono::seconds leeway,
                                        std::string_view expectedNonce) {
    if (jwt.empty() || jwt.size() > kMaxTokenBytes) {
        return core::fail(invalidToken("missing or oversized"));
    }
    const std::size_t firstDot = jwt.find('.');
    const std::size_t secondDot = firstDot == std::string_view::npos ? firstDot : jwt.find('.', firstDot + 1);
    if (firstDot == std::string_view::npos || secondDot == std::string_view::npos ||
        jwt.find('.', secondDot + 1) != std::string_view::npos) {
        return core::fail(invalidToken("not a JWS compact serialization"));
    }
    const std::string payload = decodeBase64Url(jwt.substr(firstDot + 1, secondDot - firstDot - 1));
    QJsonParseError parseError;
    const QJsonDocument parsed =
        QJsonDocument::fromJson(QByteArray(payload.data(), static_cast<qsizetype>(payload.size())), &parseError);
    if (parseError.error != QJsonParseError::NoError || !parsed.isObject()) {
        return core::fail(invalidToken("payload is not JSON"));
    }
    const QJsonObject claims = parsed.object();

    if (!claims.value(QStringLiteral("iss")).isString() ||
        normalizedIssuer(QUrl(claims.value(QStringLiteral("iss")).toString())) != normalizedIssuer(config.issuer)) {
        return core::fail(invalidToken("issuer mismatch"));
    }

    const QJsonValue audience = claims.value(QStringLiteral("aud"));
    QStringList audiences;
    if (audience.isString()) {
        audiences.push_back(audience.toString());
    } else if (audience.isArray()) {
        for (const QJsonValue& entry : audience.toArray()) {
            audiences.push_back(entry.toString());
        }
    }
    if (!audiences.contains(config.clientId)) {
        return core::fail(invalidToken("audience does not include this client"));
    }
    if (audiences.size() > 1 && claims.value(QStringLiteral("azp")).toString() != config.clientId) {
        return core::fail(invalidToken("authorized party mismatch"));
    }

    const QJsonValue exp = claims.value(QStringLiteral("exp"));
    if (!exp.isDouble()) {
        return core::fail(invalidToken("exp missing"));
    }
    const auto expiresAt = std::chrono::system_clock::time_point{
        std::chrono::seconds{static_cast<std::chrono::seconds::rep>(exp.toDouble())}};
    if (now > expiresAt + leeway) {
        return core::fail(invalidToken("expired"));
    }
    if (const QJsonValue iat = claims.value(QStringLiteral("iat")); iat.isDouble()) {
        const auto issuedAt = std::chrono::system_clock::time_point{
            std::chrono::seconds{static_cast<std::chrono::seconds::rep>(iat.toDouble())}};
        if (issuedAt > now + leeway) {
            return core::fail(invalidToken("issued in the future"));
        }
    }

    if (!expectedNonce.empty() &&
        claims.value(QStringLiteral("nonce")).toString().toStdString() != std::string(expectedNonce)) {
        return core::fail(invalidToken("nonce mismatch")); // a replayed or substituted ID token
    }

    OidcUser user;
    user.subject = claims.value(QStringLiteral("sub")).toString().toStdString();
    if (user.subject.empty()) {
        return core::fail(invalidToken("sub missing"));
    }
    user.email = claims.value(QStringLiteral("email")).toString().toStdString();
    user.name = claims.value(QStringLiteral("name")).toString().toStdString();
    if (user.name.empty()) {
        user.name = claims.value(QStringLiteral("preferred_username")).toString().toStdString();
    }
    return user;
}

} // namespace aedst::oidc
