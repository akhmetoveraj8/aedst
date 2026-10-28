#include "aedst/core/correlation.hpp"
#include "connect_client_test_support.hpp"

#include <gtest/gtest.h>

// Server-streaming and correlation-id tests of ConnectClient (split out of connect_client_test.cpp).
// main() lives in connect_client_test.cpp (same binary).

namespace aedst::network {
namespace {

using namespace testsupport;

TEST_F(ConnectClientTest, ServerStreamDeliversMessagesAcrossArbitraryChunkBoundaries) {
    const QByteArray wire = envelope::encode(0, loginResponseBytes("m1")) +
                            envelope::encode(0, loginResponseBytes("m2")) +
                            envelope::encode(envelope::kFlagEndStream, "{}");
    server_.enqueue(FakeResponse::connectStream({wire.left(3), wire.mid(3, 20), wire.mid(23)}));
    StreamOutcome out;

    client_->serverStream(
        kStreamMethod, loginRequest(),
        [&out](authv1::LoginResponse message) { out.userIds.push_back(message.user_id()); },
        [&out](ApiResult<void> result) { out.done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return out.done.has_value(); }));

    EXPECT_TRUE(out.done->has_value());
    EXPECT_EQ(out.userIds, (std::vector<std::string>{"m1", "m2"}));
    ASSERT_EQ(server_.requests().size(), 1U);
    const auto& request = server_.requests().front();
    EXPECT_EQ(request.headers.value("content-type"), QByteArray("application/connect+proto"));
    EXPECT_EQ(request.body, envelope::encode(0, serialized(loginRequest())));
}

TEST_F(ConnectClientTest, ServerStreamSurfacesAnErrorInTheEndOfStreamFrame) {
    const QByteArray wire =
        envelope::encode(0, loginResponseBytes("m1")) +
        envelope::encode(envelope::kFlagEndStream, R"({"error":{"code":"unavailable","message":"draining"}})");
    server_.enqueue(FakeResponse::connectStream({wire}));
    StreamOutcome out;

    client_->serverStream(
        kStreamMethod, loginRequest(),
        [&out](authv1::LoginResponse message) { out.userIds.push_back(message.user_id()); },
        [&out](ApiResult<void> result) { out.done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return out.done.has_value(); }));

    ASSERT_FALSE(out.done->has_value());
    EXPECT_EQ(out.done->error().kind, ApiErrorKind::Unavailable);
    EXPECT_EQ(out.done->error().message, "draining");
    EXPECT_EQ(out.userIds.size(), 1U);
}

TEST_F(ConnectClientTest, ServerStreamCutBeforeEndOfStreamIsATransportError) {
    server_.enqueue(FakeResponse::connectStream({envelope::encode(0, loginResponseBytes("m1"))}));
    StreamOutcome out;

    client_->serverStream(
        kStreamMethod, loginRequest(),
        [&out](authv1::LoginResponse message) { out.userIds.push_back(message.user_id()); },
        [&out](ApiResult<void> result) { out.done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return out.done.has_value(); }));

    ASSERT_FALSE(out.done->has_value());
    EXPECT_EQ(out.done->error().kind, ApiErrorKind::Transport);
}

TEST_F(ConnectClientTest, ServerStreamHttpErrorUsesTheUnaryErrorBody) {
    server_.enqueue(FakeResponse::connectError(403, "permission_denied", "nope"));
    StreamOutcome out;

    client_->serverStream(
        kStreamMethod, loginRequest(), [](authv1::LoginResponse) {},
        [&out](ApiResult<void> result) { out.done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return out.done.has_value(); }));

    ASSERT_FALSE(out.done->has_value());
    EXPECT_EQ(out.done->error().kind, ApiErrorKind::PermissionDenied);
}

TEST_F(ConnectClientTest, EveryCallCarriesAValidCorrelationIdAndItDiffersPerCall) {
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    Outcome<authv1::LoginResponse> first;
    Outcome<authv1::LoginResponse> second;

    call(contract::kAuthLogin, loginRequest(), first);
    ASSERT_TRUE(waitUntil([&] { return first.done(); }));
    call(contract::kAuthLogin, loginRequest(), second);
    ASSERT_TRUE(waitUntil([&] { return second.done(); }));

    ASSERT_EQ(server_.requests().size(), 2U);
    const QByteArray id1 = server_.requests()[0].headers.value("x-correlation-id");
    const QByteArray id2 = server_.requests()[1].headers.value("x-correlation-id");
    EXPECT_EQ(id1.size(), 16);
    EXPECT_TRUE(core::isValidCorrelationId(id1.toStdString()));
    EXPECT_TRUE(core::isValidCorrelationId(id2.toStdString()));
    EXPECT_NE(id1, id2);
}

TEST_F(ConnectClientTest, ARetriedCallKeepsItsCorrelationId) {
    server_.enqueue(FakeResponse::connectError(503, "unavailable", "try later"));
    server_.enqueue(FakeResponse::proto(currentUserResponseBytes()));
    Outcome<authv1::GetCurrentUserResponse> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_EQ(server_.requests().size(), 2U);
    const QByteArray first = server_.requests()[0].headers.value("x-correlation-id");
    EXPECT_FALSE(first.isEmpty());
    EXPECT_EQ(server_.requests()[1].headers.value("x-correlation-id"), first);
}

TEST_F(ConnectClientTest, ACallerCorrelationScopeIsPropagatedToTheServer) {
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    Outcome<authv1::LoginResponse> out;

    {
        const core::CorrelationScope scope("flow-123");
        call(contract::kAuthLogin, loginRequest(), out);
    }
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_EQ(server_.requests().size(), 1U);
    EXPECT_EQ(server_.requests().front().headers.value("x-correlation-id"), QByteArray("flow-123"));
}

} // namespace
} // namespace aedst::network
