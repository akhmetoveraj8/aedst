#include "aedst/core/correlation.hpp"
#include "aedst/core/logger.hpp"

#include <gtest/gtest.h>
#include <spdlog/sinks/ostream_sink.h>

#include <algorithm>
#include <memory>
#include <sstream>
#include <string>

namespace aedst::core {
namespace {

class JsonFormatTest : public ::testing::Test {
protected:
    void SetUp() override {
        LoggerConfig config;
        config.name = "json-test";
        config.console = false;
        config.format = LogFormat::Json;
        AedstLogger::init(config, {std::make_shared<spdlog::sinks::ostream_sink_mt>(output_)});
    }

    void TearDown() override { AedstLogger::shutdown(); }

    std::string captured() {
        AedstLogger::flush();
        return output_.str();
    }

    std::ostringstream output_;
};

TEST_F(JsonFormatTest, EmitsOneObjectPerLineWithTheDocumentedFields) {
    AedstLogger::warn("hello {}", "world");

    const std::string text = captured();

    ASSERT_GT(text.size(), 40U);
    EXPECT_EQ(text.rfind("{\"ts\":\"", 0), 0U) << text;
    // 2026-09-30T12:00:00.123Z is 24 characters, so 'Z' sits at 7 + 23.
    EXPECT_EQ(text[7 + 23], 'Z') << text;
    EXPECT_EQ(text[7 + 4], '-') << text;
    EXPECT_EQ(text[7 + 10], 'T') << text;
    EXPECT_NE(text.find("\",\"level\":\"warning\""), std::string::npos) << text;
    EXPECT_NE(text.find("\"logger\":\"json-test\""), std::string::npos) << text;
    EXPECT_NE(text.find("\"thread\":"), std::string::npos) << text;
    EXPECT_NE(text.find("\"msg\":\"hello world\"}\n"), std::string::npos) << text;
    EXPECT_EQ(text.find("\"cid\""), std::string::npos) << "no cid outside a CorrelationScope";
    EXPECT_EQ(std::count(text.begin(), text.end(), '\n'), 1);
}

TEST_F(JsonFormatTest, EscapesQuotesBackslashesNewlinesAndControlCharacters) {
    AedstLogger::info("{}", std::string("say \"hi\" \\ line1\nline2\ttab \x01 end"));

    const std::string text = captured();

    EXPECT_NE(text.find("\"msg\":\"say \\\"hi\\\" \\\\ line1\\nline2\\ttab \\u0001 end\"}"), std::string::npos) << text;
    EXPECT_EQ(std::count(text.begin(), text.end(), '\n'), 1) << "a newline in the message must not split the record";
}

TEST_F(JsonFormatTest, IncludesTheCorrelationIdInsideAScope) {
    {
        const CorrelationScope scope("req-42");
        AedstLogger::info("scoped");
    }

    const std::string text = captured();

    EXPECT_NE(text.find(",\"cid\":\"req-42\",\"msg\":\"scoped\""), std::string::npos) << text;
}

TEST_F(JsonFormatTest, RedactionRunsBeforeEscaping) {
    AedstLogger::info("body {{\"password\":\"hunter2\"}} from {}", "alice@example.com");

    const std::string text = captured();

    EXPECT_NE(text.find("\\\"password\\\":\\\"***\\\""), std::string::npos) << text;
    EXPECT_EQ(text.find("hunter2"), std::string::npos) << text;
    EXPECT_NE(text.find("a***@e***.com"), std::string::npos) << text;
}

TEST_F(JsonFormatTest, MultibyteUtf8PassesThroughUnchanged) {
    AedstLogger::info("caf\xC3\xA9");

    EXPECT_NE(captured().find("\"msg\":\"caf\xC3\xA9\""), std::string::npos);
}

} // namespace
} // namespace aedst::core
