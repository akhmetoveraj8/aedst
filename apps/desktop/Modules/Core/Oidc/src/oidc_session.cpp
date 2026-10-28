#include "aedst/core/guarded.hpp"
#include "aedst/logging/log_categories.hpp"
#include "oidc_session_internal.hpp"

#include <QDateTime>
#include <QDesktopServices>
#include <QNetworkAccessManager>
#include <QOAuthHttpServerReplyHandler>
#include <QUrl>

#include <ctime>
#include <memory>
#include <string>
#include <utility>

// OidcSession: state, discovery, restore and the single-flight refresh. Sign-in lives in
// oidc_session_signin.cpp, sign-out in oidc_session_signout.cpp.

namespace aedst::oidc {

namespace internal {

namespace {

/// OAuth error codes that mean "this refresh token will never work again".
[[nodiscard]] bool isTerminalGrantError(const QString& error) {
    return error == QLatin1String("invalid_grant") || error == QLatin1String("invalid_token") ||
           error == QLatin1String("invalid_client") || error == QLatin1String("unauthorized_client");
}

} // namespace

core::Error serverError(const QString& error, const QString& description) {
    std::string message = "OIDC provider reported: " + error.toStdString();
    if (!description.isEmpty()) {
        message += " (" + description.toStdString() + ")";
    }
    if (error == QLatin1String("access_denied")) {
        return core::Error::cancelled("Sign-in was cancelled or denied");
    }
    if (isTerminalGrantError(error)) {
        return core::Error::unauthenticated(std::move(message));
    }
    return core::Error::unavailable(std::move(message)); // temporarily_unavailable, server_error, ...
}

} // namespace internal

namespace {

constexpr auto kFallbackLifetime = std::chrono::minutes{5};

} // namespace

using internal::serverError;
using internal::toMs;

OidcSession::OidcSession(OidcConfig config, Dependencies dependencies, QObject* parent)
    : QObject(parent), config_(std::move(config)), deps_(std::move(dependencies)) {
    if (!deps_.clock) {
        deps_.clock = std::make_shared<core::SystemClock>();
    }
    if (!deps_.openBrowser) {
        deps_.openBrowser = [](const QUrl& url) { return QDesktopServices::openUrl(url); };
    }
}

OidcSession::~OidcSession() = default;

std::chrono::system_clock::time_point OidcSession::now() const {
    return deps_.clock->now();
}

// --- State ----------------------------------------------------------------------------------

std::optional<std::string> OidcSession::accessToken() const {
    if (accessToken_.empty()) {
        return std::nullopt;
    }
    return accessToken_.reveal();
}

bool OidcSession::isSignedIn() const noexcept {
    return !refreshToken_.empty();
}

std::optional<OidcUser> OidcSession::user() const {
    return user_;
}

std::chrono::system_clock::time_point OidcSession::accessTokenExpiresAt() const noexcept {
    return expiresAt_;
}

bool OidcSession::hasValidAccessToken() const {
    return !accessToken_.empty() && now() + config_.refreshSkew < expiresAt_;
}

bool OidcSession::signInInProgress() const noexcept {
    return signIn_ != nullptr;
}

void OidcSession::clearMemory() {
    const bool wasSignedIn = isSignedIn();
    accessToken_.clear();
    refreshToken_.clear();
    idToken_.clear();
    expiresAt_ = {};
    user_.reset();
    ++epoch_;
    refreshing_ = false;
    if (wasSignedIn) {
        emit signedInChanged();
    }
}

void OidcSession::applyTokens(Tokens tokens) {
    const bool wasSignedIn = isSignedIn();
    accessToken_ = std::move(tokens.access);
    expiresAt_ = tokens.expiresAt;
    if (!tokens.idToken.empty()) {
        idToken_ = std::move(tokens.idToken);
        if (auto claims = validateIdToken(idToken_.reveal(), config_, now())) {
            user_ = std::move(*claims);
        }
    }
    const bool rotated = !tokens.refresh.empty() && tokens.refresh.reveal() != refreshToken_.reveal();
    if (rotated) {
        refreshToken_ = std::move(tokens.refresh);
        if (wasSignedIn) {
            persistRotatedRefreshToken(); // sign-in persists through its own, awaited path
        }
    }
    if (!wasSignedIn && isSignedIn()) {
        emit signedInChanged();
    }
}

void OidcSession::persistRotatedRefreshToken() {
    if (!user_ || refreshToken_.empty()) {
        return;
    }
    deps_.store->save(
        StoredIdentity{.refreshToken = refreshToken_, .subject = user_->subject}, [](core::VoidOutcome saved) {
            if (!saved) {
                // The in-memory session keeps working; the next start will need a fresh sign-in.
                qCWarning(lcAuth, "Could not persist the rotated refresh token: %s", saved.error().message.c_str());
            }
        });
}

// --- Discovery ------------------------------------------------------------------------------

void OidcSession::resolveEndpoints(core::Completion<OidcEndpoints> done) {
    if (endpoints_) {
        core::invokeGuarded("OIDC completion", [&] { done(*endpoints_); });
        return;
    }
    endpointWaiters_.push_back(std::move(done));
    if (endpointWaiters_.size() > 1) {
        return; // a discovery request is already in flight
    }
    QPointer<OidcSession> self(this);
    fetchDiscovery(*deps_.network, config_, [self](core::Outcome<OidcEndpoints> result) {
        if (!self) {
            return;
        }
        if (result) {
            self->endpoints_ = *result;
        }
        auto waiters = std::exchange(self->endpointWaiters_, {});
        for (auto& waiter : waiters) {
            waiter(result);
        }
    });
}

// --- Sign-in --------------------------------------------------------------------------------

OidcSession::Tokens OidcSession::readTokens(const QOAuth2AuthorizationCodeFlow& flow) const {
    Tokens tokens;
    tokens.access = core::SecretString(flow.token().toStdString());
    tokens.refresh = core::SecretString(flow.refreshToken().toStdString());
    tokens.idToken = core::SecretString(flow.idToken().toStdString());
    const QDateTime expiration = flow.expirationAt();
    tokens.expiresAt =
        expiration.isValid()
            ? std::chrono::system_clock::from_time_t(static_cast<std::time_t>(expiration.toSecsSinceEpoch()))
            : now() + kFallbackLifetime;
    return tokens;
}

// --- Restore and refresh ---------------------------------------------------------------------

void OidcSession::restore(core::Completion<std::optional<OidcUser>> done) {
    if (isSignedIn() && hasValidAccessToken()) {
        core::invokeGuarded("OIDC completion", [&] { done(user_); });
        return;
    }
    QPointer<OidcSession> self(this);
    deps_.store->load([self, done = std::move(done)](core::Outcome<std::optional<StoredIdentity>> loaded) {
        if (!self) {
            return;
        }
        if (!loaded) {
            core::invokeGuarded("OIDC completion", [&] { done(core::fail(loaded.error())); });
            return;
        }
        if (!loaded->has_value()) {
            core::invokeGuarded("OIDC completion", [&] { done(std::optional<OidcUser>{}); });
            return;
        }
        self->refreshToken_ = std::move((*loaded)->refreshToken);
        self->user_ = OidcUser{.subject = (*loaded)->subject, .email = {}, .name = {}};
        emit self->signedInChanged();
        self->refreshWaiters_.push_back([self, done](core::Outcome<std::string> refreshed) {
            if (!self) {
                return;
            }
            if (!refreshed) {
                core::invokeGuarded("OIDC completion", [&] {
                    done(core::fail(refreshed.error()));
                }); // offline keeps the identity; rejected already cleared it
                return;
            }
            core::invokeGuarded("OIDC completion", [&] { done(self->user_); });
        });
        self->startRefresh();
    });
}

void OidcSession::ensureFreshAccessToken(core::Completion<std::string> done) {
    if (!isSignedIn()) {
        core::invokeGuarded("OIDC completion",
                            [&] { done(core::fail(core::Error::unauthenticated("Not signed in"))); });
        return;
    }
    if (hasValidAccessToken()) {
        core::invokeGuarded("OIDC completion", [&] { done(accessToken_.reveal()); });
        return;
    }
    refreshWaiters_.push_back(std::move(done));
    startRefresh();
}

void OidcSession::refreshAfterRejection(const std::string& rejectedToken, core::Completion<std::string> done) {
    if (!isSignedIn()) {
        core::invokeGuarded("OIDC completion",
                            [&] { done(core::fail(core::Error::unauthenticated("Not signed in"))); });
        return;
    }
    // Several in-flight calls fail with the same stale token: only the first one refreshes.
    if (!refreshing_ && hasValidAccessToken() && accessToken_.reveal() != rejectedToken) {
        core::invokeGuarded("OIDC completion", [&] { done(accessToken_.reveal()); });
        return;
    }
    refreshWaiters_.push_back(std::move(done));
    startRefresh();
}

void OidcSession::startRefresh() {
    if (refreshing_) {
        return; // single flight: the waiter queued by the caller piggybacks on the running request
    }
    refreshing_ = true;
    const std::uint64_t epoch = epoch_;
    QPointer<OidcSession> self(this);
    resolveEndpoints([self, epoch](core::Outcome<OidcEndpoints> endpoints) {
        if (!self || epoch != self->epoch_) {
            return;
        }
        if (!endpoints) {
            self->finishRefresh(epoch, core::fail(endpoints.error()));
            return;
        }
        self->runRefresh(*endpoints);
    });
}

void OidcSession::runRefresh(const OidcEndpoints& endpoints) {
    const std::uint64_t epoch = epoch_;
    auto* flow = new QOAuth2AuthorizationCodeFlow(deps_.network, this);
    flow->setClientIdentifier(config_.clientId);
    flow->setAuthorizationUrl(endpoints.authorization);
    flow->setTokenUrl(endpoints.token);
    flow->setRequestedScopeTokens(config_.scopeTokens());
    flow->setRefreshToken(QString::fromStdString(refreshToken_.reveal()));

    auto* guard = new QTimer(flow);
    guard->setSingleShot(true);

    // Qt reports the outcome through signals whose combination differs between server and network
    // failures; whichever comes first settles the refresh, later ones are ignored.
    auto settled = std::make_shared<bool>(false);
    QPointer<OidcSession> self(this);
    auto settle = [self, flow, settled, epoch](core::Outcome<Tokens> result) {
        if (*settled) {
            return;
        }
        *settled = true;
        flow->deleteLater();
        if (self) {
            self->finishRefresh(epoch, std::move(result));
        }
    };

    QObject::connect(flow, &QAbstractOAuth::statusChanged, flow, [flow, settle, self](QAbstractOAuth::Status status) {
        if (status == QAbstractOAuth::Status::Granted && self) {
            settle(self->readTokens(*flow));
        }
    });
    QObject::connect(flow, &QAbstractOAuth2::serverReportedErrorOccurred, flow,
                     [settle](const QString& error, const QString& description, const QUrl&) {
                         settle(core::fail(serverError(error, description)));
                     });
    QObject::connect(flow, &QAbstractOAuth::requestFailed, flow, [settle](QAbstractOAuth::Error error) {
        // No OAuth error body: treat as transport trouble and keep the session.
        settle(core::fail(core::Error::unavailable("Token refresh request failed (Qt OAuth error " +
                                                   std::to_string(static_cast<int>(error)) + ")")));
    });
    QObject::connect(guard, &QTimer::timeout, flow,
                     [settle]() { settle(core::fail(core::Error::unavailable("Token refresh timed out"))); });
    guard->start(static_cast<int>(toMs(config_.requestTimeout * 2).count()));
    flow->refreshTokens();
}

void OidcSession::finishRefresh(std::uint64_t epoch, core::Outcome<Tokens> result) {
    if (epoch != epoch_) {
        return; // signOut() happened meanwhile; its waiters were already failed
    }
    refreshing_ = false;
    if (result) {
        if (result->access.empty()) {
            result = core::fail(core::Error::unauthenticated("The provider returned an empty access token"));
        }
    }
    if (!result) {
        const core::Error error = result.error();
        if (error.code == core::ErrorCode::Unauthenticated) {
            qCWarning(lcAuth, "Refresh token rejected; the session has ended: %s", error.message.c_str());
            clearMemory();
            deps_.store->clear([](core::VoidOutcome cleared) {
                if (!cleared) {
                    qCWarning(lcAuth, "Could not clear the stored identity: %s", cleared.error().message.c_str());
                }
            });
            failRefreshWaiters(error);
            emit sessionExpired();
            return;
        }
        qCWarning(lcAuth, "Token refresh failed, keeping the session: %s", error.message.c_str());
        failRefreshWaiters(error);
        return;
    }
    applyTokens(std::move(*result));
    qCInfo(lcAuth, "Access token refreshed");
    auto waiters = std::exchange(refreshWaiters_, {});
    for (auto& waiter : waiters) {
        waiter(accessToken_.reveal());
    }
}

void OidcSession::failRefreshWaiters(const core::Error& error) {
    auto waiters = std::exchange(refreshWaiters_, {});
    for (auto& waiter : waiters) {
        waiter(core::fail(error));
    }
}

} // namespace aedst::oidc
