#include "aedst/oidc/oidc_discovery.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>

#include <memory>
#include <string>
#include <utility>

namespace aedst::oidc {
namespace {

constexpr qint64 kMaxDocumentBytes = 1024 * 1024;

[[nodiscard]] bool endpointAllowed(const QUrl& url, const OidcConfig& config) {
    if (!url.isValid() || url.host().isEmpty() || !url.userInfo().isEmpty() || url.hasFragment()) {
        return false;
    }
    if (url.scheme() == QLatin1String("https")) {
        return true;
    }
    return url.scheme() == QLatin1String("http") && config.allowInsecureLoopbackIssuer && isLoopbackUrl(url);
}

/// Reads an endpoint member. `required` endpoints fail when absent; optional ones are empty.
[[nodiscard]] core::Outcome<QUrl> endpoint(const QJsonObject& document, const QString& name, bool required,
                                           const OidcConfig& config) {
    const QJsonValue value = document.value(name);
    if (value.isUndefined() || value.isNull()) {
        if (required) {
            return core::fail(core::Error::invalidInput("OIDC discovery: missing " + name.toStdString()));
        }
        return QUrl{};
    }
    if (!value.isString()) {
        return core::fail(core::Error::invalidInput("OIDC discovery: " + name.toStdString() + " is not a string"));
    }
    const QUrl url(value.toString());
    if (!endpointAllowed(url, config)) {
        return core::fail(core::Error::invalidInput("OIDC discovery: " + name.toStdString() + " must be an https URL"));
    }
    return url;
}

} // namespace

QUrl discoveryUrl(const QUrl& issuer) {
    QUrl url(issuer);
    QString path = url.path();
    while (path.endsWith(QLatin1Char('/'))) {
        path.chop(1);
    }
    url.setPath(path + QStringLiteral("/.well-known/openid-configuration"));
    return url;
}

core::Outcome<OidcEndpoints> parseDiscoveryDocument(const QByteArray& json, const OidcConfig& config) {
    QJsonParseError parseError;
    const QJsonDocument parsed = QJsonDocument::fromJson(json, &parseError);
    if (parseError.error != QJsonParseError::NoError || !parsed.isObject()) {
        return core::fail(core::Error::invalidInput("OIDC discovery: response is not a JSON object"));
    }
    const QJsonObject document = parsed.object();

    const QJsonValue issuer = document.value(QStringLiteral("issuer"));
    if (!issuer.isString() || normalizedIssuer(QUrl(issuer.toString())) != normalizedIssuer(config.issuer)) {
        return core::fail(core::Error::invalidInput("OIDC discovery: issuer does not match the configured issuer"));
    }

    const QJsonValue methods = document.value(QStringLiteral("code_challenge_methods_supported"));
    if (methods.isArray()) {
        bool s256 = false;
        for (const QJsonValue& method : methods.toArray()) {
            s256 = s256 || method.toString() == QLatin1String("S256");
        }
        if (!s256) {
            return core::fail(core::Error::invalidInput("OIDC discovery: provider does not support PKCE S256"));
        }
    }

    OidcEndpoints endpoints;
    auto authorization = endpoint(document, QStringLiteral("authorization_endpoint"), true, config);
    if (!authorization) {
        return core::fail(authorization.error());
    }
    auto token = endpoint(document, QStringLiteral("token_endpoint"), true, config);
    if (!token) {
        return core::fail(token.error());
    }
    auto revocation = endpoint(document, QStringLiteral("revocation_endpoint"), false, config);
    if (!revocation) {
        return core::fail(revocation.error());
    }
    auto endSession = endpoint(document, QStringLiteral("end_session_endpoint"), false, config);
    if (!endSession) {
        return core::fail(endSession.error());
    }
    endpoints.authorization = std::move(*authorization);
    endpoints.token = std::move(*token);
    endpoints.revocation = std::move(*revocation);
    endpoints.endSession = std::move(*endSession);
    return endpoints;
}

void fetchDiscovery(QNetworkAccessManager& network, const OidcConfig& config, core::Completion<OidcEndpoints> done) {
    if (auto valid = validateOidcConfig(config); !valid) {
        done(core::fail(valid.error()));
        return;
    }
    QNetworkRequest request(discoveryUrl(config.issuer));
    request.setRawHeader("Accept", "application/json");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(static_cast<int>(std::chrono::milliseconds(config.requestTimeout).count()));

    QNetworkReply* reply = network.get(request);
    QObject::connect(reply, &QNetworkReply::finished, reply, [reply, config, done = std::move(done)]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            done(core::fail(core::Error::unavailable("OIDC discovery failed: " + reply->errorString().toStdString())));
            return;
        }
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (status != 200) {
            done(core::fail(core::Error::unavailable("OIDC discovery failed: HTTP " + std::to_string(status))));
            return;
        }
        const QByteArray body = reply->read(kMaxDocumentBytes + 1);
        if (body.size() > kMaxDocumentBytes) {
            done(core::fail(core::Error::invalidInput("OIDC discovery: response too large")));
            return;
        }
        done(parseDiscoveryDocument(body, config));
    });
}

} // namespace aedst::oidc
