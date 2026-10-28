#include "aedst/core/correlation.hpp"
#include "aedst/core/logger.hpp"

#include <gtest/gtest.h>
#include <spdlog/sinks/ostream_sink.h>

#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <thread>

namespace aedst::core {
namespace {

TEST(CorrelationIdTest, GeneratedIdsAreSixteenLowercaseHexCharsAndDistinct) {
    std::set<std::string> seen;
    for (int i = 0; i < 200; ++i) {
        const std::string id = newCorrelationId();
        ASSERT_EQ(id.size(), 16U);
        for (const char c : id) {
            EXPECT_TRUE((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) << id;
        }
        EXPECT_TRUE(isValidCorrelationId(id));
        seen.insert(id);
    }
    EXPECT_EQ(seen.size(), 200U);
}

TEST(CorrelationIdTest, ValidationRejectsEmptyOverlongAndHeaderInjection) {
    EXPECT_TRUE(isValidCorrelationId("abc-DEF_123.x"));
    EXPECT_FALSE(isValidCorrelationId(""));
    EXPECT_FALSE(isValidCorrelationId(std::string(65, 'a')));
    EXPECT_TRUE(isValidCorrelationId(std::string(64, 'a')));
    EXPECT_FALSE(isValidCorrelationId("a b"));
    EXPECT_FALSE(isValidCorrelationId("abc\r\nX-Evil: 1"));
    EXPECT_FALSE(isValidCorrelationId("caf\xC3\xA9"));
}

TEST(CorrelationScopeTest, ScopesNestAndRestoreThePreviousId) {
    EXPECT_TRUE(currentCorrelationId().empty());
    {
        const CorrelationScope outer("outer-id");
        EXPECT_EQ(currentCorrelationId(), "outer-id");
        {
            const CorrelationScope inner;
            EXPECT_EQ(currentCorrelationId(), inner.id());
            EXPECT_NE(inner.id(), "outer-id");
        }
        EXPECT_EQ(currentCorrelationId(), "outer-id");
    }
    EXPECT_TRUE(currentCorrelationId().empty());
}

TEST(CorrelationScopeTest, InvalidIdIsReplacedNotAdopted) {
    const CorrelationScope scope("bad id\r\n");

    EXPECT_TRUE(isValidCorrelationId(scope.id()));
    EXPECT_EQ(scope.id().size(), 16U);
}

TEST(CorrelationScopeTest, IsThreadLocal) {
    const CorrelationScope scope("main-thread");
    std::string seenOnOtherThread = "unset";

    std::thread other([&seenOnOtherThread] { seenOnOtherThread = std::string(currentCorrelationId()); });
    other.join();

    EXPECT_TRUE(seenOnOtherThread.empty());
    EXPECT_EQ(currentCorrelationId(), "main-thread");
}

class CorrelationLogTest : public ::testing::Test {
protected:
    void SetUp() override {
        LoggerConfig config;
        config.name = "test";
        config.console = false;
        AedstLogger::init(config, {std::make_shared<spdlog::sinks::ostream_sink_mt>(output_)});
    }

    void TearDown() override { AedstLogger::shutdown(); }

    std::ostringstream output_;
};

TEST_F(CorrelationLogTest, TextPatternPrintsTheActiveIdOrADash) {
    AedstLogger::info("outside");
    {
        const CorrelationScope scope("cid-1234");
        AedstLogger::info("inside");
    }
    AedstLogger::flush();

    const std::string text = output_.str();
    const std::string firstLine = text.substr(0, text.find('\n'));
    EXPECT_NE(firstLine.find("[cid:-] outside"), std::string::npos) << firstLine;
    EXPECT_NE(text.find("[cid:cid-1234] inside"), std::string::npos) << text;
}

} // namespace
} // namespace aedst::core
