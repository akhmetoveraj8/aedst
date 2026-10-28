#include "aedst/network/call_options.hpp"

#include <gtest/gtest.h>

#include <chrono>

namespace aedst::network {
namespace {

using std::chrono::milliseconds;

TEST(RetryPolicyTest, BackoffDoublesUpToTheCap) {
    const RetryPolicy policy{
        .maxAttempts = 6, .initialBackoff = milliseconds{100}, .maxBackoff = milliseconds{500}, .multiplier = 2.0};

    // jitter = 1.0 -> the full cap for that attempt.
    EXPECT_EQ(policy.delayBefore(2, 1.0), milliseconds{100});
    EXPECT_EQ(policy.delayBefore(3, 1.0), milliseconds{200});
    EXPECT_EQ(policy.delayBefore(4, 1.0), milliseconds{400});
    EXPECT_EQ(policy.delayBefore(5, 1.0), milliseconds{500});
    EXPECT_EQ(policy.delayBefore(6, 1.0), milliseconds{500});
}

TEST(RetryPolicyTest, EqualJitterKeepsAtLeastHalfTheDelay) {
    const RetryPolicy policy{.initialBackoff = milliseconds{200}, .maxBackoff = milliseconds{2000}};

    EXPECT_EQ(policy.delayBefore(2, 0.0), milliseconds{100});
    EXPECT_EQ(policy.delayBefore(2, 0.5), milliseconds{150});
    EXPECT_EQ(policy.delayBefore(2, 1.0), milliseconds{200});
}

TEST(RetryPolicyTest, OutOfRangeJitterIsClamped) {
    const RetryPolicy policy{.initialBackoff = milliseconds{200}};

    EXPECT_EQ(policy.delayBefore(2, -3.0), milliseconds{100});
    EXPECT_EQ(policy.delayBefore(2, 9.0), milliseconds{200});
}

TEST(RetryPolicyTest, NoneMeansASingleAttempt) {
    EXPECT_EQ(RetryPolicy::none().maxAttempts, 1);
}

} // namespace
} // namespace aedst::network
