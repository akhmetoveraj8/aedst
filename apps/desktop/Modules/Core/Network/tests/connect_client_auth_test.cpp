#include "connect_client_auth_test_support.hpp"

// Token refresh inside ConnectClient (pre-flight and once after `unauthenticated`) and refreshed streams.
// Lifetime/cancellation tests: connect_client_lifetime_test.cpp. main() lives in connect_client_test.cpp (same binary).

namespace aedst::network {
namespace {

using namespace authtest;

// --- Pre-flight refresh ----------------------------------------------------------------------

TEST_F(ClientAuthTest, AuthenticatedCallsAskTheRefresherFirstAndSendTheFreshToken) {
    session_->token = "fresh";
    server_.enqueue(FakeResponse::proto(userResponse()));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_TRUE(out->has_value());
    EXPECT_EQ(session_->ensureCalls, 1);
    EXPECT_EQ(bearer(0), QByteArray("Bearer fresh"));
}

TEST_F(ClientAuthTest, PublicCallsNeverTouchTheRefresher) {
    server_.enqueue(FakeResponse::proto(loginResponse("u")));
    std::optional<ApiResult<authv1::LoginResponse>> out;

    call(contract::kAuthLogin, authv1::LoginRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    EXPECT_EQ(session_->ensureCalls, 0);
    EXPECT_FALSE(server_.requests().front().headers.contains("authorization"));
}

TEST_F(ClientAuthTest, AnEndedSessionFailsTheCallAsynchronouslyWithoutSendingAnything) {
    session_->ensureError = core::Error::unauthenticated("Not signed in");
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    EXPECT_FALSE(out.has_value()) << "completion must be asynchronous";
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Unauthenticated);
    EXPECT_TRUE(server_.requests().empty());
}

TEST_F(ClientAuthTest, ATransientRefreshFailureStillSendsTheCurrentToken) {
    session_->ensureError = core::Error::unavailable("offline");
    server_.enqueue(FakeResponse::proto(userResponse()));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_TRUE(out->has_value());
    EXPECT_EQ(bearer(0), QByteArray("Bearer old"));
}

TEST_F(ClientAuthTest, ADelayedPreflightRefreshHoldsTheRequestBack) {
    session_->refreshDelay = 80ms;
    server_.enqueue(FakeResponse::proto(userResponse()));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    waitUntil([] { return false; }, 20ms);
    EXPECT_TRUE(server_.requests().empty());

    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));
    EXPECT_TRUE(out->has_value());
}

// --- Refresh after a rejection ----------------------------------------------------------------

TEST_F(ClientAuthTest, UnauthenticatedResponseRefreshesOnceAndReplaysTheCall) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "token expired"));
    server_.enqueue(FakeResponse::proto(userResponse()));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_TRUE(out->has_value());
    EXPECT_EQ(session_->rejectionCalls, 1);
    EXPECT_EQ(session_->lastRejected, "old");
    ASSERT_EQ(server_.requests().size(), 2U);
    EXPECT_EQ(bearer(0), QByteArray("Bearer old"));
    EXPECT_EQ(bearer(1), QByteArray("Bearer new"));
}

TEST_F(ClientAuthTest, NonIdempotentCallsAreReplayedAfterARejectionToo) {
    // The rejected request never reached the handler, so replaying a CreateTask cannot duplicate it.
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "token expired"));
    tasksOk();
    std::optional<ApiResult<::aedst::tasks::v1::CreateTaskResponse>> out;

    call(contract::kTasksCreateTask, ::aedst::tasks::v1::CreateTaskRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    EXPECT_TRUE(out->has_value());
    EXPECT_EQ(server_.requests().size(), 2U);
    EXPECT_EQ(session_->rejectionCalls, 1);
}

TEST_F(ClientAuthTest, ASecondRejectionIsFinal) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "no"));
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "still no"));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Unauthenticated);
    EXPECT_EQ(session_->rejectionCalls, 1) << "one refresh per call, never a loop";
    EXPECT_EQ(server_.requests().size(), 2U);
}

