#pragma once

#include "Domain/auth_repository.hpp"
#include "Domain/session.hpp"

#include <memory>
#include <optional>

namespace aedst::oidc {
class OidcSession;
} // namespace aedst::oidc

namespace aedst::feature::auth {

/// AuthRepository backed by the OpenID Connect session (ZITADEL): browser sign-in with PKCE,
/// refresh through the session's single-flight refresh, revoke + end_session on logout.
///
/// Password login does not exist here. The refresh token is never exposed: Session::refreshToken
/// stays empty and the token lives in the OS keychain behind OidcSession. When the application
/// starts offline the session has an identity but no access token yet; currentSession() then
/// reports an already-expired access token so RefreshTokenUseCase refreshes it.
class OidcAuthRepository final : public AuthRepository {
public:
    explicit OidcAuthRepository(std::shared_ptr<oidc::OidcSession> session);

    void login(const Credentials& credentials, core::Completion<Session> done) override;
    void refreshToken(core::Completion<Session> done) override;
    void logout(core::Completion<void> done) override;
    [[nodiscard]] std::optional<Session> currentSession() const override;

    void signInWithBrowser(core::Completion<Session> done) override;
    void cancelBrowserSignIn() override;

    [[nodiscard]] bool supportsBrowserSignIn() const override { return true; }

private:
    std::shared_ptr<oidc::OidcSession> session_;
};

} // namespace aedst::feature::auth
