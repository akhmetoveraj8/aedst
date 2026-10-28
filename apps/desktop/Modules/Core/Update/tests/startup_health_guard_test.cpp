#include "aedst/update/startup_health_guard.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

namespace aedst::update {
namespace {

class StartupHealthGuardTest : public ::testing::Test {
protected:
    void SetUp() override {
        dir_ = std::filesystem::temp_directory_path() /
               ("aedst-health-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        std::filesystem::create_directories(dir_);
        file_ = dir_ / "nested" / "update_health";
    }

    void TearDown() override {
        std::error_code ignored;
        std::filesystem::remove_all(dir_, ignored);
    }

    StartupHealthGuard guard(const std::string& version) const { return StartupHealthGuard(file_, version); }

    std::filesystem::path dir_;
    std::filesystem::path file_;
};

TEST_F(StartupHealthGuardTest, AFirstStartIsNotACrashLoop) {
    auto g = guard("1.0.0");
    const auto report = g.recordStart();
    ASSERT_TRUE(report.has_value()) << report.error().message;
    EXPECT_EQ(report->unhealthyStarts, 1);
    EXPECT_FALSE(report->crashLoop);
    EXPECT_TRUE(report->firstStartOfThisVersion);
    EXPECT_TRUE(report->lastKnownGood.empty());
}

TEST_F(StartupHealthGuardTest, ThreeStartsInARowThatNeverBecomeHealthyAreACrashLoop) {
    for (int start = 1; start <= StartupHealthGuard::kCrashLoopThreshold; ++start) {
        auto g = guard("1.1.0");
        const auto report = g.recordStart();
        ASSERT_TRUE(report.has_value());
        EXPECT_EQ(report->unhealthyStarts, start);
        EXPECT_EQ(report->crashLoop, start == StartupHealthGuard::kCrashLoopThreshold) << "start " << start;
    }
}

TEST_F(StartupHealthGuardTest, MarkingHealthyResetsTheCounterAndRemembersTheVersion) {
    {
        auto g = guard("1.1.0");
        ASSERT_TRUE(g.recordStart().has_value());
        ASSERT_TRUE(g.recordStart().has_value());
        ASSERT_TRUE(g.markHealthy().has_value());
    }
    auto g = guard("1.1.0");
    const auto report = g.recordStart();
    ASSERT_TRUE(report.has_value());
    EXPECT_EQ(report->unhealthyStarts, 1);
    EXPECT_FALSE(report->crashLoop);
    EXPECT_FALSE(report->firstStartOfThisVersion);
    EXPECT_EQ(report->lastKnownGood, "1.1.0");
}

TEST_F(StartupHealthGuardTest, ANewVersionStartsWithACleanCountButKeepsTheLastKnownGood) {
    {
        auto g = guard("1.1.0");
        ASSERT_TRUE(g.recordStart().has_value());
        ASSERT_TRUE(g.markHealthy().has_value());
    }
    // The update to 1.2.0 never gets healthy.
    HealthReport last;
    for (int start = 1; start <= StartupHealthGuard::kCrashLoopThreshold; ++start) {
        auto g = guard("1.2.0");
        const auto report = g.recordStart();
        ASSERT_TRUE(report.has_value());
        last = *report;
    }
    EXPECT_TRUE(last.crashLoop);
    EXPECT_EQ(last.lastKnownGood, "1.1.0") << "this is the version an operator rolls back to";
}

TEST_F(StartupHealthGuardTest, AfterARollbackTheOlderVersionStartsClean) {
    for (int i = 0; i < 3; ++i) {
        auto g = guard("1.2.0");
        ASSERT_TRUE(g.recordStart().has_value());
    }
    auto older = guard("1.1.0");
    const auto report = older.recordStart();
    ASSERT_TRUE(report.has_value());
    EXPECT_EQ(report->unhealthyStarts, 1);
    EXPECT_FALSE(report->crashLoop);
    EXPECT_TRUE(report->firstStartOfThisVersion);
}

TEST_F(StartupHealthGuardTest, ACorruptFileReadsAsNoHistory) {
    std::filesystem::create_directories(file_.parent_path());
    std::ofstream(file_) << "garbage without equals\n";
    auto g = guard("1.0.0");
    const auto report = g.recordStart();
    ASSERT_TRUE(report.has_value());
    EXPECT_EQ(report->unhealthyStarts, 1);
    EXPECT_FALSE(report->crashLoop);
}

TEST_F(StartupHealthGuardTest, ATamperedCounterCannotOverflow) {
    std::filesystem::create_directories(file_.parent_path());
    std::ofstream(file_) << "version=1.0.0\nunhealthyStarts=999999\nlastKnownGood=\n";
    auto g = guard("1.0.0");
    const auto report = g.recordStart();
    ASSERT_TRUE(report.has_value());
    EXPECT_TRUE(report->crashLoop);
    EXPECT_LE(report->unhealthyStarts, 1000);
}

TEST_F(StartupHealthGuardTest, AnUnwritableLocationIsReportedNotThrown) {
    const auto blocker = dir_ / "blocker";
    std::ofstream(blocker) << "x";
    StartupHealthGuard g(blocker / "state", "1.0.0");
    const auto report = g.recordStart();
    ASSERT_FALSE(report.has_value());
    EXPECT_EQ(report.error().code, core::ErrorCode::Storage);
}

} // namespace
} // namespace aedst::update
