#include "aedst/core/logger.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/telemetry/error_center.hpp"
#include "aedst/telemetry/posthog_analytics_tracker.hpp"
#include "aedst/telemetry/qt_log_bridge.hpp"
#include "aedst/testing/test_main.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTimeZone>

#include <gtest/gtest.h>
#include <spdlog/sinks/ostream_sink.h>

#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace aedst::telemetry {
namespace {

using core::Error;
using core::ErrorVisibility;

TEST(PostHogPayloadTest, BatchCarriesKeyAndEvents) {
    const QList<PostHogEvent> events{PostHogEvent{.event = QStringLiteral("task_completed"),
                                                  .distinctId = QStringLiteral("user-1"),
                                                  .properties = QJsonObject{{QStringLiteral("k"), QStringLiteral("v")}},
                                                  .timestamp = QDateTime::fromSecsSinceEpoch(0, QTimeZone::UTC)}};
    const QJsonObject body = QJsonDocument::fromJson(buildBatchPayload(QStringLiteral("phc_test"), events)).object();
    EXPECT_EQ(body.value(QStringLiteral("api_key")).toString(), QStringLiteral("phc_test"));
    const QJsonArray batch = body.value(QStringLiteral("batch")).toArray();
    ASSERT_EQ(batch.size(), 1);
    const QJsonObject first = batch.at(0).toObject();
    EXPECT_EQ(first.value(QStringLiteral("event")).toString(), QStringLiteral("task_completed"));
    EXPECT_EQ(first.value(QStringLiteral("distinct_id")).toString(), QStringLiteral("user-1"));
    EXPECT_EQ(first.value(QStringLiteral("timestamp")).toString(), QStringLiteral("1970-01-01T00:00:00.000Z"));
}

TEST(PostHogPayloadTest, ParsesV2AndLegacyFlagShapes) {
    const auto v2 = parseFeatureFlags(
        R"({"flags":{"new-ui":{"enabled":true,"variant":null},"exp":{"enabled":true,"variant":"b"},"off":{"enabled":false}}})");
    EXPECT_EQ(v2.value(QStringLiteral("new-ui")), QVariant(true));
    EXPECT_EQ(v2.value(QStringLiteral("exp")), QVariant(QStringLiteral("b")));
    EXPECT_EQ(v2.value(QStringLiteral("off")), QVariant(false));

    const auto legacy = parseFeatureFlags(R"({"featureFlags":{"a":true,"b":"control"}})");
    EXPECT_EQ(legacy.value(QStringLiteral("a")), QVariant(true));
    EXPECT_EQ(legacy.value(QStringLiteral("b")), QVariant(QStringLiteral("control")));
    EXPECT_TRUE(parseFeatureFlags("not json").isEmpty());
}

TEST(PostHogTrackerTest, DisabledWithoutKeyOrConsent) {
    PostHogAnalyticsTracker unconfigured(PostHogConfig{});
    unconfigured.setConsent(true);
    unconfigured.track("x", {});
    EXPECT_FALSE(unconfigured.isEnabled());
    EXPECT_EQ(unconfigured.queuedEventCount(), 0);

    PostHogAnalyticsTracker noConsent(PostHogConfig{.apiKey = QStringLiteral("phc_test")});
    EXPECT_TRUE(noConsent.isConfigured());
    noConsent.track("x", {});
    EXPECT_EQ(noConsent.queuedEventCount(), 0);
}

TEST(PostHogTrackerTest, RejectsPlainHttpHost) {
    PostHogAnalyticsTracker tracker(
        PostHogConfig{.apiKey = QStringLiteral("phc_test"), .host = QUrl(QStringLiteral("http://posthog.example"))});
    EXPECT_FALSE(tracker.isConfigured());
}

TEST(PostHogTrackerTest, RevokingConsentDropsQueuedEvents) {
    // Loopback https host: the flag reload that consent triggers fails fast, nothing leaves the machine.
    PostHogAnalyticsTracker tracker(PostHogConfig{.apiKey = QStringLiteral("phc_test"),
                                                  .host = QUrl(QStringLiteral("https://127.0.0.1:9")),
                                                  .maxBatchSize = 100});
    tracker.setConsent(true);
    tracker.track("a", {});
    tracker.track("b", {});
    EXPECT_EQ(tracker.queuedEventCount(), 2);
    tracker.setConsent(false);
    EXPECT_EQ(tracker.queuedEventCount(), 0);
}

TEST(PostHogTrackerTest, TheFlushTimerRunsOnlyWhileEventsAreWaiting) {
    PostHogAnalyticsTracker tracker(PostHogConfig{.apiKey = QStringLiteral("phc_test"),
                                                  .host = QUrl(QStringLiteral("https://127.0.0.1:9")),
                                                  .maxBatchSize = 100});
    EXPECT_FALSE(tracker.flushTimerActive()) << "no timer before there is anything to send";
    tracker.setConsent(true);
    EXPECT_FALSE(tracker.flushTimerActive()) << "consent alone starts nothing";

    tracker.track("a", {});
    EXPECT_TRUE(tracker.flushTimerActive()) << "the first enqueued event starts the timer";

    tracker.setConsent(false);
    EXPECT_FALSE(tracker.flushTimerActive()) << "revoking consent empties the queue and stops the timer";
}

TEST(ErrorCenterTest, MapsCodesToStableKinds) {
    EXPECT_EQ(ErrorCenter::kindFor(core::ErrorCode::Unavailable), QStringLiteral("unavailable"));
    EXPECT_EQ(ErrorCenter::kindFor(core::ErrorCode::Forbidden), QStringLiteral("forbidden"));
    EXPECT_TRUE(ErrorCenter::isRetryable(core::ErrorCode::Unavailable));
    EXPECT_TRUE(ErrorCenter::isRetryable(core::ErrorCode::Offline));
    EXPECT_TRUE(ErrorCenter::isRetryable(core::ErrorCode::Timeout));
    EXPECT_TRUE(ErrorCenter::isRetryable(core::ErrorCode::RateLimited));
    EXPECT_FALSE(ErrorCenter::isRetryable(core::ErrorCode::InvalidInput));
    EXPECT_FALSE(ErrorCenter::isRetryable(core::ErrorCode::Unknown));
    EXPECT_FALSE(ErrorCenter::isRetryable(core::ErrorCode::Storage));
}

TEST(ErrorCenterTest, EmitsOnceForDuplicatesAndNeverForSilentOrCancelled) {
    ErrorCenter center;
    QSignalSpy raised(&center, &ErrorCenter::errorRaised);
    QSignalSpy expired(&center, &ErrorCenter::sessionExpired);

    center.report(Error::unavailable("offline"), "tasks.list");
    center.report(Error::unavailable("offline"), "tasks.list");
    center.report(Error::cancelled("user"), "tasks.list");
    center.report(Error::notFound("gone"), "tasks.detail", ErrorVisibility::Silent);
    EXPECT_EQ(raised.count(), 1);

    center.report(Error::unauthenticated("expired"), "tasks.list", ErrorVisibility::Blocking);
    EXPECT_EQ(expired.count(), 1);
    ASSERT_EQ(raised.count(), 2);
    EXPECT_EQ(raised.at(1).at(0).toString(), QStringLiteral("unauthenticated"));
    EXPECT_TRUE(raised.at(1).at(3).toBool());
}

class QtLogBridgeTest : public ::testing::Test {
protected:
    void SetUp() override {
        auto sink = std::make_shared<spdlog::sinks::ostream_sink_mt>(captured_);
        core::LoggerConfig config;
        config.console = false;
        config.level = core::LogLevel::Debug;
        core::AedstLogger::init(config, {sink});
        installQtLogBridge();
    }

