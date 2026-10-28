#include "aedst/oidc/oidc_config.hpp"

#include <QHostAddress>
#include <QVariant>

namespace aedst::oidc {
namespace {

[[nodiscard]] bool parseFlag(const QString& text, bool fallback) {
    const QString value = text.trimmed().toLower();
    if (value == QLatin1String("1") || value == QLatin1String("true") || value == QLatin1String("yes")) {
        return true;
    }
    if (value == QLatin1String("0") || value == QLatin1String("false") || value == QLatin1String("no")) {
        return false;
    }
    return fallback;
}

/// Environment wins over QSettings; an empty environment value counts as unset.
// aedst-allow: non-secret OIDC client configuration (issuer, client id); tokens use QtKeychain (ADR-0025)
[[nodiscard]] QString lookup(const QSettings& settings, const QProcessEnvironment& environment, const QString& envName,
                             const QString& settingsKey) {
    const QString fromEnvironment = environment.value(envName).trimmed();
    if (!fromEnvironment.isEmpty()) {
        return fromEnvironment;
    }
    return settings.value(settingsKey).toString().trimmed();
}

} // namespace

bool OidcConfig::isConfigured() const {
    return issuer.isValid() && !issuer.isEmpty() && !clientId.trimmed().isEmpty();
}

QString audienceScope(const QString& projectId) {
    return QStringLiteral("urn:zitadel:iam:org:project:id:%1:aud").arg(projectId.trimmed());
}

QSet<QByteArray> OidcConfig::scopeTokens() const {
    QSet<QByteArray> tokens{"openid", "profile", "email", "offline_access"};
    if (!projectId.trimmed().isEmpty()) {
        tokens.insert(audienceScope(projectId).toUtf8());
        if (requestRolesScope) {
            tokens.insert("urn:zitadel:iam:org:projects:roles");
        }
    }
    for (const QString& scope : extraScopes) {
        const QString trimmed = scope.trimmed();
        if (!trimmed.isEmpty()) {
            tokens.insert(trimmed.toUtf8());
        }
    }
    return tokens;
}

bool isLoopbackUrl(const QUrl& url) {
    const QString host = url.host();
    if (host.compare(QLatin1String("localhost"), Qt::CaseInsensitive) == 0) {
        return true;
    }
    QHostAddress address;
    return address.setAddress(host) && address.isLoopback();
}

QString normalizedIssuer(const QUrl& issuer) {
    QString text = issuer.toString(QUrl::FullyEncoded);
    while (text.endsWith(QLatin1Char('/'))) {
        text.chop(1);
    }
    return text;
}

core::VoidOutcome validateOidcConfig(const OidcConfig& config) {
    if (!config.isConfigured()) {
        return core::fail(core::Error::invalidInput("OIDC: issuer and client id are required"));
    }
    const QUrl& issuer = config.issuer;
    if (!issuer.userInfo().isEmpty() || issuer.hasQuery() || issuer.hasFragment() || issuer.host().isEmpty()) {
        return core::fail(
            core::Error::invalidInput("OIDC: issuer must be a plain URL without credentials, query or fragment"));
    }
    const bool https = issuer.scheme() == QLatin1String("https");
    const bool loopbackHttp =
        issuer.scheme() == QLatin1String("http") && config.allowInsecureLoopbackIssuer && isLoopbackUrl(issuer);
    if (!https && !loopbackHttp) {
        return core::fail(core::Error::invalidInput("OIDC: issuer must use https"));
    }
    if (config.signInTimeout.count() <= 0 || config.requestTimeout.count() <= 0 || config.refreshSkew.count() < 0) {
        return core::fail(core::Error::invalidInput("OIDC: timeouts must be positive"));
    }
    return core::ok();
}

// aedst-allow: non-secret OIDC client configuration (issuer, client id); tokens use QtKeychain (ADR-0025)
OidcConfig loadOidcConfig(const QSettings& settings, const QProcessEnvironment& environment) {
    OidcConfig config;
    config.issuer =
        QUrl(lookup(settings, environment, QStringLiteral("AEDST_OIDC_ISSUER"), QStringLiteral("oidc/issuer")));
    config.clientId =
        lookup(settings, environment, QStringLiteral("AEDST_OIDC_CLIENT_ID"), QStringLiteral("oidc/clientId"));
    config.projectId =
        lookup(settings, environment, QStringLiteral("AEDST_OIDC_PROJECT_ID"), QStringLiteral("oidc/projectId"));
    const QString extra =
        lookup(settings, environment, QStringLiteral("AEDST_OIDC_EXTRA_SCOPES"), QStringLiteral("oidc/extraScopes"));
    config.extraScopes = extra.split(QLatin1Char(' '), Qt::SkipEmptyParts);

    bool portOk = false;
    const uint port =
        lookup(settings, environment, QStringLiteral("AEDST_OIDC_LOOPBACK_PORT"), QStringLiteral("oidc/loopbackPort"))
            .toUInt(&portOk);
    if (portOk && port <= 65535U) {
        config.loopbackPort = static_cast<quint16>(port);
    }
    config.requestRolesScope = parseFlag(
        lookup(settings, environment, QStringLiteral("AEDST_OIDC_ROLES_SCOPE"), QStringLiteral("oidc/rolesScope")),
        config.requestRolesScope);
    config.endSessionInBrowser = parseFlag(
        lookup(settings, environment, QStringLiteral("AEDST_OIDC_END_SESSION"), QStringLiteral("oidc/endSession")),
        config.endSessionInBrowser);
    // Loopback http issuers are for local development only and need an explicit switch.
    config.allowInsecureLoopbackIssuer =
        parseFlag(environment.value(QStringLiteral("AEDST_ALLOW_INSECURE_LOCALHOST")), false);
    return config;
}

} // namespace aedst::oidc
