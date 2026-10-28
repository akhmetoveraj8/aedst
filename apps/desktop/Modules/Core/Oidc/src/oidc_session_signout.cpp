#include "aedst/logging/log_categories.hpp"
#include "oidc_session_internal.hpp"

#include <QByteArray>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrl>
#include <QUrlQuery>

#include <utility>

// OidcSession: sign-out, revocation (RFC 7009) and RP-initiated logout (split out of
// oidc_session.cpp, no behaviour change).

namespace aedst::oidc {

namespace {

[[nodiscard]] QByteArray formField(const QByteArray& name, const QString& value) {
    return name + '=' + QUrl::toPercentEncoding(value);
}

} // namespace

using internal::toMs;

void OidcSession::signOut(core::Completion<void> done) {
    cancelSignIn();
    const core::SecretString refresh = refreshToken_;
    const core::SecretString idToken = idToken_;
    clearMemory();
    failRefreshWaiters(core::Error::unauthenticated("Signed out"));

    QPointer<OidcSession> self(this);
    deps_.store->clear([self, refresh, idToken, done = std::move(done)](core::VoidOutcome stored) {
        // The user is signed out locally from here on; tell the caller now and finish the
        // provider-side cleanup in the background (it may take a network timeout when offline).
        core::invokeGuarded("OIDC sign-out completion", [&] { done(stored); });
        if (!self || refresh.empty()) {
            return;
        }
        self->resolveEndpoints([self, refresh, idToken](core::Outcome<OidcEndpoints> endpoints) {
            if (!self || !endpoints) {
                return;
            }
            self->revokeRefreshToken(*endpoints, refresh, [self, endpoints = *endpoints, idToken]() {
                if (self) {
                    self->openEndSession(endpoints, idToken);
                }
            });
        });
    });
}

void OidcSession::revokeRefreshToken(const OidcEndpoints& endpoints, const core::SecretString& refreshToken,
                                     std::function<void()> finished) {
    if (endpoints.revocation.isEmpty() || refreshToken.empty()) {
        finished();
        return;
    }
    QNetworkRequest request(endpoints.revocation);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QByteArrayLiteral("application/x-www-form-urlencoded"));
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(static_cast<int>(toMs(config_.requestTimeout).count()));

    QByteArray body = formField("token", QString::fromStdString(refreshToken.reveal()));
    body += "&token_type_hint=refresh_token&" + formField("client_id", config_.clientId);

    QNetworkReply* reply = deps_.network->post(request, body);
    QObject::connect(reply, &QNetworkReply::finished, reply, [reply, finished = std::move(finished)]() {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) {
            qCWarning(lcAuth, "Token revocation failed: %s", qUtf8Printable(reply->errorString()));
        } else {
            qCInfo(lcAuth, "Refresh token revoked");
        }
        finished();
    });
}

void OidcSession::openEndSession(const OidcEndpoints& endpoints, const core::SecretString& idToken) {
    if (!config_.endSessionInBrowser || endpoints.endSession.isEmpty()) {
        return;
    }
    QUrl url = endpoints.endSession;
    QUrlQuery query(url);
    if (!idToken.empty()) {
        query.addQueryItem(QStringLiteral("id_token_hint"), QString::fromStdString(idToken.reveal()));
    }
    query.addQueryItem(QStringLiteral("client_id"), config_.clientId);
    url.setQuery(query);
    if (!deps_.openBrowser(url)) {
        qCWarning(lcAuth, "Could not open the browser to end the provider session");
    }
}

} // namespace aedst::oidc
