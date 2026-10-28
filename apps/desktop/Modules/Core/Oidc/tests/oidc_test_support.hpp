#pragma once

#include "aedst/oidc/oidc_config.hpp"
#include "aedst/testing/fake_http_server.hpp"

#include <QByteArray>
#include <QCryptographicHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QString>
#include <QUrl>
#include <QUrlQuery>

#include <chrono>
#include <string>
#include <vector>

namespace aedst::oidc::testing {

/// Unsigned JWS-shaped token: header.payload.signature, base64url without padding. The client only
/// reads the payload of ID tokens it received over TLS, so the signature part is a placeholder.
[[nodiscard]] inline std::string makeJwt(const QJsonObject& claims) {
    const auto encode = [](const QByteArray& bytes) {
        return bytes.toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals);
    };
    const QByteArray header = encode(R"({"alg":"RS256","typ":"JWT"})");
    const QByteArray payload = encode(QJsonDocument(claims).toJson(QJsonDocument::Compact));
    const QByteArray token = header + "." + payload + ".sig";
    return std::string(token.constData(), static_cast<std::size_t>(token.size()));
}

[[nodiscard]] inline qint64 nowSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch())
        .count();
}

[[nodiscard]] inline QJsonObject validIdTokenClaims(const OidcConfig& config, const QString& subject = "user-1") {
    QJsonObject claims;
    claims.insert("iss", config.issuer.toString());
    claims.insert("aud", config.clientId);
    claims.insert("sub", subject);
    claims.insert("email", "ada@example.com");
    claims.insert("name", "Ada Lovelace");
    claims.insert("iat", static_cast<double>(nowSeconds()));
    claims.insert("exp", static_cast<double>(nowSeconds() + 3600));
    return claims;
}

/// A scripted OpenID provider on a loopback port: discovery, authorization (redirects the "browser"
/// back with a code), token (authorization_code with real PKCE S256 verification, and refresh_token with
/// rotation) and revocation. Knobs let a test make the provider misbehave.
class MockOidcProvider {
public:
    MockOidcProvider() {
        server_.setHandler([this](const aedst::testing::RecordedRequest& request) { return handle(request); });
    }

    [[nodiscard]] bool isListening() const { return server_.isListening(); }

    [[nodiscard]] QUrl baseUrl() const { return server_.baseUrl(); }

    [[nodiscard]] OidcConfig config() const {
        OidcConfig config;
        config.issuer = baseUrl();
        config.clientId = QStringLiteral("client-1");
        config.projectId = QStringLiteral("proj-9");
        config.allowInsecureLoopbackIssuer = true;
        config.signInTimeout = std::chrono::seconds{20};
        config.requestTimeout = std::chrono::seconds{5};
        return config;
    }

    // --- Knobs -----------------------------------------------------------------------------
    int expiresIn{3600};
    QString refreshError;         // when set, refresh_token grants fail with this OAuth error
    bool dropRefresh{false};      // refresh_token grants close the connection
    bool omitRefreshToken{false}; // authorization_code grant returns no refresh token
    QString idTokenIssuer;        // overrides the iss claim of issued ID tokens
    QString expectedRefreshToken{"refresh-1"};
    bool advertisePkce{true};
    bool echoNonce{true};  // false: issued ID tokens carry no nonce claim
    QString nonceOverride; // when set, issued ID tokens carry this nonce instead of the request's

    // --- Observations ----------------------------------------------------------------------
    int authorizeRequests{0};
    int tokenRequests{0};
    int refreshRequests{0};
    std::vector<QByteArray> revocationBodies;
    QString lastScope;
    QString lastChallengeMethod;
    QString lastNonce; // the nonce of the last authorization request
    bool pkceVerified{false};

private:
    [[nodiscard]] aedst::testing::FakeResponse handle(const aedst::testing::RecordedRequest& request) {
        const QUrl target = QUrl::fromEncoded(request.target);
        const QString path = target.path();
        if (path == QLatin1String("/.well-known/openid-configuration")) {
            return discovery();
        }
        if (path == QLatin1String("/oauth/v2/authorize")) {
            return authorize(target);
        }
        if (path == QLatin1String("/oauth/v2/token")) {
            return token(request.body);
        }
        if (path == QLatin1String("/oauth/v2/revoke")) {
            revocationBodies.push_back(request.body);
            return aedst::testing::FakeResponse::json("{}");
        }
        return aedst::testing::FakeResponse::json(R"({"error":"not_found"})", 404);
    }