TEST_F(ClientAuthTest, ARefreshTokenThatIsRejectedEndsTheCallAsUnauthenticated) {
    session_->refreshError = core::Error::unauthenticated("refresh token revoked");
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "no"));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Unauthenticated);
    EXPECT_EQ(server_.requests().size(), 1U);
}

TEST_F(ClientAuthTest, AFailedRefreshDueToTheNetworkIsNotReportedAsASignOut) {
    session_->refreshError = core::Error::unavailable("offline");
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "no"));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Transport) << "Unauthenticated here would sign the user out offline";
    EXPECT_TRUE(out->error().isRetryable());
}

TEST_F(ClientAuthTest, PublicCallsAreNeverRefreshedOrReplayed) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "invalid credentials"));
    std::optional<ApiResult<authv1::LoginResponse>> out;

    call(contract::kAuthLogin, authv1::LoginRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(session_->rejectionCalls, 0);
    EXPECT_EQ(server_.requests().size(), 1U);
}

TEST_F(ClientAuthTest, TheRefreshReplayDoesNotConsumeTheRetryBudget) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "expired"));
    server_.enqueue(FakeResponse::connectError(503, "unavailable", "busy"));
    server_.enqueue(FakeResponse::connectError(503, "unavailable", "busy"));
    server_.enqueue(FakeResponse::proto(userResponse()));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;

    call(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{}, out);
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));

    EXPECT_TRUE(out->has_value()) << "401 + refresh, then two 503 retries still fit in maxAttempts=3";
    EXPECT_EQ(server_.requests().size(), 4U);
}

TEST_F(ClientAuthTest, CancellingWhileTheRefreshIsRunningNeitherReplaysNorLeaks) {
    session_->refreshDelay = 100ms;
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "expired"));
    std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;
    int completions = 0;
    auto handle = client_->unary(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{},
                                 [&](ApiResult<authv1::GetCurrentUserResponse> result) {
                                     out = std::move(result);
                                     ++completions;
                                 });
    ASSERT_TRUE(waitUntil([&] { return session_->rejectionCalls == 1; }));

    handle.cancel();
    ASSERT_TRUE(waitUntil([&] { return out.has_value(); }));
    waitUntil([] { return false; }, 200ms); // let the delayed refresh complete

    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Cancelled);
    EXPECT_EQ(completions, 1);
    EXPECT_EQ(server_.requests().size(), 1U) << "no replay after cancel";
}

// --- Server streams -------------------------------------------------------------------------------

TEST_F(ClientAuthTest, AStreamRejectedAtOpenRefreshesOnceAndReopens) {
    server_.enqueue(FakeResponse::connectError(401, "unauthenticated", "expired"));
    server_.enqueue(FakeResponse::connectStream(
        {envelope::encode(0, loginResponse("m1")) + envelope::encode(envelope::kFlagEndStream, "{}")}));
    std::vector<std::string> ids;
    std::optional<ApiResult<void>> done;

    client_->serverStream(
        kStream, authv1::LoginRequest{}, [&ids](authv1::LoginResponse message) { ids.push_back(message.user_id()); },
        [&done](ApiResult<void> result) { done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return done.has_value(); }));

    EXPECT_TRUE(done->has_value());
    EXPECT_EQ(ids, (std::vector<std::string>{"m1"}));
    ASSERT_EQ(server_.requests().size(), 2U);
    EXPECT_EQ(bearer(0), QByteArray("Bearer old"));
    EXPECT_EQ(bearer(1), QByteArray("Bearer new"));
    EXPECT_EQ(session_->rejectionCalls, 1);
}

TEST_F(ClientAuthTest, AStreamWithAnEndedSessionNeverOpens) {
    session_->ensureError = core::Error::unauthenticated("Not signed in");
    std::optional<ApiResult<void>> done;

    client_->serverStream(
        kStream, authv1::LoginRequest{}, [](authv1::LoginResponse) {},
        [&done](ApiResult<void> result) { done = std::move(result); });
    ASSERT_TRUE(waitUntil([&] { return done.has_value(); }));

    ASSERT_FALSE(done->has_value());
    EXPECT_EQ(done->error().kind, ApiErrorKind::Unauthenticated);
    EXPECT_TRUE(server_.requests().empty());
}

} // namespace
} // namespace aedst::network
