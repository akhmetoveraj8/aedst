#include "aedst/contract/methods.hpp"
#include "aedst/core/correlation.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/network/connect_envelope.hpp"
#include "aedst/testing/fake_http_server.hpp"
#include "aedst/testing/stub_token_provider.hpp"
#include "aedst/testing/test_main.hpp"
#include "connect_client_test_support.hpp"

#include <QByteArray>
#include <QSslSocket>
#include <QString>
#include <QUrl>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <vector>

// End-to-end tests of ConnectClient: real QNetworkAccessManager against the
// loopback FakeHttpServer, with the real generated messages from Aedst::Contract.
// Fixtures: connect_client_test_support.hpp. Streaming/correlation tests: connect_client_stream_test.cpp.

namespace aedst::network {
namespace {

using namespace testsupport;

TEST_F(ConnectClientTest, UnarySendsTheConnectWireFormatAndDecodesTheResponse) {
    server_.enqueue(FakeResponse::proto(loginResponseBytes("user-42")));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_TRUE(out.result->has_value());
    EXPECT_EQ((*out.result)->user_id(), "user-42");
    EXPECT_EQ((*out.result)->tokens().access_token_expires_in_seconds(), 900);

    ASSERT_EQ(server_.requests().size(), 1U);
    const auto& request = server_.requests().front();
    EXPECT_EQ(request.method, QByteArray("POST"));
    EXPECT_EQ(request.target, QByteArray("/aedst.auth.v1.AuthService/Login"));
    EXPECT_EQ(request.headers.value("content-type"), QByteArray("application/proto"));
    EXPECT_EQ(request.headers.value("connect-protocol-version"), QByteArray("1"));
    EXPECT_EQ(request.headers.value("connect-timeout-ms"), QByteArray("2000"));
    // Golden bytes: email=1, password=2, device_id=3, all length-delimited strings.
    EXPECT_EQ(request.body, QByteArray::fromHex("0a06"
                                                "6140622e636f"
                                                "1201"
                                                "78"
                                                "1a01"
                                                "64"));
}

TEST_F(ConnectClientTest, BearerTokenIsSentOnlyToAuthenticatedMethods) {
    server_.enqueue(FakeResponse::proto(currentUserResponseBytes()));
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    Outcome<authv1::GetCurrentUserResponse> me;
    Outcome<authv1::LoginResponse> login;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, me);
    ASSERT_TRUE(waitUntil([&] { return me.done(); }));
    call(contract::kAuthLogin, loginRequest(), login);
    ASSERT_TRUE(waitUntil([&] { return login.done(); }));

    ASSERT_EQ(server_.requests().size(), 2U);
    EXPECT_EQ(server_.requests()[0].headers.value("authorization"), QByteArray("Bearer tok"));
    EXPECT_FALSE(server_.requests()[1].headers.contains("authorization"));
}

TEST_F(ConnectClientTest, ConnectErrorBodyBecomesATypedError) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "invalid credentials"));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    const ApiError& error = out.result->error();
    EXPECT_EQ(error.kind, ApiErrorKind::Unauthenticated);
    EXPECT_EQ(error.connectCode, "unauthenticated");
    EXPECT_EQ(error.message, "invalid credentials");
    EXPECT_EQ(error.httpStatus, 401);
}

TEST_F(ConnectClientTest, IdempotentCallsRetryTransientFailuresWithBackoff) {
    server_.enqueue(FakeResponse::connectError(503, "unavailable", "warming up"));
    server_.enqueue(FakeResponse::dropped());
    server_.enqueue(FakeResponse::proto(currentUserResponseBytes()));
    Outcome<authv1::GetCurrentUserResponse> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_TRUE(out.result->has_value());
    EXPECT_EQ((*out.result)->user().id(), "u1");
    EXPECT_EQ(server_.requests().size(), 3U);
    EXPECT_EQ(out.completions, 1);
}

TEST_F(ConnectClientTest, RetriesStopAtMaxAttemptsAndReportTheLastError) {
    for (int i = 0; i < 5; ++i) {
        server_.enqueue(FakeResponse::connectError(503, "unavailable", "still down"));
    }
    Outcome<authv1::GetCurrentUserResponse> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::Unavailable);
    EXPECT_EQ(server_.requests().size(), 3U);
}

TEST_F(ConnectClientTest, NonIdempotentCallsAreNeverRetried) {
    server_.enqueue(FakeResponse::connectError(503, "unavailable", "down"));
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(server_.requests().size(), 1U);
}

TEST_F(ConnectClientTest, NonTransientErrorsAreNotRetriedEvenWhenIdempotent) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "expired"));
    server_.enqueue(FakeResponse::proto(currentUserResponseBytes()));
    Outcome<authv1::GetCurrentUserResponse> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::Unauthenticated);
    EXPECT_EQ(server_.requests().size(), 1U);
}

TEST_F(ConnectClientTest, ConnectionDropIsATransportError) {
    server_.enqueue(FakeResponse::dropped());
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::Transport);
}

TEST_F(ConnectClientTest, DeadlineExpiryIsATimeout) {
    FakeResponse slow = FakeResponse::proto(loginResponseBytes());
    slow.delay = 400ms;
    server_.enqueue(std::move(slow));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out, CallOptions{.timeout = 50ms});
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::Timeout);
}

