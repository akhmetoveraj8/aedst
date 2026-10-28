#include "aedst/network/access_token_claims.hpp"

#include <QByteArray>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QString>
#include <QStringList>

#include <algorithm>

namespace aedst::network {
namespace {

[[nodiscard]] QJsonValue lookupClaim(const QJsonObject& payload, const QString& claim) {
    // A literal claim name wins (e.g. "https://example.com/roles"), then a dotted path.
    if (payload.contains(claim)) {
        return payload.value(claim);
    }
    QJsonValue current(payload);
    const QStringList parts = claim.split(QLatin1Char('.'), Qt::SkipEmptyParts);
    for (const QString& part : parts) {
        if (!current.isObject()) {
            return {};
        }
        current = current.toObject().value(part);
    }
    return parts.isEmpty() ? QJsonValue() : current;
}

[[nodiscard]] std::vector<std::string> rolesFrom(const QJsonValue& value) {
    std::vector<std::string> roles;
    if (value.isArray()) {
        for (const QJsonValue& item : value.toArray()) {
            if (item.isString() && !item.toString().isEmpty()) {
                roles.push_back(item.toString().toStdString());
            }
        }
    } else if (value.isString()) {
        for (const QString& role : value.toString().split(QLatin1Char(' '), Qt::SkipEmptyParts)) {
            roles.push_back(role.toStdString());
        }
    } else if (value.isObject()) {
        const QJsonObject object = value.toObject();
        for (auto it = object.begin(); it != object.end(); ++it) {
            roles.push_back(it.key().toStdString());
        }
    }
    return roles;
}

} // namespace

bool AccessTokenClaims::hasRole(std::string_view role) const {
    return std::ranges::any_of(roles, [role](const std::string& candidate) { return candidate == role; });
}

std::optional<AccessTokenClaims> parseAccessTokenClaims(std::string_view token, std::string_view rolesClaim) {
    const QByteArray compact = QByteArray::fromRawData(token.data(), static_cast<qsizetype>(token.size()));
    const QList<QByteArray> segments = compact.split('.');
    if (segments.size() != 3 || segments.at(1).isEmpty()) {
        return std::nullopt;
    }
    const auto decoded =
        QByteArray::fromBase64Encoding(segments.at(1), QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals |
                                                           QByteArray::AbortOnBase64DecodingErrors);
    if (!decoded) {
        return std::nullopt;
    }
    QJsonParseError parseError{};
    const QJsonDocument document = QJsonDocument::fromJson(*decoded, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return std::nullopt;
    }
    const QJsonObject payload = document.object();
    AccessTokenClaims claims;
    claims.subject = payload.value(QStringLiteral("sub")).toString().toStdString();
    claims.roles = rolesFrom(
        lookupClaim(payload, QString::fromUtf8(rolesClaim.data(), static_cast<qsizetype>(rolesClaim.size()))));
    return claims;
}

} // namespace aedst::network
