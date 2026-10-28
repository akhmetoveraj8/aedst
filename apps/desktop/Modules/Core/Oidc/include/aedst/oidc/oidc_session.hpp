#pragma once

#include "aedst/core/clock.hpp"
#include "aedst/core/outcome.hpp"
#include "aedst/core/secure_memory.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/oidc/id_token_claims.hpp"
#include "aedst/oidc/oidc_config.hpp"
#include "aedst/oidc/oidc_discovery.hpp"
#include "aedst/oidc/refresh_token_store.hpp"

#include <QObject>
#include <QUrl>

#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

class QNetworkAccessManager;
class QOAuth2AuthorizationCodeFlow;

namespace aedst::oidc {

/// The signed-in identity of the desktop client: Authorization Code + PKCE (S256) against the
/// OpenID provider (ZITADEL), in the system browser, with a loopback redirect on 127.0.0.1.
///
///  - Sign-in: discovery -> QOAuth2AuthorizationCodeFlow + QOAuthHttpServerReplyHandler on a
///    random loopback port -> the user authenticates in the default browser (never an embedded
///    web view) -> code exchange -> ID token checks -> refresh token goes to the OS keychain.
///  - Tokens: the access token lives in memory only; the refresh token is stored through
///    RefreshTokenStore (Credential Manager / Secret Service). If that store is unavailable the
///    sign-in FAILS with an explicit error - no silent file fallback.
///  - Refresh: ONE refresh at a time (single flight). Any number of callers of
///    ensureFreshAccessToken()/refreshAfterRejection() share the same request; they all receive the
///    same new token. Network failures keep the session; a rejected refresh token ends it
///    (sessionExpired()).
///  - Sign-out: local state is wiped first, then the refresh token is revoked (RFC 7009) and, if the
///    provider offers it, the browser SSO session is ended (RP-initiated logout).
///
/// Not thread-safe: use on the thread that owns the QNetworkAccessManager (the GUI thread).
/// Implements network::TokenProvider (ConnectClient reads the bearer token from here) and
/// network::TokenRefresher (the interceptor refreshes before sending and once after a rejection).
class OidcSession final : public QObject, public network::TokenProvider, public network::TokenRefresher {
    Q_OBJECT

public:
    /// Opens a URL in the system browser; replaced in tests.
    using BrowserLauncher = std::function<bool(const QUrl&)>;

    struct Dependencies {
        QNetworkAccessManager* network{nullptr};
        std::shared_ptr<RefreshTokenStore> store;
        std::shared_ptr<const core::Clock> clock;
        /// Defaults to QDesktopServices::openUrl.
        BrowserLauncher openBrowser;
    };

    OidcSession(OidcConfig config, Dependencies dependencies, QObject* parent = nullptr);
    ~OidcSession() override;

    OidcSession(const OidcSession&) = delete;
    OidcSession& operator=(const OidcSession&) = delete;

    /// Interactive sign-in. Fails with ErrorCode::Cancelled when the user denies or cancelSignIn()
    /// is called, ErrorCode::Storage when the keychain is unavailable, ErrorCode::Unavailable when the
    /// provider cannot be reached, ErrorCode::Unauthenticated for a rejected/invalid response.
    void signIn(core::Completion<OidcUser> done);
    /// Abandons a running browser step (the user pressed Cancel or closed the window).
    void cancelSignIn();
    [[nodiscard]] bool signInInProgress() const noexcept;

    /// Startup: loads the stored refresh token and exchanges it for an access token.
    /// nullopt = nobody was signed in. A network failure returns ErrorCode::Unavailable but KEEPS the
    /// stored identity (isSignedIn() stays true; the next ensureFreshAccessToken() retries).
    /// A rejected refresh token clears the identity and returns ErrorCode::Unauthenticated.
    void restore(core::Completion<std::optional<OidcUser>> done);

    /// A token valid for at least the configured skew, refreshing first when needed.
    void ensureFreshAccessToken(core::Completion<std::string> done) override;
    /// Called after the API rejected `rejectedToken` with Unauthenticated. If another caller already
    /// replaced that token the current one is returned without a second refresh.
    void refreshAfterRejection(const std::string& rejectedToken, core::Completion<std::string> done) override;

    /// Always ends signed out locally. The completion reports the keychain result only; failures
    /// to reach the provider (revocation, end_session) are logged, not surfaced.
    void signOut(core::Completion<void> done);

    /// The current access token, possibly expired (the interceptor decides about refreshing).
    [[nodiscard]] std::optional<std::string> accessToken() const override;
    /// A refresh token is held (even while offline / without an access token).
    [[nodiscard]] bool isSignedIn() const noexcept;
    [[nodiscard]] std::optional<OidcUser> user() const;
    [[nodiscard]] std::chrono::system_clock::time_point accessTokenExpiresAt() const noexcept;
    [[nodiscard]] bool hasValidAccessToken() const;

    [[nodiscard]] const OidcConfig& config() const noexcept { return config_; }

signals:
    void signedInChanged();
    /// The provider rejected the refresh token (revoked, expired, user disabled): sign in again.
    void sessionExpired();

private:
    struct Tokens {
        core::SecretString access;
        core::SecretString refresh;
        core::SecretString idToken;
        std::chrono::system_clock::time_point expiresAt;
    };
    struct SignInAttempt;

    void resolveEndpoints(core::Completion<OidcEndpoints> done);
    void startAuthorization(const OidcEndpoints& endpoints);
    void finishSignIn(core::Outcome<OidcUser> result);
    void completeSignIn(Tokens tokens);

    void startRefresh();
    void runRefresh(const OidcEndpoints& endpoints);
    /// `epoch` is the value of epoch_ when the refresh started; a result that arrives after
    /// signOut() (epoch_ moved on) is dropped so it cannot resurrect a signed-out session.
    void finishRefresh(std::uint64_t epoch, core::Outcome<Tokens> result);
    [[nodiscard]] Tokens readTokens(const QOAuth2AuthorizationCodeFlow& flow) const;

    void applyTokens(Tokens tokens);
    void persistRotatedRefreshToken();
    void clearMemory();
    void revokeRefreshToken(const OidcEndpoints& endpoints, const core::SecretString& refreshToken,
                            std::function<void()> finished);
    void openEndSession(const OidcEndpoints& endpoints, const core::SecretString& idToken);
    void failRefreshWaiters(const core::Error& error);
    [[nodiscard]] std::chrono::system_clock::time_point now() const;

    OidcConfig config_;
    Dependencies deps_;

    std::optional<OidcEndpoints> endpoints_;
    std::vector<core::Completion<OidcEndpoints>> endpointWaiters_;

    core::SecretString accessToken_;
    core::SecretString refreshToken_;
    core::SecretString idToken_;
    std::chrono::system_clock::time_point expiresAt_{};
    std::optional<OidcUser> user_;

    /// Bumped by clearMemory(); fences refresh results that belong to a previous session.
    std::uint64_t epoch_{0};
    bool refreshing_{false};
    std::vector<core::Completion<std::string>> refreshWaiters_;
    std::unique_ptr<SignInAttempt> signIn_;
};

} // namespace aedst::oidc
