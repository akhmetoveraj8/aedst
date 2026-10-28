#include "Data/connect_auth_remote_data_source.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/testing/fake_http_server.hpp"
#include "aedst/testing/stub_token_provider.hpp"
#include "aedst/testing/test_main.hpp"

#include <QByteArray>

#include <gtest/gtest.h>

#include <memory>
#include <optional>
#include <string>

namespace aedst::feature::auth {
namespace {

using testing::FakeHttpServer;
using testing::FakeResponse;
using testing::waitUntil;

QByteArray loginResponseBytes(const std::string& userId, const std::string& accessToken) {
    authv1::LoginResponse response;
    response.set_user_id(userId);
    response.mutable_tokens()->set_access_token(accessToken);
    response.mutable_tokens()->set_refresh_token("refresh");
    response.mutable_tokens()->set_access_token_expires_in_seconds(900);
    return QByteArray::fromStdString(response.SerializeAsString());
}

class ConnectAuthRemoteDataSourceTest : public ::testing::Test {
protected:
    void SetUp() override {
        ASSERT_TRUE(server_.isListening());
        auto interceptor = std::make_shared<network::AuthInterceptor>(std::make_shared<testing::StubTokenProvider>());
        auto client = std::make_shared<network::ConnectClient>(
            network::ClientConfig{.baseUrl = server_.baseUrl(), .allowInsecureLoopback = true}, std::move(interceptor));
        dataSource_ = std::make_unique<ConnectAuthRemoteDataSource>(std::move(client));
    }

    FakeHttpServer server_;
    std::unique_ptr<ConnectAuthRemoteDataSource> dataSource_;
};

TEST_F(ConnectAuthRemoteDataSourceTest, LoginDecodesTheTokenPair) {
    server_.enqueue(FakeResponse::proto(loginResponseBytes("u1", "access")));
    std::optional<network::ApiResult<authv1::LoginResponse>> result;
    authv1::LoginRequest request;
    request.set_email("a@b.co");

    dataSource_->login(request, [&result](network::ApiResult<authv1::LoginResponse> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));

    ASSERT_TRUE(result->has_value());
    EXPECT_EQ((*result)->tokens().access_token(), "access");
    EXPECT_EQ(server_.requests().front().target, QByteArray("/aedst.auth.v1.AuthService/Login"));
}

TEST_F(ConnectAuthRemoteDataSourceTest, IncompleteLoginResponseIsADecodingError) {
    server_.enqueue(FakeResponse::proto(loginResponseBytes("u1", ""))); // no access token
    std::optional<network::ApiResult<authv1::LoginResponse>> result;

    dataSource_->login({}, [&result](network::ApiResult<authv1::LoginResponse> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));

    ASSERT_FALSE(result->has_value());
    EXPECT_EQ(result->error().kind, network::ApiErrorKind::Decoding);
}

TEST_F(ConnectAuthRemoteDataSourceTest, LogoutSucceedsOnAnEmptyResponse) {
    server_.enqueue(FakeResponse::proto(QByteArray()));
    std::optional<network::ApiResult<void>> result;
    authv1::LogoutRequest request;
    request.set_refresh_token("refresh");

    dataSource_->logout(request, [&result](network::ApiResult<void> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));

    EXPECT_TRUE(result->has_value());
}

TEST_F(ConnectAuthRemoteDataSourceTest, ServerRejectionKeepsTheConnectCode) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "revoked"));
    std::optional<network::ApiResult<authv1::RefreshTokenResponse>> result;

    dataSource_->refreshToken({},
                              [&result](network::ApiResult<authv1::RefreshTokenResponse> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));

    ASSERT_FALSE(result->has_value());
    EXPECT_EQ(result->error().kind, network::ApiErrorKind::Unauthenticated);
}

} // namespace
} // namespace aedst::feature::auth

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