    [[nodiscard]] aedst::testing::FakeResponse discovery() const {
        const QString base = baseUrl().toString();
        QJsonObject document;
        document.insert("issuer", base);
        document.insert("authorization_endpoint", base + "/oauth/v2/authorize");
        document.insert("token_endpoint", base + "/oauth/v2/token");
        document.insert("revocation_endpoint", base + "/oauth/v2/revoke");
        document.insert("end_session_endpoint", base + "/oidc/v1/end_session");
        if (advertisePkce) {
            document.insert("code_challenge_methods_supported", QJsonArray{"S256"});
        }
        return aedst::testing::FakeResponse::json(QJsonDocument(document).toJson(QJsonDocument::Compact));
    }

    [[nodiscard]] aedst::testing::FakeResponse authorize(const QUrl& target) {
        ++authorizeRequests;
        const QUrlQuery query(target);
        lastScope = query.queryItemValue("scope", QUrl::FullyDecoded);
        lastChallengeMethod = query.queryItemValue("code_challenge_method");
        lastNonce = query.queryItemValue("nonce", QUrl::FullyDecoded);
        challenge_ = query.queryItemValue("code_challenge").toUtf8();
        redirectUri_ = query.queryItemValue("redirect_uri", QUrl::FullyDecoded);
        QUrl back(redirectUri_);
        QUrlQuery backQuery;
        backQuery.addQueryItem("code", "auth-code-1");
        backQuery.addQueryItem("state", query.queryItemValue("state", QUrl::FullyDecoded));
        back.setQuery(backQuery);
        return aedst::testing::FakeResponse::redirect(back.toEncoded());
    }

    [[nodiscard]] aedst::testing::FakeResponse token(const QByteArray& body) {
        ++tokenRequests;
        const QUrlQuery form{QString::fromUtf8(body)};
        const QString grant = form.queryItemValue("grant_type", QUrl::FullyDecoded);
        if (grant == QLatin1String("authorization_code")) {
            const QByteArray verifier = form.queryItemValue("code_verifier", QUrl::FullyDecoded).toUtf8();
            const QByteArray expected = QCryptographicHash::hash(verifier, QCryptographicHash::Sha256)
                                            .toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals);
            pkceVerified = !verifier.isEmpty() && expected == challenge_ &&
                           form.queryItemValue("code", QUrl::FullyDecoded) == QLatin1String("auth-code-1");
            if (!pkceVerified) {
                return aedst::testing::FakeResponse::json(R"({"error":"invalid_grant"})", 400);
            }
            return issue(/*withRefresh=*/!omitRefreshToken);
        }
        if (grant == QLatin1String("refresh_token")) {
            ++refreshRequests;
            if (dropRefresh) {
                return aedst::testing::FakeResponse::dropped();
            }
            if (!refreshError.isEmpty()) {
                return aedst::testing::FakeResponse::json("{\"error\":\"" + refreshError.toUtf8() + "\"}", 400);
            }
            if (form.queryItemValue("refresh_token", QUrl::FullyDecoded) != expectedRefreshToken) {
                return aedst::testing::FakeResponse::json(R"({"error":"invalid_grant"})", 400);
            }
            return issue(true);
        }
        return aedst::testing::FakeResponse::json(R"({"error":"unsupported_grant_type"})", 400);
    }

    [[nodiscard]] aedst::testing::FakeResponse issue(bool withRefresh) {
        ++issued_;
        OidcConfig cfg = config();
        QJsonObject claims = validIdTokenClaims(cfg);
        if (!idTokenIssuer.isEmpty()) {
            claims.insert("iss", idTokenIssuer);
        }
        if (echoNonce && !lastNonce.isEmpty()) {
            claims.insert("nonce", nonceOverride.isEmpty() ? lastNonce : nonceOverride);
        }
        QJsonObject response;
        response.insert("access_token", QStringLiteral("access-%1").arg(issued_));
        response.insert("token_type", "Bearer");
        response.insert("expires_in", expiresIn);
        response.insert("id_token", QString::fromStdString(makeJwt(claims)));
        if (withRefresh) {
            expectedRefreshToken = QStringLiteral("refresh-%1").arg(issued_);
            response.insert("refresh_token", expectedRefreshToken);
        }
        return aedst::testing::FakeResponse::json(QJsonDocument(response).toJson(QJsonDocument::Compact));
    }

    aedst::testing::FakeHttpServer server_;
    QByteArray challenge_;
    QString redirectUri_;
    int issued_{0};
};

} // namespace aedst::oidc::testing
