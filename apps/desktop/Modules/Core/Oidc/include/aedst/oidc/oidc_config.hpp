#pragma once

#include "aedst/core/outcome.hpp"

#include <QByteArray>
#include <QProcessEnvironment>
#include <QSet>
#include <QSettings>
#include <QString>
#include <QStringList>
#include <QUrl>

#include <chrono>

namespace aedst::oidc {

/// Everything the OIDC client needs to know about the identity provider. Nothing here is
/// hard-coded: issuer and client id come from the environment or QSettings
/// (loadOidcConfig), so one build serves staging and production.
///
/// The IdP is ZITADEL (server ADR-0001); the flow is Authorization Code + PKCE S256 in the
/// system browser with an RFC 8252 loopback redirect.
struct OidcConfig {
    /// Issuer URL exactly as the provider advertises it in discovery (e.g. https://id.example.com).
    QUrl issuer;
    /// Public client id of a ZITADEL "Native" application (PKCE, no secret).
    QString clientId;
    /// ZITADEL project id. When set, the audience scope
    /// `urn:zitadel:iam:org:project:id:<projectId>:aud` is requested so the access token is
    /// accepted by the API (the resource server checks its `aud`).
    QString projectId;
    /// Additional scope tokens appended verbatim.
    QStringList extraScopes;
    /// Request ZITADEL roles scope (`urn:zitadel:iam:org:projects:roles`) so the access token
    /// carries the `urn:zitadel:iam:org:project:roles` claim the Admin UI reads.
    bool requestRolesScope{true};
    /// Loopback port for the redirect. 0 = ask the OS (RFC 8252 section 7.3 asks servers to accept
    /// any port); a fixed port is the fallback if the IdP only matches registered URIs exactly.
    quint16 loopbackPort{0};
    /// After revoking tokens, also open the end_session endpoint of the IdP in the system browser
    /// so the SSO session of the browser ends too.
    bool endSessionInBrowser{true};
    /// Allow `http://127.0.0.1|localhost|[::1]` issuers (tests, local development). Never default-on.
    bool allowInsecureLoopbackIssuer{false};
    /// How long the user may take to finish the browser step.
    std::chrono::seconds signInTimeout{300};
    /// Refresh the access token this long before it expires.
    std::chrono::seconds refreshSkew{60};
    /// Per HTTP request (discovery, token, revocation).
    std::chrono::seconds requestTimeout{15};

    /// True when issuer and client id are present (the app then uses OIDC instead of password login).
    [[nodiscard]] bool isConfigured() const;

    /// openid profile email offline_access + audience/roles scopes + extraScopes.
    [[nodiscard]] QSet<QByteArray> scopeTokens() const;
};

/// Scope that makes ZITADEL put the project in the `aud` of the token.
[[nodiscard]] QString audienceScope(const QString& projectId);

/// Issuer sanity: https (or loopback http when allowed), no query/fragment/credentials, clientId set.
[[nodiscard]] core::VoidOutcome validateOidcConfig(const OidcConfig& config);

/// `AEDST_OIDC_ISSUER`, `AEDST_OIDC_CLIENT_ID`, `AEDST_OIDC_PROJECT_ID`, `AEDST_OIDC_LOOPBACK_PORT`,
/// `AEDST_OIDC_EXTRA_SCOPES` (space separated), `AEDST_OIDC_ROLES_SCOPE` (0/1),
/// `AEDST_OIDC_END_SESSION` (0/1): environment first, then QSettings keys `oidc/issuer`,
/// `oidc/clientId`, `oidc/projectId`, `oidc/loopbackPort`, `oidc/extraScopes`, `oidc/rolesScope`,
/// `oidc/endSession`. `AEDST_ALLOW_INSECURE_LOCALHOST=1` also permits a loopback http issuer.
// aedst-allow: non-secret OIDC client configuration (issuer, client id); tokens use QtKeychain (ADR-0025)
[[nodiscard]] OidcConfig loadOidcConfig(const QSettings& settings, const QProcessEnvironment& environment);

/// Issuer with trailing slashes removed, for comparisons ("https://a/" == "https://a").
[[nodiscard]] QString normalizedIssuer(const QUrl& issuer);

/// URL whose host is a loopback name or address.
[[nodiscard]] bool isLoopbackUrl(const QUrl& url);

} // namespace aedst::oidc
