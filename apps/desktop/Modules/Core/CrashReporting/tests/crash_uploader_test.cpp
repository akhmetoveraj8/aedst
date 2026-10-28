#include "aedst/crash/crash_uploader.hpp"
#include "aedst/testing/fake_clock.hpp"
#include "temp_dir_fixture.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <string>
#include <vector>

namespace aedst::crash {
namespace {

class FakeConsentStore final : public ConsentStore {
public:
    [[nodiscard]] ConsentState state() const override { return state_; }

    [[nodiscard]] core::VoidOutcome setState(ConsentState newState) override {
        state_ = newState;
        return core::ok();
    }

private:
    ConsentState state_{ConsentState::Unknown};
};

class FakeHttpPoster final : public HttpPoster {
public:
    [[nodiscard]] core::VoidOutcome post(const UploadPayload& payload) override {
        if (fail_) {
            return core::fail(core::Error::unavailable("offline"));
        }
        sent_.push_back(payload);
        return core::ok();
    }

    void setFail(bool fail) { fail_ = fail; }

    [[nodiscard]] const std::vector<UploadPayload>& sent() const { return sent_; }

private:
    bool fail_{false};
    std::vector<UploadPayload> sent_;
};

class CrashUploaderTest : public test_support::TempDirTest {
protected:
    void SetUp() override {
        TempDirTest::SetUp();
        config_.crashesDirectory = root_;
        config_.maxReportBytes = 100;
        config_.maxUploadsPerDay = 2;
    }

    [[nodiscard]] ConsentGatedCrashUploader makeUploader() { return {config_, consent_, poster_, clock_}; }

    std::filesystem::path addReport(const std::string& name, const std::string& body) {
        const auto path = root_ / name;
        writeFile(path, body);
        return path;
    }

