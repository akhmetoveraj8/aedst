#pragma once

// Shared fixtures for the ConnectClient end-to-end tests (connect_client_test.cpp,
// connect_client_stream_test.cpp): a real QNetworkAccessManager against the loopback
// FakeHttpServer, with the real generated messages from Aedst::Contract.

#include "aedst/contract/methods.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/network/connect_envelope.hpp"
#include "aedst/testing/fake_http_server.hpp"
#include "aedst/testing/stub_token_provider.hpp"

#include <QByteArray>
#include <QString>
#include <QUrl>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace aedst::network::testsupport {

using namespace std::chrono_literals;
namespace authv1 = ::aedst::auth::v1;
using ::aedst::testing::FakeHttpServer;
using ::aedst::testing::FakeResponse;
using ::aedst::testing::waitUntil;

inline QByteArray serialized(const google::protobuf::MessageLite& message) {
    return QByteArray::fromStdString(message.SerializeAsString());
}

inline authv1::LoginRequest loginRequest() {
    authv1::LoginRequest request;
    request.set_email("a@b.co");
    request.set_password("x");
    request.set_device_id("d");
    return request;
}

inline QByteArray loginResponseBytes(const std::string& userId = "u1") {
    authv1::LoginResponse response;
    response.set_user_id(userId);
    response.mutable_tokens()->set_access_token("access");
    response.mutable_tokens()->set_refresh_token("refresh");
    response.mutable_tokens()->set_access_token_expires_in_seconds(900);
    return serialized(response);
}

inline QByteArray currentUserResponseBytes() {
    authv1::GetCurrentUserResponse response;
    response.mutable_user()->set_id("u1");
    response.mutable_user()->set_email("a@b.co");
    return serialized(response);
}

inline RetryPolicy fastRetry() {
    return RetryPolicy{.maxAttempts = 3, .initialBackoff = 1ms, .maxBackoff = 2ms, .multiplier = 2.0};
}

class ConnectClientTest : public ::testing::Test {
protected:
    void SetUp() override {
        ASSERT_TRUE(server_.isListening());
        client_ = std::make_unique<ConnectClient>(
            ClientConfig{.baseUrl = server_.baseUrl(),
                         .defaultTimeout = 2s,
                         .retry = fastRetry(),
                         .allowInsecureLoopback = true}, // the fake server is plain http on loopback
            interceptor_);
    }

    template <typename Res>
    struct Outcome {
        std::optional<ApiResult<Res>> result;
        int completions{0};

        bool done() const { return result.has_value(); }
    };

    template <typename Req, typename Res>
    CallHandle call(const Method<Req, Res>& method, const Req& request, Outcome<Res>& out,
                    const CallOptions& options = {}) {
        return client_->unary(
            method, request,
            [&out](ApiResult<Res> result) {
                out.result = std::move(result);
                ++out.completions;
            },
            options);
    }

    FakeHttpServer server_;
    std::shared_ptr<testing::StubTokenProvider> tokens_ = std::make_shared<testing::StubTokenProvider>("tok");
    std::shared_ptr<AuthInterceptor> interceptor_ = std::make_shared<AuthInterceptor>(tokens_);
    std::unique_ptr<ConnectClient> client_;
};

inline constexpr auto kStreamMethod =
    makeMethod<authv1::LoginRequest, authv1::LoginResponse>("/test.v1.Stream/Watch", AuthRequirement::Required);

struct StreamOutcome {
    std::vector<std::string> userIds;
    std::optional<ApiResult<void>> done;
};

} // namespace aedst::network::testsupport
