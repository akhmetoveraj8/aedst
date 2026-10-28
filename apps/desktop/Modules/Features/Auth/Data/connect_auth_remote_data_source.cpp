#include "Data/connect_auth_remote_data_source.hpp"

#include "aedst/contract/methods.hpp"
#include "aedst/network/connect_client.hpp"

#include <string>
#include <utility>

namespace aedst::feature::auth {
namespace {

[[nodiscard]] bool hasTokens(const authv1::TokenPair& tokens) {
    return !tokens.access_token().empty() && !tokens.refresh_token().empty();
}

[[nodiscard]] bool isComplete(const authv1::LoginResponse& response) {
    return !response.user_id().empty() && hasTokens(response.tokens());
}

[[nodiscard]] bool isComplete(const authv1::RefreshTokenResponse& response) {
    return hasTokens(response.tokens());
}

/// Turns a well-formed but incomplete 2xx body (e.g. a proxy answering with an
/// empty message) into a Decoding error instead of an empty session.
template <typename Response>
network::ApiCompletion<Response> requireComplete(network::ApiCompletion<Response> done, std::string what) {
    return [done = std::move(done), what = std::move(what)](network::ApiResult<Response> result) {
        if (result && !isComplete(*result)) {
            done(std::unexpected(network::ApiError{
                .kind = network::ApiErrorKind::Decoding, .httpStatus = 200, .message = "Incomplete " + what}));
            return;
        }
        done(std::move(result));
    };
}

} // namespace

ConnectAuthRemoteDataSource::ConnectAuthRemoteDataSource(std::shared_ptr<network::ConnectClient> client)
    : client_(std::move(client)) {}

void ConnectAuthRemoteDataSource::login(const authv1::LoginRequest& request,
                                        network::ApiCompletion<authv1::LoginResponse> done) {
    client_->unary(contract::kAuthLogin, request,
                   requireComplete<authv1::LoginResponse>(std::move(done), "LoginResponse"));
}

void ConnectAuthRemoteDataSource::refreshToken(const authv1::RefreshTokenRequest& request,
                                               network::ApiCompletion<authv1::RefreshTokenResponse> done) {
    client_->unary(contract::kAuthRefreshToken, request,
                   requireComplete<authv1::RefreshTokenResponse>(std::move(done), "RefreshTokenResponse"));
}

void ConnectAuthRemoteDataSource::logout(const authv1::LogoutRequest& request, network::ApiCompletion<void> done) {
    client_->unary(contract::kAuthLogout, request,
                   [done = std::move(done)](network::ApiResult<authv1::LogoutResponse> result) {
                       if (!result) {
                           done(std::unexpected(std::move(result.error())));
                           return;
                       }
                       done(network::ApiResult<void>{});
                   });
}

} // namespace aedst::feature::auth
