#include "aedst/core/logger.hpp"
#include "aedst/core/redaction.hpp"

#include <gtest/gtest.h>
#include <spdlog/sinks/ostream_sink.h>

#include <memory>
#include <sstream>
#include <string>

namespace aedst::core {
namespace {

struct RedactionCase {
    const char* name;
    std::string input;
    std::string expected;
};

class RedactionTest : public ::testing::TestWithParam<RedactionCase> {};

TEST_P(RedactionTest, MasksSecretsAndLeavesTheRestAlone) {
    const auto& param = GetParam();

    EXPECT_EQ(redactSecrets(param.input), param.expected);
    EXPECT_EQ(redactSecrets(redactSecrets(param.input)), param.expected) << "must be idempotent";
}

INSTANTIATE_TEST_SUITE_P(
    Forms, RedactionTest,
    ::testing::Values(
        RedactionCase{"KeyEquals", "login password=hunter2 ok", "login password=*** ok"},
        RedactionCase{"KeyEqualsUpperCase", "PASSWORD=X", "PASSWORD=***"},
        RedactionCase{"Passwd", "passwd=abc", "passwd=***"},
        RedactionCase{"JsonQuoted", R"({"password":"hunter2","user":"bob"})", R"({"password":"***","user":"bob"})"},
        RedactionCase{"JsonSpacedColon", R"({"token": "abc"})", R"({"token": "***"})"},
        RedactionCase{"JsonEscapedQuoteInValue", R"("token": "a\"b" rest)", R"("token": "***" rest)"},
        RedactionCase{"SingleQuoted", "refresh_token: 'r3fr3sh' next", "refresh_token: '***' next"},
        RedactionCase{"QueryString", "GET /x?access_token=abc123&page=1", "GET /x?access_token=***&page=1"},
        RedactionCase{"ClientSecretAndApiKey", "api_key=K client_secret=S", "api_key=*** client_secret=***"},
        RedactionCase{"HeaderApiKey", "x-api-key: K1", "x-api-key: ***"},
        RedactionCase{"AuthorizationHeaderLine", "Authorization: Bearer eyJhbGci.abc.def", "Authorization: ***"},
        RedactionCase{"BearerAnywhere", "sent header Bearer eyJhbGci.abc.def done", "sent header Bearer *** done"},
        RedactionCase{"BearerLowerCase", "bearer abc123", "bearer ***"},
        RedactionCase{"CookieHeader", "Cookie: sid=abc; theme=dark", "Cookie: ***"},
        RedactionCase{"SetCookieHeader", "Set-Cookie: sid=abc; Path=/", "Set-Cookie: ***"},
        RedactionCase{"KeyStopsAtBrace", "{token=abc}", "{token=***}"},
        RedactionCase{"EmailSimple", "user alice@example.com failed", "user a***@e***.com failed"},
        RedactionCase{"EmailMultiLabelDomainAndTrailingDot", "contact bob.smith@mail.example.co.uk.",
                      "contact b***@m***.uk."},
        RedactionCase{"EmailInsideKeyValue", "email=a@b.co", "email=a***@b***.co"},
        RedactionCase{"NothingToHide", "user=alice status=200 tokenless", "user=alice status=200 tokenless"},
        RedactionCase{"EmptyValueKept", "password=&next=1", "password=&next=1"},
        RedactionCase{"BareAtSign", "a@b and @home and x@", "a@b and @home and x@"},
        RedactionCase{"BearerWithoutCredential", "Bearer", "Bearer"}, RedactionCase{"Empty", "", ""}),
    [](const ::testing::TestParamInfo<RedactionCase>& info) { return std::string(info.param.name); });

TEST(RedactionLoggerTest, EveryMessageIsRedactedBeforeItReachesASink) {
    std::ostringstream output;
    LoggerConfig config;
    config.name = "test";
    config.console = false;
    AedstLogger::init(config, {std::make_shared<spdlog::sinks::ostream_sink_mt>(output)});

    AedstLogger::info("login failed for {} password={}", "alice@example.com", "hunter2");
    AedstLogger::flush();
    AedstLogger::shutdown();

    const std::string text = output.str();
    EXPECT_NE(text.find("password=***"), std::string::npos) << text;
    EXPECT_NE(text.find("a***@e***.com"), std::string::npos) << text;
    EXPECT_EQ(text.find("hunter2"), std::string::npos) << text;
    EXPECT_EQ(text.find("alice@"), std::string::npos) << text;
}

TEST(RedactionLoggerTest, CanBeDisabledExplicitly) {
    std::ostringstream output;
    LoggerConfig config;
    config.name = "test";
    config.console = false;
    config.redact = false;
    AedstLogger::init(config, {std::make_shared<spdlog::sinks::ostream_sink_mt>(output)});

    AedstLogger::info("password={}", "hunter2");
    AedstLogger::flush();
    AedstLogger::shutdown();

    EXPECT_NE(output.str().find("password=hunter2"), std::string::npos);
}

TEST(ScrubPiiTest, ReplacesTheAccountNameInProfilePaths) {
    EXPECT_EQ(scrubPii(R"(C:\Users\alice\AppData\Local\AEDST\logs\aedst.log)"),
              R"(C:\Users\<user>\AppData\Local\AEDST\logs\aedst.log)");
    EXPECT_EQ(scrubPii("/home/alice/.config/AEDST/x.db"), "/home/<user>/.config/AEDST/x.db");
    EXPECT_EQ(scrubPii("open '/home/bob' failed"), "open '/home/<user>' failed");
    EXPECT_EQ(scrubPii("two: /home/a/x and C:/Users/b/y"), "two: /home/<user>/x and C:/Users/<user>/y");
}

TEST(ScrubPiiTest, LeavesOtherPathsAndWordsAlone) {
    EXPECT_EQ(scrubPii("/usr/lib/libQt6Core.so"), "/usr/lib/libQt6Core.so");
    EXPECT_EQ(scrubPii("the home screen"), "the home screen");
    EXPECT_EQ(scrubPii("Users are listed"), "Users are listed");
    EXPECT_EQ(scrubPii("/home/"), "/home/");
}

TEST(ScrubPiiTest, AlsoMasksSecretsAndIsIdempotent) {
    const std::string input = R"(token=abc at C:\Users\Alice\x mail alice@example.com)";
    const std::string once = scrubPii(input);
    EXPECT_EQ(once, R"(token=*** at C:\Users\<user>\x mail a***@e***.com)");
    EXPECT_EQ(scrubPii(once), once);
}

} // namespace
} // namespace aedst::core
