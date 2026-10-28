#include "aedst/core/error.hpp"
#include "aedst/network/api_error.hpp"
#include "aedst/testing/behavior_fixture.hpp"

#include <QJsonArray>
#include <QJsonObject>

#include <gtest/gtest.h>

#include <array>
#include <string>

// Replays docs/contract/behavior/error-kinds.json against the real ApiError -> core::Error mapping and the
// core::isRetryable / core::isReportable flags. UNVERIFIED: never compiled (no Qt toolchain in the authoring
// environment); the first real build is the acceptance test.

namespace aedst::network {
namespace {

constexpr std::array kAllCodes{
    core::ErrorCode::Unknown,         core::ErrorCode::InvalidInput, core::ErrorCode::Unauthenticated,
    core::ErrorCode::Forbidden,       core::ErrorCode::NotFound,     core::ErrorCode::Conflict,
    core::ErrorCode::RateLimited,     core::ErrorCode::Unavailable,  core::ErrorCode::Offline,
    core::ErrorCode::Timeout,         core::ErrorCode::Storage,      core::ErrorCode::Cancelled,
    core::ErrorCode::UpgradeRequired,
};

core::Error failureFor(const QJsonObject& testCase) {
    const std::string transport = testCase.value("transport").toString().toStdString();
    if (transport == "offline") {
        return ApiError{.kind = ApiErrorKind::Transport, .message = "no connection"}.toCoreError();
    }
    if (transport == "timeout") {
        return ApiError{.kind = ApiErrorKind::Timeout, .message = "deadline"}.toCoreError();
    }
    if (transport == "aborted") {
        return ApiError{.kind = ApiErrorKind::Cancelled, .message = "aborted"}.toCoreError();
    }
    if (transport == "storage") {
        return core::Error::storage("database"); // created by Persistence, not mapped from a transport error
    }
    ApiError error = ApiError::fromConnectResponse(400, testCase.value("code").toString().toStdString(), "diagnostic");
    error.reason = testCase.value("reason").toString().toStdString();
    return error.toCoreError();
}

TEST(ErrorKindsReplayTest, EveryCaseMapsToTheSharedKindAndFlags) {
    const QJsonObject fixture = aedst::testing::loadBehaviorFixture("error-kinds");
    const QJsonArray cases = fixture.value("cases").toArray();
    ASSERT_FALSE(cases.isEmpty());
    for (const QJsonValue& value : cases) {
        const QJsonObject testCase = value.toObject();
        const QJsonObject expect = testCase.value("expect").toObject();
        const core::Error error = failureFor(testCase);
        const std::string id = testCase.value("id").toString().toStdString();

        EXPECT_EQ(std::string(core::toString(error.code)), expect.value("kind").toString().toStdString()) << id;
        EXPECT_EQ(core::isRetryable(error.code), expect.value("retryable").toBool()) << id;
        EXPECT_EQ(core::isReportable(error.code), expect.value("reportable").toBool()) << id;
    }
}

TEST(ErrorKindsReplayTest, EveryKindOfTheVocabularyIsAnErrorCodeWithTheDeclaredFlags) {
    const QJsonObject kinds = aedst::testing::loadBehaviorFixture("error-kinds").value("kinds").toObject();
    EXPECT_EQ(static_cast<std::size_t>(kinds.size()), kAllCodes.size());
    for (const core::ErrorCode code : kAllCodes) {
        const QString name =
            QString::fromUtf8(core::toString(code).data(), static_cast<qsizetype>(core::toString(code).size()));
        ASSERT_TRUE(kinds.contains(name)) << qPrintable(name) << " is not a kind of error-kinds.json";
        const QJsonObject flags = kinds.value(name).toObject();
        EXPECT_EQ(core::isRetryable(code), flags.value("retryable").toBool()) << qPrintable(name);
        EXPECT_EQ(core::isReportable(code), flags.value("reportable").toBool()) << qPrintable(name);
    }
}

} // namespace
} // namespace aedst::network