    void TearDown() override {
        uninstallQtLogBridge();
        core::AedstLogger::shutdown();
    }

    [[nodiscard]] std::string output() {
        core::AedstLogger::flush();
        return captured_.str();
    }

    std::ostringstream captured_;
};

TEST_F(QtLogBridgeTest, FirstPartyCategoriesReachSpdlogAtEveryLevel) {
    qCInfo(lcNetwork, "hello %d", 7);
    qCDebug(lcMedia, "detail");
    const std::string text = output();
    EXPECT_NE(text.find("[aedst.network] hello 7"), std::string::npos) << text;
    EXPECT_NE(text.find("[aedst.media] detail"), std::string::npos) << text;
}

TEST_F(QtLogBridgeTest, FrameworkInfoStaysOutOfTheProductLog) {
    const QLoggingCategory framework("qt.test.framework");
    qCInfo(framework, "chatty");
    qCWarning(framework, "important");
    const std::string text = output();
    EXPECT_EQ(text.find("chatty"), std::string::npos) << text;
    EXPECT_NE(text.find("[qt:qt.test.framework] important"), std::string::npos) << text;
}

TEST_F(QtLogBridgeTest, SecretsInCategoryMessagesAreRedacted) {
    qCWarning(lcNetwork, "request failed: Authorization: Bearer abc.def.ghi");
    EXPECT_EQ(output().find("abc.def.ghi"), std::string::npos);
}

TEST(PostHogSanitizeTest, MasksPersonalDataAndCapsTheLength) {
    EXPECT_EQ(sanitizePropertyValue(QStringLiteral("opened")), QStringLiteral("opened"));
    EXPECT_EQ(sanitizePropertyValue(QStringLiteral("mail alice@example.com")), QStringLiteral("mail a***@e***.com"));
    EXPECT_EQ(sanitizePropertyValue(QStringLiteral("/home/alice/x")), QStringLiteral("/home/<user>/x"));
    EXPECT_EQ(sanitizePropertyValue(QString(500, QLatin1Char('a'))).size(), 200);
}

struct CapturedCrumb {
    std::string category;
    std::string message;
    BreadcrumbLevel level;
};

// The sink is a plain function pointer (QtLogBridgeOptions::BreadcrumbSink), so the capture list is a global of this
// file. NOLINTNEXTLINE(cppcoreguidelines-avoid-non-const-global-variables)
std::vector<CapturedCrumb> gCrumbs;

void captureCrumb(std::string_view category, std::string_view message, BreadcrumbLevel level) {
    gCrumbs.push_back({std::string(category), std::string(message), level});
}

class BreadcrumbBridgeTest : public ::testing::Test {
protected:
    void SetUp() override {
        gCrumbs.clear();
        core::LoggerConfig config;
        config.console = false;
        config.level = core::LogLevel::Debug;
        core::AedstLogger::init(config, {std::make_shared<spdlog::sinks::ostream_sink_mt>(captured_)});
        installQtLogBridge({.breadcrumbs = true, .breadcrumbSink = &captureCrumb});
    }

