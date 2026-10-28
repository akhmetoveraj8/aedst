#include "aedst/core/logger.hpp"

#include <gtest/gtest.h>
#include <spdlog/sinks/ostream_sink.h>

#include <memory>
#include <sstream>
#include <string>

namespace aedst::core {
namespace {

class AedstLoggerTest : public ::testing::Test {
protected:
    void TearDown() override { AedstLogger::shutdown(); }

    std::ostringstream output_;

    void initCapturing(LogLevel level) {
        LoggerConfig config;
        config.name = "test";
        config.level = level;
        config.console = false;
        AedstLogger::init(config, {std::make_shared<spdlog::sinks::ostream_sink_mt>(output_)});
    }
};

TEST_F(AedstLoggerTest, WritesMessagesAtOrAboveConfiguredLevel) {
    initCapturing(LogLevel::Info);

    AedstLogger::debug("hidden {}", 1);
    AedstLogger::info("visible {}", 2);
    AedstLogger::error("also visible {}", "three");
    AedstLogger::flush();

    const std::string output = output_.str();
    EXPECT_EQ(output.find("hidden"), std::string::npos);
    EXPECT_NE(output.find("visible 2"), std::string::npos);
    EXPECT_NE(output.find("also visible three"), std::string::npos);
}

TEST_F(AedstLoggerTest, SetLevelChangesFilteringAtRuntime) {
    initCapturing(LogLevel::Warn);

    AedstLogger::info("before");
    AedstLogger::setLevel(LogLevel::Debug);
    AedstLogger::debug("after");
    AedstLogger::flush();

    const std::string output = output_.str();
    EXPECT_EQ(output.find("before"), std::string::npos);
    EXPECT_NE(output.find("after"), std::string::npos);
}

TEST_F(AedstLoggerTest, RedactsOnceAndEverySinkSeesTheRedactedText) {
    std::ostringstream second;
    LoggerConfig config;
    config.name = "test";
    config.console = false;
    AedstLogger::init(config, {std::make_shared<spdlog::sinks::ostream_sink_mt>(output_),
                               std::make_shared<spdlog::sinks::ostream_sink_mt>(second)});

    AedstLogger::info("Authorization: Bearer abcdef0123456789abcdef0123456789");
    AedstLogger::flush();

    for (const std::string& text : {output_.str(), second.str()}) {
        EXPECT_EQ(text.find("abcdef0123456789"), std::string::npos) << text;
        EXPECT_NE(text.find("Authorization"), std::string::npos) << text;
    }
}

TEST_F(AedstLoggerTest, FallsBackToDefaultLoggerWhenNotInitialised) {
    AedstLogger::shutdown();

    const auto logger = AedstLogger::get();

    ASSERT_NE(logger, nullptr);
    EXPECT_EQ(logger->name(), "aedst");
}

} // namespace
} // namespace aedst::core