TEST_F(ConnectClientTest, CancelCompletesOnceWithCancelled) {
    FakeResponse slow = FakeResponse::proto(loginResponseBytes());
    slow.delay = 400ms;
    server_.enqueue(std::move(slow));
    Outcome<authv1::LoginResponse> out;

    const CallHandle handle = call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return !server_.requests().empty(); }));
    EXPECT_TRUE(handle.isActive());
    handle.cancel();

    ASSERT_TRUE(waitUntil([&] { return out.done(); }));
    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::Cancelled);
    EXPECT_FALSE(handle.isActive());
    // Let the late server response arrive; it must not complete the call again.
    waitUntil([] { return false; }, 500ms);
    EXPECT_EQ(out.completions, 1);
}

TEST_F(ConnectClientTest, ANonProtobufSuccessResponseIsRejected) {
    FakeResponse portal;
    portal.contentType = "text/html";
    portal.body = "<html>captive portal</html>";
    server_.enqueue(std::move(portal));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::Decoding);
}

TEST_F(ConnectClientTest, MalformedProtobufIsADecodingError) {
    server_.enqueue(FakeResponse::proto(QByteArray::fromHex("ffffff")));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::Decoding);
}

// --- Transport policy: a client with an unacceptable endpoint sends nothing ------

struct RejectedEndpoint {
    const char* name;
    QUrl url;
    bool allowInsecureLoopback;
};

class InsecureEndpointClientTest : public ::testing::TestWithParam<RejectedEndpoint> {
protected:
    ClientConfig config() const {
        return ClientConfig{.baseUrl = GetParam().url,
                            .defaultTimeout = 2s,
                            .retry = fastRetry(),
                            .allowInsecureLoopback = GetParam().allowInsecureLoopback};
    }

    std::shared_ptr<testing::StubTokenProvider> tokens_ = std::make_shared<testing::StubTokenProvider>("tok");
    std::shared_ptr<AuthInterceptor> interceptor_ = std::make_shared<AuthInterceptor>(tokens_);
};

TEST_P(InsecureEndpointClientTest, ValidateClientConfigRejectsIt) {
    const auto result = validateClientConfig(config());

    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().kind, ApiErrorKind::InvalidArgument);
}

TEST_P(InsecureEndpointClientTest, EveryUnaryCallFailsAsynchronouslyWithTheConfigError) {
    ConnectClient client(config(), interceptor_);
    ASSERT_TRUE(client.configError().has_value());
    std::optional<ApiResult<authv1::LoginResponse>> result;
    int completions = 0;

    for (int i = 0; i < 2; ++i) {
        result.reset();
        client.unary(contract::kAuthLogin, loginRequest(), [&](ApiResult<authv1::LoginResponse> value) {
            result = std::move(value);
            ++completions;
        });
        EXPECT_FALSE(result.has_value()) << "completion must be asynchronous";
        ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));
        ASSERT_FALSE(result->has_value());
        EXPECT_EQ(result->error(), *client.configError());
        EXPECT_FALSE(result->error().isRetryable());
    }
    EXPECT_EQ(completions, 2);
}

TEST_P(InsecureEndpointClientTest, ServerStreamsFailWithTheConfigErrorToo) {
    ConnectClient client(config(), interceptor_);
    StreamOutcome out;

    client.serverStream(
        kStreamMethod, loginRequest(), [](authv1::LoginResponse) {},
        [&out](ApiResult<void> result) { out.done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return out.done.has_value(); }));

    ASSERT_FALSE(out.done->has_value());
    EXPECT_EQ(out.done->error(), *client.configError());
}

INSTANTIATE_TEST_SUITE_P(
    Endpoints, InsecureEndpointClientTest,
    ::testing::Values(
        RejectedEndpoint{"PlainHttpRemoteEvenWithOptIn", QUrl(QStringLiteral("http://api.example.com")), true},
        RejectedEndpoint{"PlainHttpRemoteInRelease", QUrl(QStringLiteral("http://api.example.com")), false},
        RejectedEndpoint{"PlainHttpLoopbackWithoutOptIn", QUrl(QStringLiteral("http://127.0.0.1:8080")), false},
        RejectedEndpoint{"CredentialsInUrl", QUrl(QStringLiteral("https://u:p@api.example.com")), true},
        RejectedEndpoint{"UnsupportedScheme", QUrl(QStringLiteral("ftp://api.example.com")), true}),
    [](const ::testing::TestParamInfo<RejectedEndpoint>& info) { return std::string(info.param.name); });

TEST(ClientConfigValidationTest, RejectsMalformedPinsAndBadExtraCaButAcceptsAWellFormedHttpsConfig) {
    if (!QSslSocket::supportsSsl()) {
        GTEST_SKIP() << "Qt build has no TLS backend";
    }
    ClientConfig config{.baseUrl = QUrl(QStringLiteral("https://api.example.com"))};
    EXPECT_TRUE(validateClientConfig(config).has_value());

    config.pinnedSpkiSha256 = {"not base64!"};
    EXPECT_FALSE(validateClientConfig(config).has_value());
    config.pinnedSpkiSha256 = {"AAAA"}; // valid base64, but 3 bytes, not a SHA-256 digest
    EXPECT_FALSE(validateClientConfig(config).has_value());
    config.pinnedSpkiSha256 = {QByteArray(32, 'x').toBase64().toStdString()};
    EXPECT_TRUE(validateClientConfig(config).has_value());

    config.extraCaCertificatesPem = "-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----\n";
    EXPECT_FALSE(validateClientConfig(config).has_value());
}

} // namespace
} // namespace aedst::network

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