    UploaderConfig config_;
    FakeConsentStore consent_;
    FakeHttpPoster poster_;
    aedst::testing::FakeClock clock_;
};

TEST_F(CrashUploaderTest, NeverSendsWithoutConsent) {
    const auto path = addReport("crash-20240101T000000Z-1.txt", "boom");
    auto uploader = makeUploader();

    for (const ConsentState state : {ConsentState::Unknown, ConsentState::Denied}) {
        ASSERT_TRUE(consent_.setState(state).has_value());
        const auto summary = uploader.uploadPending();
        ASSERT_TRUE(summary.has_value());
        EXPECT_FALSE(summary->consentGranted);
        EXPECT_EQ(summary->uploaded, 0U);
    }
    EXPECT_TRUE(poster_.sent().empty());
    EXPECT_TRUE(std::filesystem::exists(path));
}

TEST_F(CrashUploaderTest, UploadsAndDeletesWhenGranted) {
    const auto txt = addReport("crash-20240101T000000Z-1.txt", "frame /home/alice/bin/aedst");
    const auto dmp = addReport("crash-20240102T000000Z-1.dmp", "MDMP");
    ASSERT_TRUE(consent_.setState(ConsentState::Granted).has_value());
    auto uploader = makeUploader();

    ASSERT_EQ(uploader.pendingReports().size(), 2U);
    const auto summary = uploader.uploadPending();
    ASSERT_TRUE(summary.has_value());
    EXPECT_TRUE(summary->consentGranted);
    EXPECT_EQ(summary->uploaded, 2U);
    EXPECT_EQ(summary->failed, 0U);

    ASSERT_EQ(poster_.sent().size(), 2U);
    EXPECT_EQ(poster_.sent()[0].fileName, "crash-20240101T000000Z-1.txt");
    EXPECT_EQ(poster_.sent()[0].contentType, "text/plain; charset=utf-8");
    EXPECT_EQ(poster_.sent()[0].body, "frame /home/<user>/bin/aedst");
    EXPECT_EQ(poster_.sent()[1].contentType, "application/octet-stream");
    EXPECT_EQ(poster_.sent()[1].body, "MDMP");
    EXPECT_FALSE(std::filesystem::exists(txt));
    EXPECT_FALSE(std::filesystem::exists(dmp));
    EXPECT_TRUE(uploader.pendingReports().empty());
}

TEST_F(CrashUploaderTest, OversizeReportsAreDiscardedNotSent) {
    const auto big = addReport("crash-20240101T000000Z-1.dmp", std::string(config_.maxReportBytes + 1, 'x'));
    ASSERT_TRUE(consent_.setState(ConsentState::Granted).has_value());
    auto uploader = makeUploader();

    const auto summary = uploader.uploadPending();
    ASSERT_TRUE(summary.has_value());
    EXPECT_EQ(summary->discardedOversize, 1U);
    EXPECT_EQ(summary->uploaded, 0U);
    EXPECT_TRUE(poster_.sent().empty());
    EXPECT_FALSE(std::filesystem::exists(big));
}

TEST_F(CrashUploaderTest, ReportAtExactlyTheLimitIsSent) {
    addReport("crash-20240101T000000Z-1.dmp", std::string(config_.maxReportBytes, 'x'));
    ASSERT_TRUE(consent_.setState(ConsentState::Granted).has_value());
    auto uploader = makeUploader();
    const auto summary = uploader.uploadPending();
    ASSERT_TRUE(summary.has_value());
    EXPECT_EQ(summary->uploaded, 1U);
}

TEST_F(CrashUploaderTest, RateLimitsPerDayAndPersistsAcrossInstances) {
    for (int i = 1; i <= 4; ++i) {
        addReport("crash-2024010" + std::to_string(i) + "T000000Z-1.dmp", "d");
    }
    ASSERT_TRUE(consent_.setState(ConsentState::Granted).has_value());

    {
        auto first = makeUploader();
        const auto summary = first.uploadPending();
        ASSERT_TRUE(summary.has_value());
        EXPECT_EQ(summary->uploaded, 2U);
        EXPECT_TRUE(summary->rateLimited);
    }
    // "Restart": a new uploader must see the persisted budget.
    {
        auto second = makeUploader();
        const auto summary = second.uploadPending();
        ASSERT_TRUE(summary.has_value());
        EXPECT_EQ(summary->uploaded, 0U);
        EXPECT_TRUE(summary->rateLimited);
    }
    EXPECT_EQ(poster_.sent().size(), 2U);

    // 25 hours later the window has rolled over.
    clock_.advance(std::chrono::hours{25});
    auto third = makeUploader();
    const auto summary = third.uploadPending();
    ASSERT_TRUE(summary.has_value());
    EXPECT_EQ(summary->uploaded, 2U);
    EXPECT_TRUE(third.pendingReports().empty());
}

TEST_F(CrashUploaderTest, TransportFailureKeepsReportsAndStops) {
    const auto first = addReport("crash-20240101T000000Z-1.dmp", "a");
    const auto second = addReport("crash-20240102T000000Z-1.dmp", "b");
    ASSERT_TRUE(consent_.setState(ConsentState::Granted).has_value());
    poster_.setFail(true);
    auto uploader = makeUploader();

    const auto summary = uploader.uploadPending();
    ASSERT_TRUE(summary.has_value());
    EXPECT_EQ(summary->failed, 1U);
    EXPECT_EQ(summary->uploaded, 0U);
    EXPECT_TRUE(std::filesystem::exists(first));
    EXPECT_TRUE(std::filesystem::exists(second));

    // A failed attempt does not consume the daily budget.
    poster_.setFail(false);
    const auto retry = uploader.uploadPending();
    ASSERT_TRUE(retry.has_value());
    EXPECT_EQ(retry->uploaded, 2U);
}

TEST_F(CrashUploaderTest, DiscardPendingDeletesEverything) {
    addReport("crash-20240101T000000Z-1.dmp", "a");
    addReport("crash-20240102T000000Z-1.txt", "b");
    auto uploader = makeUploader();
    EXPECT_EQ(uploader.discardPending(), 2U);
    EXPECT_TRUE(uploader.pendingReports().empty());
    EXPECT_TRUE(poster_.sent().empty());
}

} // namespace
} // namespace aedst::crash
