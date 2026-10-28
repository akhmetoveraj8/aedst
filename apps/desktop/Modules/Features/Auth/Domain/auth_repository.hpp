#pragma once

#include "Domain/session.hpp"
#include "aedst/core/outcome.hpp"
#include "aedst/core/secure_memory.hpp"

#include <optional>
#include <string>

namespace aedst::feature::auth {

struct Credentials {
    std::string email;
    core::SecretString password;
};

/// Domain-owned port; Data/ConnectAuthRepository implements it. Presentation only
/// ever reaches this through a use case.
class AuthRepository {
public:
    AuthRepository() = default;
    AuthRepository(const AuthRepository&) = delete;
    AuthRepository& operator=(const AuthRepository&) = delete;
    AuthRepository(AuthRepository&&) = delete;
    AuthRepository& operator=(AuthRepository&&) = delete;
    virtual ~AuthRepository() = default;

    virtual void login(const Credentials& credentials, core::Completion<Session> done) = 0;
    virtual void refreshToken(core::Completion<Session> done) = 0;
    /// Always ends signed out locally, even if the server call fails.
    virtual void logout(core::Completion<void> done) = 0;
    [[nodiscard]] virtual std::optional<Session> currentSession() const = 0;

    /// Interactive sign-in in the system browser (OpenID Connect, Authorization Code + PKCE).
    /// The default - for repositories backed by the first-party password API - refuses.
    virtual void signInWithBrowser(core::Completion<Session> done) {
        done(core::fail(core::Error::invalidInput("Browser sign-in is not available")));
    }

    /// Abandons a running browser step; completes the pending signInWithBrowser() with Cancelled.
    virtual void cancelBrowserSignIn() {}

    [[nodiscard]] virtual bool supportsBrowserSignIn() const { return false; }
};

} // namespace aedst::feature::auth
