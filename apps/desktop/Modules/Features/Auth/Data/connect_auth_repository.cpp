#include "Data/connect_auth_repository.hpp"

#include "aedst/core/logger.hpp"

#include <chrono>
#include <utility>

namespace aedst::feature::auth {

using core::AedstLogger;

ConnectAuthRepository::ConnectAuthRepository(std::shared_ptr<AuthRemoteDataSource> remote,
                                             std::shared_ptr<LocalTokenStoreAdapter> local,
                                             std::shared_ptr<const core::Clock> clock, std::string deviceId)
    : remote_(std::move(remote)), local_(std::move(local)), clock_(std::move(clock)), deviceId_(std::move(deviceId)) {}

void ConnectAuthRepository::login(const Credentials& credentials, core::Completion<Session> done) {
    authv1::LoginRequest request;
    request.set_email(credentials.email);
    request.set_password(credentials.password.reveal());
    request.set_device_id(deviceId_);
    remote_->login(request,
                   [weak = weak_from_this(), done = std::move(done)](network::ApiResult<authv1::LoginResponse> result) {
                       const auto self = weak.lock();
                       if (!self) {
                           return;
                       }
                       if (!result) {
                           done(core::fail(result.error().toCoreError()));
                           return;
                       }
                       self->persistAndComplete(self->toSession(result->user_id(), result->tokens()), done);
                   });
}

void ConnectAuthRepository::refreshToken(core::Completion<Session> done) {
    auto current = local_->load();
    if (!current) {
        done(core::fail(current.error()));
        return;
    }
    if (!*current) {
        done(core::fail(core::Error::unauthenticated("No session to refresh")));
        return;
    }

    authv1::RefreshTokenRequest request;
    request.set_refresh_token((*current)->refreshToken.reveal());
    remote_->refreshToken(request, [weak = weak_from_this(), userId = (*current)->userId,
                                    done = std::move(done)](network::ApiResult<authv1::RefreshTokenResponse> result) {
        const auto self = weak.lock();
        if (!self) {
            return;
        }
        if (!result) {
            if (result.error().kind == network::ApiErrorKind::Unauthenticated) {
                // Refresh token revoked or expired server-side: the local session is dead too.
                self->local_->clear([](core::VoidOutcome cleared) {
                    if (!cleared) {
                        AedstLogger::error("Failed to clear rejected session: {}", cleared.error().message);
                    }
                });
            }
            done(core::fail(result.error().toCoreError()));
            return;
        }
        self->persistAndComplete(self->toSession(userId, result->tokens()), done);
    });
}

void ConnectAuthRepository::logout(core::Completion<void> done) {
    auto current = local_->load();
    if (!current || !*current) {
        local_->clear([](core::VoidOutcome) {});
        done(core::ok());
        return;
    }

    authv1::LogoutRequest request;
    request.set_refresh_token((*current)->refreshToken.reveal());
    remote_->logout(request, [weak = weak_from_this(), done = std::move(done)](network::ApiResult<void> result) {
        const auto self = weak.lock();
        if (!self) {
            return;
        }
        if (!result) {
            AedstLogger::warn("Server-side logout failed ({}); clearing local session anyway", result.error().message);
        }
        // The session is gone from memory at once; the completion reports the on-disk wipe.
        self->local_->clear([done](core::VoidOutcome cleared) { done(std::move(cleared)); });
    });
}

std::optional<Session> ConnectAuthRepository::currentSession() const {
    auto session = local_->load();
    if (!session) {
        AedstLogger::error("Failed to read stored session: {}", session.error().message);
        return std::nullopt;
    }
    return *session;
}

Session ConnectAuthRepository::toSession(std::string userId, const authv1::TokenPair& tokens) const {
    return {
        .userId = std::move(userId),
        .accessToken = tokens.access_token(),
        .refreshToken = tokens.refresh_token(),
        .accessTokenExpiresAt = clock_->now() + std::chrono::seconds{tokens.access_token_expires_in_seconds()},
    };
}

void ConnectAuthRepository::persistAndComplete(Session session, const core::Completion<Session>& done) {
    // Completes after the write: a session that could not be stored is not a signed-in session.
    local_->save(session, [session, done](core::VoidOutcome saved) {
        if (!saved) {
            AedstLogger::error("Failed to persist session: {}", saved.error().message);
            done(core::fail(saved.error()));
            return;
        }
        done(session);
    });
}

} // namespace aedst::feature::auth
