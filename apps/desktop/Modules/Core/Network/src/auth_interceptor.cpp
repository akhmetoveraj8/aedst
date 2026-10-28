#include "aedst/network/auth_interceptor.hpp"

#include <QByteArray>
#include <QNetworkRequest>

#include <utility>

namespace aedst::network {
namespace {

[[nodiscard]] ApiError sessionEnded(const core::Error& error) {
    return ApiError{.kind = ApiErrorKind::Unauthenticated,
                    .httpStatus = 0,
                    .message = error.message,
                    .connectCode = "unauthenticated"};
}

[[nodiscard]] ApiError refreshUnavailable(const core::Error& error) {
    return ApiError{
        .kind = ApiErrorKind::Transport, .httpStatus = 0, .message = "Could not refresh the session: " + error.message};
}

} // namespace

AuthInterceptor::AuthInterceptor(std::shared_ptr<const TokenProvider> tokenProvider,
                                 std::shared_ptr<TokenRefresher> refresher)
    : tokenProvider_(std::move(tokenProvider)), refresher_(std::move(refresher)) {}

void AuthInterceptor::apply(QNetworkRequest& request, AuthRequirement requirement) const {
    if (requirement == AuthRequirement::Public || !tokenProvider_) {
        return;
    }
    const auto token = tokenProvider_->accessToken();
    if (!token || token->empty()) {
        return;
    }
    request.setRawHeader("Authorization", QByteArray("Bearer ") + QByteArray::fromStdString(*token));
}

void AuthInterceptor::prepare(AuthRequirement requirement, Verdict ready) const {
    if (!refresher_ || requirement == AuthRequirement::Public) {
        ready(std::nullopt);
        return;
    }
    refresher_->ensureFreshAccessToken([ready = std::move(ready)](core::Outcome<std::string> token) {
        if (!token && token.error().code == core::ErrorCode::Unauthenticated) {
            ready(sessionEnded(token.error())); // not signed in, or the refresh token was rejected
            return;
        }
        ready(std::nullopt); // fresh token, or a transient failure: send with what we have
    });
}

void AuthInterceptor::refreshAfterRejection(const std::string& rejectedToken, Verdict retry) const {
    if (!refresher_) {
        retry(sessionEnded(core::Error::unauthenticated("Not signed in")));
        return;
    }
    refresher_->refreshAfterRejection(rejectedToken, [retry = std::move(retry)](core::Outcome<std::string> token) {
        if (token) {
            retry(std::nullopt);
            return;
        }
        retry(token.error().code == core::ErrorCode::Unauthenticated ? sessionEnded(token.error())
                                                                     : refreshUnavailable(token.error()));
    });
}

} // namespace aedst::network