    void TearDown() override {
        uninstallQtLogBridge();
        core::AedstLogger::shutdown();
    }

    std::ostringstream captured_;
};

TEST_F(BreadcrumbBridgeTest, FirstPartyInfoAndAllWarningsBecomeBreadcrumbsButDebugAndFrameworkInfoDoNot) {
    const QLoggingCategory framework("qt.test.framework");
    qCInfo(lcAuth, "signed in");
    qCDebug(lcAuth, "detail");
    qCInfo(framework, "chatty");
    qCWarning(framework, "important");

    ASSERT_EQ(gCrumbs.size(), 2U);
    EXPECT_EQ(gCrumbs[0].category, "aedst.auth");
    EXPECT_EQ(gCrumbs[0].message, "signed in");
    EXPECT_EQ(gCrumbs[0].level, BreadcrumbLevel::Info);
    EXPECT_EQ(gCrumbs[1].category, "qt.test.framework");
    EXPECT_EQ(gCrumbs[1].level, BreadcrumbLevel::Warning);
}

TEST_F(BreadcrumbBridgeTest, BreadcrumbTextIsScrubbed) {
    qCWarning(lcNetwork, "failed for alice@example.com reading C:\\Users\\alice\\AppData\\x token=abc123");
    ASSERT_EQ(gCrumbs.size(), 1U);
    EXPECT_EQ(gCrumbs[0].message.find("alice@"), std::string::npos) << gCrumbs[0].message;
    EXPECT_EQ(gCrumbs[0].message.find("Users\\alice"), std::string::npos) << gCrumbs[0].message;
    EXPECT_EQ(gCrumbs[0].message.find("abc123"), std::string::npos) << gCrumbs[0].message;
    EXPECT_NE(gCrumbs[0].message.find("<user>"), std::string::npos) << gCrumbs[0].message;
}

} // namespace
} // namespace aedst::telemetry

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
