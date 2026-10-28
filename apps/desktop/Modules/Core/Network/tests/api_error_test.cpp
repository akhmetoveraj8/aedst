#include "aedst/network/api_error.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/testing/stub_token_provider.hpp"

#include <QNetworkRequest>

#include <gtest/gtest.h>

#include <memory>
#include <optional>
#include <string_view>
#include <utility>

namespace aedst::network {
namespace {

TEST(ApiErrorTest, MapsEveryConnectCodeFromTheSpec) {
    // https://connectrpc.com/docs/protocol#error-codes - all 16 codes.
    const std::pair<std::string_view, ApiErrorKind> table[] = {
        {"canceled", ApiErrorKind::Cancelled},
        {"unknown", ApiErrorKind::Unknown},
        {"invalid_argument", ApiErrorKind::InvalidArgument},
        {"deadline_exceeded", ApiErrorKind::Timeout},
        {"not_found", ApiErrorKind::NotFound},
        {"already_exists", ApiErrorKind::AlreadyExists},
        {"permission_denied", ApiErrorKind::PermissionDenied},
        {"resource_exhausted", ApiErrorKind::Unavailable},
        {"failed_precondition", ApiErrorKind::InvalidArgument},
        {"aborted", ApiErrorKind::AlreadyExists},
        {"out_of_range", ApiErrorKind::InvalidArgument},
        {"unimplemented", ApiErrorKind::Internal},
        {"internal", ApiErrorKind::Internal},
        {"unavailable", ApiErrorKind::Unavailable},
        {"data_loss", ApiErrorKind::Internal},
        {"unauthenticated", ApiErrorKind::Unauthenticated},
    };
    for (const auto& [code, kind] : table) {
        EXPECT_EQ(ApiError::kindFromConnectCode(code), kind) << code;
    }
    EXPECT_EQ(ApiError::kindFromConnectCode("something_new"), ApiErrorKind::Unknown);
}

TEST(ApiErrorTest, HttpStatusFallbackFollowsTheConnectSpecTable) {
    // https://connectrpc.com/docs/protocol#http-to-error-code
    EXPECT_EQ(ApiError::kindFromHttpStatus(400), ApiErrorKind::Internal);
    EXPECT_EQ(ApiError::kindFromHttpStatus(401), ApiErrorKind::Unauthenticated);
    EXPECT_EQ(ApiError::kindFromHttpStatus(403), ApiErrorKind::PermissionDenied);
    EXPECT_EQ(ApiError::kindFromHttpStatus(404), ApiErrorKind::Internal); // unimplemented
    EXPECT_EQ(ApiError::kindFromHttpStatus(429), ApiErrorKind::Unavailable);
    EXPECT_EQ(ApiError::kindFromHttpStatus(502), ApiErrorKind::Unavailable);
    EXPECT_EQ(ApiError::kindFromHttpStatus(503), ApiErrorKind::Unavailable);
    EXPECT_EQ(ApiError::kindFromHttpStatus(504), ApiErrorKind::Unavailable);
    EXPECT_EQ(ApiError::kindFromHttpStatus(500), ApiErrorKind::Unknown);
    EXPECT_EQ(ApiError::kindFromHttpStatus(418), ApiErrorKind::Unknown);
}

TEST(ApiErrorTest, FallsBackToHttpStatusWhenBodyHasNoCode) {
    const auto error = ApiError::fromConnectResponse(503, "", "upstream down");

    EXPECT_EQ(error.kind, ApiErrorKind::Unavailable);
    EXPECT_EQ(error.httpStatus, 503);
    EXPECT_EQ(error.message, "upstream down");
    EXPECT_TRUE(error.connectCode.empty());
}

TEST(ApiErrorTest, ConnectCodeWinsOverHttpStatusAndIsKept) {
    const auto error = ApiError::fromConnectResponse(400, "not_found", "no such task");

    EXPECT_EQ(error.kind, ApiErrorKind::NotFound);
    EXPECT_EQ(error.connectCode, "not_found");
}

TEST(ApiErrorTest, OnlyTransientFailuresAreRetryable) {
    EXPECT_TRUE((ApiError{.kind = ApiErrorKind::Transport}).isRetryable());
    EXPECT_TRUE((ApiError{.kind = ApiErrorKind::Timeout}).isRetryable());
    EXPECT_TRUE((ApiError{.kind = ApiErrorKind::Unavailable, .httpStatus = 503}).isRetryable());
    EXPECT_FALSE((ApiError{.kind = ApiErrorKind::Unavailable, .httpStatus = 429, .connectCode = "resource_exhausted"})
                     .isRetryable());
    EXPECT_TRUE(
        (ApiError{.kind = ApiErrorKind::Unavailable, .httpStatus = 503, .connectCode = "unavailable"}).isRetryable());
    EXPECT_TRUE(
        (ApiError{.kind = ApiErrorKind::Timeout, .httpStatus = 408, .connectCode = "deadline_exceeded"}).isRetryable());
    EXPECT_FALSE((ApiError{.kind = ApiErrorKind::Unauthenticated, .httpStatus = 401}).isRetryable());
    EXPECT_FALSE((ApiError{.kind = ApiErrorKind::InvalidArgument, .httpStatus = 400}).isRetryable());
    EXPECT_FALSE((ApiError{.kind = ApiErrorKind::Internal, .httpStatus = 500}).isRetryable());
    EXPECT_FALSE((ApiError{.kind = ApiErrorKind::NotFound, .httpStatus = 404}).isRetryable());
    EXPECT_FALSE((ApiError{.kind = ApiErrorKind::Cancelled}).isRetryable());
    EXPECT_FALSE((ApiError{.kind = ApiErrorKind::Decoding}).isRetryable());
}

TEST(ApiErrorTest, ConvertsToCoreErrorCodes) {
    EXPECT_EQ((ApiError{.kind = ApiErrorKind::Transport, .message = "offline"}).toCoreError(),
              core::Error::offline("offline"));
    EXPECT_EQ((ApiError{.kind = ApiErrorKind::PermissionDenied, .httpStatus = 403, .message = "no"}).toCoreError().code,
              core::ErrorCode::Forbidden);
    EXPECT_EQ((ApiError{.kind = ApiErrorKind::Decoding, .httpStatus = 200, .message = "bad"}).toCoreError().code,
              core::ErrorCode::Unknown);
}

TEST(AuthInterceptorTest, AddsBearerTokenToAuthenticatedMethods) {
    AuthInterceptor interceptor(std::make_shared<testing::StubTokenProvider>("tok"));
    QNetworkRequest request;

    interceptor.apply(request, AuthRequirement::Required);

    EXPECT_EQ(request.rawHeader("Authorization"), QByteArray("Bearer tok"));
}

TEST(AuthInterceptorTest, NeverSendsTheTokenToPublicMethods) {
    AuthInterceptor interceptor(std::make_shared<testing::StubTokenProvider>("tok"));
    QNetworkRequest request;

    interceptor.apply(request, AuthRequirement::Public);

    EXPECT_FALSE(request.hasRawHeader("Authorization"));
}

TEST(AuthInterceptorTest, OmitsTheHeaderWhenThereIsNoToken) {
    AuthInterceptor interceptor(std::make_shared<testing::StubTokenProvider>(std::nullopt));
    QNetworkRequest request;

    interceptor.apply(request, AuthRequirement::Required);

    EXPECT_FALSE(request.hasRawHeader("Authorization"));
}

} // namespace
} // namespace aedst::network
