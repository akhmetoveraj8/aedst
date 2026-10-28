#pragma once

// Fixtures for the ConnectClient token-refresh / lifetime tests (connect_client_auth_test.cpp and
// connect_client_lifetime_test.cpp): a scripted TokenProvider + TokenRefresher and the loopback fake server.

#include "aedst/contract/methods.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/network/connect_envelope.hpp"
#include "aedst/testing/fake_http_server.hpp"

#include <QByteArray>
#include <QObject>
#include <QPointer>
#include <QTimer>

#include <gtest/gtest.h>

#include <chrono>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace aedst::network::authtest {

using namespace std::chrono_literals;
namespace authv1 = ::aedst::auth::v1;
using ::aedst::testing::FakeHttpServer;
using ::aedst::testing::FakeResponse;
using ::aedst::testing::waitUntil;

inline QByteArray userResponse() {
    authv1::GetCurrentUserResponse response;
    response.mutable_user()->set_id("u1");
    return QByteArray::fromStdString(response.SerializeAsString());
}

inline QByteArray loginResponse(const std::string& userId) {
    authv1::LoginResponse response;
    response.set_user_id(userId);
    return QByteArray::fromStdString(response.SerializeAsString());
}

inline constexpr auto kStream =
    makeMethod<authv1::LoginRequest, authv1::LoginResponse>("/test.v1.Stream/Watch", AuthRequirement::Required);

/// Token source + refresher with scripted behaviour; completions may be delayed to model a network refresh.
class FakeSession final : public TokenProvider, public TokenRefresher {
public:
    [[nodiscard]] std::optional<std::string> accessToken() const override { return token; }

    void ensureFreshAccessToken(core::Completion<std::string> done) override {
        ++ensureCalls;
        if (ensureError) {
            deliver(std::move(done), core::fail(*ensureError));
            return;
        }
        deliver(std::move(done), token.value_or(std::string{}));
    }

    void refreshAfterRejection(const std::string& rejectedToken, core::Completion<std::string> done) override {
        ++rejectionCalls;
        lastRejected = rejectedToken;
        if (refreshError) {
            deliver(std::move(done), core::fail(*refreshError));
            return;
        }
        token = nextToken;
        deliver(std::move(done), *token);
    }

    std::optional<std::string> token{"old"};
    std::string nextToken{"new"};
    std::optional<core::Error> ensureError;
    std::optional<core::Error> refreshError;
    std::chrono::milliseconds refreshDelay{0};
    int ensureCalls{0};
    int rejectionCalls{0};
    std::string lastRejected;

private:
    void deliver(core::Completion<std::string> done, core::Outcome<std::string> result) const {
        if (refreshDelay.count() <= 0) {
            done(std::move(result));
            return;
        }
        QTimer::singleShot(refreshDelay,
                           [done = std::move(done), result = std::move(result)]() mutable { done(std::move(result)); });
    }
};

class ClientAuthTest : public ::testing::Test {
protected:
    void SetUp() override {
        ASSERT_TRUE(server_.isListening());
        interceptor_ = std::make_shared<AuthInterceptor>(session_, session_);
        client_ = std::make_unique<ConnectClient>(
            ClientConfig{.baseUrl = server_.baseUrl(),
                         .defaultTimeout = 2s,
                         .retry = RetryPolicy{.maxAttempts = 3, .initialBackoff = 1ms, .maxBackoff = 2ms},
                         .allowInsecureLoopback = true},
            interceptor_);
    }

    template <typename Req, typename Res>
    CallHandle call(const Method<Req, Res>& method, const Req& request, std::optional<ApiResult<Res>>& out) {
        return client_->unary(method, request, [&out](ApiResult<Res> result) { out = std::move(result); });
    }

    void tasksOk() {
        ::aedst::tasks::v1::CreateTaskResponse response;
        server_.enqueue(FakeResponse::proto(QByteArray::fromStdString(response.SerializeAsString())));
    }

    [[nodiscard]] QByteArray bearer(std::size_t index) const {
        return server_.requests().at(index).headers.value("authorization");
    }

    FakeHttpServer server_;
    std::shared_ptr<FakeSession> session_ = std::make_shared<FakeSession>();
    std::shared_ptr<AuthInterceptor> interceptor_;
    std::unique_ptr<ConnectClient> client_;
};

} // namespace aedst::network::authtest
