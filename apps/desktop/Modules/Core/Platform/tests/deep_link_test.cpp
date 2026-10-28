#include "aedst/platform/deep_link.hpp"

#include <gtest/gtest.h>

#include <cstddef>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace aedst::platform {
namespace {

/// The link prefixes the active routes would declare in the app (here: tasks only).
const std::vector<std::string> kRouteHosts{"tasks"};

core::Outcome<DeepLink> parse(std::string_view url) {
    return parseDeepLink(url, kRouteHosts);
}

struct AcceptCase {
    std::string_view url;
    std::string_view route;
    std::vector<std::pair<std::string, std::string>> params;
};

TEST(DeepLinkTest, AcceptsAllowListedLinks) {
    const std::vector<AcceptCase> cases{
        {"aedst://settings", "settings", {}},
        {"aedst://settings/", "settings", {}},
        {"AEDST://Settings", "settings", {}},
        {"aedst://tasks", "tasks", {}},
        {"aedst://tasks/abc-123_X.y~z", "tasks/abc-123_X.y~z", {}},
        {"aedst://auth/callback?code=abc&state=xyz", "auth/callback", {{"code", "abc"}, {"state", "xyz"}}},
        {"aedst://auth/callback/?code=a", "auth/callback", {{"code", "a"}}},
        {"aedst://tasks?title=Hello%20World", "tasks", {{"title", "Hello World"}}},
        {"aedst://tasks?title=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82",
         "tasks",
         {{"title", "\xD0\x9F\xD1\x80\xD0\xB8\xD0\xB2\xD0\xB5\xD1\x82"}}},
        {"aedst://tasks?q=%2F%25", "tasks", {{"q", "/%"}}},
        {"aedst://tasks?flag", "tasks", {{"flag", ""}}},
        {"aedst://tasks?", "tasks", {}},
    };
    for (const AcceptCase& c : cases) {
        const auto parsed = parse(c.url);
        ASSERT_TRUE(parsed.has_value()) << c.url;
        EXPECT_EQ(parsed->route, c.route) << c.url;
        EXPECT_EQ(parsed->params, c.params) << c.url;
    }
}

TEST(DeepLinkTest, RejectsHostileOrMalformedLinks) {
    const std::vector<std::string> cases{
        "",
        "aedst:",
        "aedst:/tasks",
        "aedst://",
        "http://tasks",
        "javascript:alert(1)",
        "aedst://evil",
        "aedst://tasks/abc/def",
        "aedst://settings/x",
        "aedst://auth",
        "aedst://auth/other",
        "aedst://auth/callback/extra",
        "aedst://tasks/..",
        "aedst://tasks/.",
        "aedst://tasks//",
        "aedst://tasks/a%2Fb",
        "aedst://user@tasks",
        "aedst://tasks:80",
        "aedst://tasks#frag",
        "aedst://tasks?a=1#frag",
        "aedst://tasks with space",
        "aedst://tasks\\x",
        std::string{"aedst://tasks?a=b\x01"},
        std::string{"aedst://tasks?a=b\n"},
        std::string{"aedst://tasks?a=\xC3\xA9"},
        "aedst://tasks?a=%",
        "aedst://tasks?a=%1",
        "aedst://tasks?a=%zz",
        "aedst://tasks?a=%00",
        "aedst://tasks?a=%0A",
        "aedst://tasks?a=%7F",
        "aedst://tasks?a=%FF",
        "aedst://tasks?a=%C3",
        "aedst://tasks?a=%C0%AF",
        "aedst://tasks?a=%ED%A0%80",
        "aedst://tasks?a=1+2",
        "aedst://tasks?a=1&a=2",
        "aedst://tasks?A=1",
        "aedst://tasks?1a=1",
        "aedst://tasks?=1",
        "aedst://tasks?a=1&&b=2",
        "aedst://tasks?a=1&",
        "aedst://tasks?a=b=c",
    };
    for (const std::string& url : cases) {
        EXPECT_FALSE(parse(url).has_value()) << url;
    }
}

TEST(DeepLinkTest, RouteHostsComeFromTheActiveRoutes) {
    EXPECT_FALSE(parse("aedst://media/abc").has_value()) << "no active route claims media";
    const std::vector<std::string> withMedia{"tasks", "media"};
    const auto parsed = parseDeepLink("aedst://media/abc", withMedia);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->route, "media/abc");
    const std::vector<std::string> none;
    EXPECT_FALSE(parseDeepLink("aedst://tasks", none).has_value()) << "no active routes: only the fixed hosts remain";
    EXPECT_TRUE(parseDeepLink("aedst://settings", none).has_value());
    EXPECT_TRUE(parseDeepLink("aedst://auth/callback?code=a", none).has_value());
}

TEST(DeepLinkTest, EnforcesLengthLimits) {
    const std::string longSegment(kMaxDeepLinkSegmentLength + 1, 'a');
    EXPECT_FALSE(parse("aedst://tasks/" + longSegment).has_value());
    EXPECT_TRUE(parse("aedst://tasks/" + std::string(kMaxDeepLinkSegmentLength, 'a')).has_value());

    EXPECT_FALSE(parse("aedst://tasks?a=" + std::string(kMaxDeepLinkValueLength + 1, 'x')).has_value());
    EXPECT_TRUE(parse("aedst://tasks?a=" + std::string(kMaxDeepLinkValueLength, 'x')).has_value());

    EXPECT_FALSE(parse("aedst://tasks?" + std::string(kMaxDeepLinkKeyLength + 1, 'k') + "=1").has_value());

    EXPECT_FALSE(parse("aedst://tasks?a=" + std::string(kMaxDeepLinkLength, 'x')).has_value());
}

TEST(DeepLinkTest, EnforcesParameterCountLimit) {
    std::string atLimit{"aedst://tasks?"};
    for (std::size_t i = 0; i < kMaxDeepLinkParams; ++i) {
        atLimit += (i == 0 ? "p" : "&p") + std::to_string(i) + "=v";
    }
    EXPECT_TRUE(parse(atLimit).has_value());
    EXPECT_FALSE(parse(atLimit + "&extra=v").has_value());
}

TEST(DeepLinkTest, LooksLikeDeepLinkOnlyChecksShape) {
    EXPECT_TRUE(looksLikeDeepLink("aedst://tasks"));
    EXPECT_TRUE(looksLikeDeepLink("AEDST:whatever"));
    EXPECT_FALSE(looksLikeDeepLink("--autostart"));
    EXPECT_FALSE(looksLikeDeepLink("aedst"));
    EXPECT_FALSE(looksLikeDeepLink(""));
}

} // namespace
} // namespace aedst::platform
