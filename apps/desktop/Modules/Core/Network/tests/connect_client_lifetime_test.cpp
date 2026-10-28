#include "connect_client_auth_test_support.hpp"

// Cancellation tied to a caller's lifetime and the guard that keeps a throwing completion from reaching the Qt
// event loop (split out of connect_client_auth_test.cpp). main() lives in connect_client_test.cpp (same binary).

namespace aedst::network {
namespace {

using namespace authtest;

// --- Cancellation tied to the caller ----------------------------------------------------------------

TEST_F(ClientAuthTest, DestroyingTheContextCancelsTheCallSilently) {
    server_.enqueue([] {
        FakeResponse response = FakeResponse::proto({});
        response.delay = 300ms;
        return response;
    }());
    auto owner = std::make_unique<QObject>();
    int completions = 0;

    auto handle = client_->unary(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, owner.get(),
                                 [&completions](ApiResult<authv1::GetCurrentUserResponse>) { ++completions; });
    ASSERT_TRUE(waitUntil([&] { return !server_.requests().empty(); }));
    EXPECT_TRUE(handle.isActive());

    owner.reset(); // the caller goes away while the request is in flight
    EXPECT_FALSE(handle.isActive());
    waitUntil([] { return false; }, 400ms);

    EXPECT_EQ(completions, 0) << "the completion of a destroyed caller must never run";
}

TEST_F(ClientAuthTest, ContextBoundCallsStillCompleteNormallyWhileTheContextLives) {
    server_.enqueue(FakeResponse::proto(userResponse()));
    QObject owner;
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    client_->unary(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, &owner,
                   [&out](ApiResult<authv1::GetCurrentUserResponse> result) { out = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    EXPECT_TRUE(out->has_value());
}

TEST_F(ClientAuthTest, CallScopeCancelsEverythingItHoldsWhenDestroyed) {
    FakeResponse slow = FakeResponse::proto(userResponse());
    slow.delay = 300ms;
    server_.enqueue(slow);
    server_.enqueue(slow);
    int completions = 0;
    {
        CallScope scope;
        for (int i = 0; i < 2; ++i) {
            scope.add(client_->unary(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{},
                                     [&completions](ApiResult<authv1::GetCurrentUserResponse>) { ++completions; }));
        }
        EXPECT_EQ(scope.activeCount(), 2U);
        ASSERT_TRUE(waitUntil([&] { return server_.requests().size() == 2U; }));
    }
    waitUntil([] { return false; }, 400ms);

    EXPECT_EQ(completions, 0);
}

// --- Destroying the client ends what is still in flight ---------------------------------------------------------

TEST_F(ClientAuthTest, DestroyingTheClientCompletesInFlightCallsWithCancelled) {
    FakeResponse slow = FakeResponse::proto(userResponse());
    slow.delay = 500ms;
    server_.enqueue(slow);
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;
    int completions = 0;

    client_->unary(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{},
                   [&out, &completions](ApiResult<authv1::GetCurrentUserResponse> result) {
                       out = std::move(result);
                       ++completions;
                   });
    ASSERT_TRUE(waitUntil([&] { return !server_.requests().empty(); }));

    client_.reset(); // the request is on the wire

    ASSERT_TRUE(out.has_value()) << "an in-flight call must be completed, not silently dropped";
    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Cancelled);
    EXPECT_EQ(completions, 1);
}

// --- A response larger than the limit is aborted instead of buffered ----------------------------------------------

TEST_F(ClientAuthTest, AnOversizedResponseIsAbortedAndFailsAsDecoding) {
    client_ = std::make_unique<ConnectClient>(ClientConfig{.baseUrl = server_.baseUrl(),
                                                           .defaultTimeout = 2s,
                                                           .retry = RetryPolicy::none(),
                                                           .allowInsecureLoopback = true,
                                                           .maxResponseBytes = 1024},
                                              interceptor_);
    server_.enqueue(FakeResponse::proto(QByteArray(64 * 1024, 'x')));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Decoding);
}

TEST_F(ClientAuthTest, AResponseWithinTheLimitIsUnaffected) {
    client_ = std::make_unique<ConnectClient>(ClientConfig{.baseUrl = server_.baseUrl(),
                                                           .defaultTimeout = 2s,
                                                           .retry = RetryPolicy::none(),
                                                           .allowInsecureLoopback = true,
                                                           .maxResponseBytes = 1024},
                                              interceptor_);
    server_.enqueue(FakeResponse::proto(userResponse()));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    EXPECT_TRUE(out->has_value());
}

// --- Exceptions never reach the event loop -------------------------------------------------------------

TEST_F(ClientAuthTest, AThrowingCompletionIsContainedAndLaterCallsStillWork) {
    server_.enqueue(FakeResponse::proto(userResponse()));
    server_.enqueue(FakeResponse::proto(userResponse()));
    bool threw = false;
    client_->unary(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{},
                   [&threw](ApiResult<authv1::GetCurrentUserResponse>) {
                       threw = true;
                       throw std::runtime_error("boom");
                   });
    ASSERT_TRUE(waitUntil([&] { return threw; }));

    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;
    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));
    EXPECT_TRUE(out->has_value());
}

TEST_F(ClientAuthTest, AThrowingStreamHandlerEndsTheStreamWithoutCrashing) {
    server_.enqueue(FakeResponse::connectStream(
        {envelope::encode(0, loginResponse("m1")) + envelope::encode(envelope::kFlagEndStream, "{}")}));
    std::optional<ApiResult<void>> done;

    client_->serverStream(
        kStream, authv1::LoginRequest{}, [](authv1::LoginResponse) { throw std::runtime_error("handler failed"); },
        [&done](ApiResult<void> result) { done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return done.has_value(); }));
    SUCCEED(); // reaching this line means the exception did not terminate the process
}

} // namespace
} // namespace aedst::network
