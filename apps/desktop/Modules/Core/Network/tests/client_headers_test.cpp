#include "aedst/network/client_identification.hpp"
#include "connect_client_test_support.hpp"

#include <gtest/gtest.h>

#include <memory>
#include <string>
#include <utility>

// X-Aedst-Client (ADR-0009) and Idempotency-Key on the wire, through the real ConnectClient against the loopback
// fake server. The cross-platform fixture replay is client_version_gate_test.cpp.

namespace aedst::network {
namespace {

using namespace testsupport;

class ClientHeadersTest : public ConnectClientTest {
protected:
    void useClientIdentifier(std::string identifier) {
        client_ = std::make_unique<ConnectClient>(ClientConfig{.baseUrl = server_.baseUrl(),
                                                               .defaultTimeout = 2s,
                                                               .retry = fastRetry(),
                                                               .allowInsecureLoopback = true,
                                                               .clientIdentifier = std::move(identifier)},
                                                  interceptor_);
    }
};

TEST(ClientIdentificationTest, FormatsPlatformSlashSemver) {
    EXPECT_EQ(makeClientIdentifier("1.4.2"), "desktop/1.4.2");
    EXPECT_EQ(makeClientIdentifier("v1.4.2"), "desktop/1.4.2");
    EXPECT_EQ(makeClientIdentifier("2.0.0-rc.1+build.5"), "desktop/2.0.0-rc.1+build.5");
}

TEST(ClientIdentificationTest, OmitsTheHeaderForAnythingThatIsNotSemver) {
    for (const char* version : {"", "1", "1.2", "1.2.3.4", "1.2.x", "a.b.c", "1.2.3-", "latest"}) {
        EXPECT_TRUE(makeClientIdentifier(version).empty()) << version;
    }
}

TEST_F(ClientHeadersTest, EveryRequestCarriesTheClientHeaderWhenConfigured) {
    useClientIdentifier(makeClientIdentifier("1.4.2"));
    server_.enqueue(FakeResponse::proto(currentUserResponseBytes()));
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    Outcome<authv1::GetCurrentUserResponse> authenticated;
    Outcome<authv1::LoginResponse> publicCall;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, authenticated);
    ASSERT_TRUE(waitUntil([&] { return authenticated.done(); }));
    call(contract::kAuthLogin, loginRequest(), publicCall);
    ASSERT_TRUE(waitUntil([&] { return publicCall.done(); }));

    ASSERT_EQ(server_.requests().size(), 2U);
    EXPECT_EQ(server_.requests()[0].headers.value("x-aedst-client"), QByteArray("desktop/1.4.2"));
    EXPECT_EQ(server_.requests()[1].headers.value("x-aedst-client"), QByteArray("desktop/1.4.2"));
}

TEST_F(ClientHeadersTest, NoClientHeaderWithoutAConfiguredIdentifier) {
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    EXPECT_FALSE(server_.requests().front().headers.contains("x-aedst-client"));
}

TEST_F(ClientHeadersTest, TheIdempotencyKeyIsSentOnEveryAttemptOfARetriedCall) {
    server_.enqueue(FakeResponse::connectError(503, "unavailable", "try later"));
    server_.enqueue(FakeResponse::proto(currentUserResponseBytes()));
    Outcome<authv1::GetCurrentUserResponse> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out,
         CallOptions{.idempotencyKey = "item-0001"});
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_TRUE(out.result->has_value());
    ASSERT_EQ(server_.requests().size(), 2U);
    EXPECT_EQ(server_.requests()[0].headers.value("idempotency-key"), QByteArray("item-0001"));
    EXPECT_EQ(server_.requests()[1].headers.value("idempotency-key"), QByteArray("item-0001"));
}

TEST_F(ClientHeadersTest, NoIdempotencyKeyHeaderByDefault) {
    server_.enqueue(FakeResponse::proto(loginResponseBytes()));
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out);
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    EXPECT_FALSE(server_.requests().front().headers.contains("idempotency-key"));
}

TEST_F(ClientHeadersTest, AnInvalidIdempotencyKeyFailsTheCallWithoutSendingAnything) {
    Outcome<authv1::LoginResponse> out;

    call(contract::kAuthLogin, loginRequest(), out, CallOptions{.idempotencyKey = "has space"});
    ASSERT_TRUE(waitUntil([&] { return out.done(); }));

    ASSERT_FALSE(out.result->has_value());
    EXPECT_EQ(out.result->error().kind, ApiErrorKind::InvalidArgument);
    EXPECT_TRUE(server_.requests().empty());
}

TEST(IdempotencyKeyTest, AcceptsOnlyOneToHundredTwentyEightPrintableAsciiCharacters) {
    EXPECT_TRUE(isValidIdempotencyKey("3f2c1a9e-7b0d-4c55-9a51-0f4c2e8b6d11"));
    EXPECT_TRUE(isValidIdempotencyKey(std::string(128, 'a')));
    EXPECT_FALSE(isValidIdempotencyKey(""));
    EXPECT_FALSE(isValidIdempotencyKey(std::string(129, 'a')));
    EXPECT_FALSE(isValidIdempotencyKey("with space"));
    EXPECT_FALSE(isValidIdempotencyKey("tab\there"));
    EXPECT_FALSE(isValidIdempotencyKey("caf\xC3\xA9"));
}

} // namespace
} // namespace aedst::network
