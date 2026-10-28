#include "aedst/logging/log_categories.hpp"
#include "oidc_session_internal.hpp"

#include <QHostAddress>
#include <QOAuthHttpServerReplyHandler>
#include <QUrl>
#include <QUuid>

#include <memory>
#include <string>
#include <utility>

// OidcSession: interactive browser sign-in (split out of oidc_session.cpp, no behaviour change).

namespace aedst::oidc {

using internal::serverError;
using internal::toMs;

void OidcSession::signIn(core::Completion<OidcUser> done) {
    if (auto valid = validateOidcConfig(config_); !valid) {
        done(core::fail(valid.error()));
        return;
    }
    if (signIn_) {
        done(core::fail(core::Error::invalidInput("A sign-in is already in progress")));
        return;
    }
    signIn_ = std::make_unique<SignInAttempt>();
    signIn_->done = std::move(done);

    QPointer<OidcSession> self(this);
    resolveEndpoints([self](core::Outcome<OidcEndpoints> endpoints) {
        if (!self || !self->signIn_) {
            return; // destroyed or cancelled while discovering
        }
        if (!endpoints) {
            self->finishSignIn(core::fail(endpoints.error()));
            return;
        }
        self->startAuthorization(*endpoints);
    });
}

void OidcSession::startAuthorization(const OidcEndpoints& endpoints) {
    auto* flow = new QOAuth2AuthorizationCodeFlow(deps_.network, this);
    flow->setClientIdentifier(config_.clientId);
    flow->setAuthorizationUrl(endpoints.authorization);
    flow->setTokenUrl(endpoints.token);
    flow->setRequestedScopeTokens(config_.scopeTokens());
    flow->setPkceMethod(QOAuth2AuthorizationCodeFlow::PkceMethod::S256);
    // Bind the ID token to this attempt: a fresh random nonce goes out with the request and must come back in the
    // token.
    signIn_->nonce = QUuid::createUuid().toString(QUuid::WithoutBraces) + QUuid::createUuid().toString(QUuid::Id128);
    flow->setNonceMode(QAbstractOAuth2::NonceMode::Enabled);
    flow->setNonce(signIn_->nonce);

    // RFC 8252: loopback redirect on 127.0.0.1 with a port the OS picks (or the configured fixed one).
    auto* handler = new QOAuthHttpServerReplyHandler(QHostAddress::LocalHost, config_.loopbackPort, flow);
    if (!handler->isListening()) {
        flow->deleteLater();
        finishSignIn(core::fail(core::Error::unavailable("Could not open a loopback port for the sign-in redirect")));
        return;
    }
    handler->setCallbackPath(QStringLiteral("/callback"));
    handler->setCallbackText(QStringLiteral(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>AEDST</title></head><body style=\"font-family:"
        "sans-serif;text-align:center;margin-top:20vh\"><h2>AEDST</h2><p>You can close this tab and return to the "
        "application.</p></body></html>"));
    flow->setReplyHandler(handler);

    signIn_->flow = flow;
    signIn_->timeout = new QTimer(flow);
    signIn_->timeout->setSingleShot(true);

    QPointer<OidcSession> self(this);
    QObject::connect(signIn_->timeout, &QTimer::timeout, flow, [self]() {
        if (self) {
            self->finishSignIn(core::fail(core::Error::cancelled("Sign-in timed out")));
        }
    });
    QObject::connect(flow, &QAbstractOAuth::authorizeWithBrowser, flow, [self](const QUrl& url) {
        if (self && !self->deps_.openBrowser(url)) {
            self->finishSignIn(core::fail(core::Error::unknown("Could not open the system browser")));
        }
    });
    QObject::connect(flow, &QAbstractOAuth2::serverReportedErrorOccurred, flow,
                     [self](const QString& error, const QString& description, const QUrl&) {
                         if (self) {
                             self->finishSignIn(core::fail(serverError(error, description)));
                         }
                     });
    QObject::connect(flow, &QAbstractOAuth::requestFailed, flow, [self](QAbstractOAuth::Error error) {
        if (self) {
            self->finishSignIn(core::fail(core::Error::unavailable("Sign-in request failed (Qt OAuth error " +
                                                                   std::to_string(static_cast<int>(error)) + ")")));
        }
    });
    QObject::connect(flow, &QAbstractOAuth::granted, flow, [self, flow]() {
        if (!self || !self->signIn_ || self->signIn_->exchanging) {
            return;
        }
        self->signIn_->exchanging = true;
        self->completeSignIn(self->readTokens(*flow));
    });

    signIn_->timeout->start(static_cast<int>(toMs(config_.signInTimeout).count()));
    qCInfo(lcAuth, "Starting browser sign-in (loopback port %d)", static_cast<int>(handler->port()));
    flow->grant();
}

void OidcSession::completeSignIn(Tokens tokens) {
    if (!signIn_) {
        return; // cancelled while the code was being exchanged
    }
    if (tokens.access.empty()) {
        finishSignIn(core::fail(core::Error::unauthenticated("The provider did not return an access token")));
        return;
    }
    if (tokens.refresh.empty()) {
        finishSignIn(core::fail(core::Error::unauthenticated(
            "The provider did not return a refresh token; check that the application allows refresh tokens "
            "(scope offline_access)")));
        return;
    }
    const std::string nonce = signIn_ ? signIn_->nonce.toStdString() : std::string{};
    auto user = validateIdToken(tokens.idToken.reveal(), config_, now(), std::chrono::seconds{60}, nonce);
    if (!user) {
        finishSignIn(core::fail(user.error()));
        return;
    }

    QPointer<OidcSession> self(this);
    const StoredIdentity identity{.refreshToken = tokens.refresh, .subject = user->subject};
    deps_.store->save(identity, [self, tokens = std::move(tokens), user = *user](core::VoidOutcome saved) mutable {
        if (!self) {
            return;
        }
        if (!saved) {
            // Never keep a session that cannot be restored securely: discard the grant at the provider.
            qCWarning(lcAuth, "Sign-in aborted, credential storage unavailable: %s", saved.error().message.c_str());
            if (self->endpoints_) {
                self->revokeRefreshToken(*self->endpoints_, tokens.refresh, [] {});
            }
            self->finishSignIn(core::fail(saved.error()));
            return;
        }
        self->refreshToken_ = tokens.refresh; // applyTokens() sees "unchanged" and does not re-save
        self->applyTokens(std::move(tokens));
        self->user_ = user;
        emit self->signedInChanged();
        self->finishSignIn(user);
    });
}

void OidcSession::finishSignIn(core::Outcome<OidcUser> result) {
    if (!signIn_) {
        return;
    }
    const auto attempt = std::move(signIn_);
    if (attempt->timeout) {
        attempt->timeout->stop();
    }
    if (attempt->flow) {
        attempt->flow->deleteLater(); // also closes the loopback server (child of the flow)
    }
    if (result) {
        qCInfo(lcAuth, "Browser sign-in completed");
    } else {
        qCInfo(lcAuth, "Browser sign-in did not complete: %s", result.error().message.c_str());
    }
    if (attempt->done) {
        core::invokeGuarded("OIDC sign-in completion", [&] { attempt->done(std::move(result)); });
    }
}

void OidcSession::cancelSignIn() {
    finishSignIn(core::fail(core::Error::cancelled("Sign-in was cancelled")));
}

} // namespace aedst::oidc
