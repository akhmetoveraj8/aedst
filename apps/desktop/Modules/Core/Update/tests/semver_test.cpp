#include "aedst/update/semver.hpp"

#include <gtest/gtest.h>

#include <compare>
#include <string>
#include <string_view>
#include <vector>

namespace aedst::update {
namespace {

SemVer must(std::string_view text) {
    auto parsed = parseSemVer(text);
    EXPECT_TRUE(parsed.has_value()) << text;
    return parsed ? *parsed : SemVer{};
}

TEST(SemVerTest, ParsesValidVersions) {
    const SemVer plain = must("1.2.3");
    EXPECT_EQ(plain.major, 1U);
    EXPECT_EQ(plain.minor, 2U);
    EXPECT_EQ(plain.patch, 3U);
    EXPECT_TRUE(plain.prerelease.empty());

    const SemVer full = must("10.20.30-rc.1+build.5");
    EXPECT_EQ(full.major, 10U);
    EXPECT_EQ(full.prerelease, (std::vector<std::string>{"rc", "1"}));
    EXPECT_EQ(full.buildMetadata, "build.5");
    EXPECT_EQ(full.toString(), "10.20.30-rc.1+build.5");

    EXPECT_EQ(must("0.0.0").toString(), "0.0.0");
    EXPECT_EQ(must("1.0.0-x-y.z--").prerelease, (std::vector<std::string>{"x-y", "z--"}));
    EXPECT_EQ(must("1.0.0+001").buildMetadata, "001");
}

TEST(SemVerTest, RejectsInvalidVersions) {
    const std::vector<std::string> invalid{
        "",
        "1",
        "1.2",
        "1.2.3.4",
        "v1.2.3",
        "01.2.3",
        "1.02.3",
        "1.2.03",
        "1.2.-3",
        "1.2.x",
        "1..3",
        "1.2.3-",
        "1.2.3-01",
        "1.2.3-a..b",
        "1.2.3-a_b",
        "1.2.3+",
        "1.2.3+a..b",
        "1.2.3+a b",
        " 1.2.3",
        "1.2.3 ",
        "1234567890123456789.0.0",
        std::string(65, '1'),
    };
    for (const std::string& text : invalid) {
        EXPECT_FALSE(parseSemVer(text).has_value()) << text;
    }
}

TEST(SemVerTest, OrdersPerSemverSpecification) {
    // Strictly ascending chain from semver.org section 11, extended.
    const std::vector<std::string> ascending{
        "0.9.9",      "1.0.0-alpha",  "1.0.0-alpha.1", "1.0.0-alpha.beta",
        "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1",
        "1.0.0",      "1.0.1",        "1.1.0",         "1.2.9",
        "1.2.10",     "1.10.0",       "2.0.0-0",       "2.0.0",
        "10.0.0",
    };
    for (std::size_t i = 0; i < ascending.size(); ++i) {
        for (std::size_t j = 0; j < ascending.size(); ++j) {
            const auto order = compareSemVer(must(ascending[i]), must(ascending[j]));
            if (i < j) {
                EXPECT_TRUE(order < 0) << ascending[i] << " < " << ascending[j];
            } else if (i > j) {
                EXPECT_TRUE(order > 0) << ascending[i] << " > " << ascending[j];
            } else {
                EXPECT_TRUE(order == 0) << ascending[i];
            }
        }
    }
}

TEST(SemVerTest, BuildMetadataIsIgnoredForPrecedence) {
    EXPECT_TRUE(compareSemVer(must("1.0.0+a"), must("1.0.0+b")) == 0);
    EXPECT_TRUE(compareSemVer(must("1.0.0-rc.1+x"), must("1.0.0-rc.1")) == 0);
}

TEST(SemVerTest, NumericIdentifiersSortBeforeAlphanumeric) {
    EXPECT_TRUE(compareSemVer(must("1.0.0-1"), must("1.0.0-a")) < 0);
    EXPECT_TRUE(compareSemVer(must("1.0.0-99999999999999999999"), must("1.0.0-100000000000000000000")) < 0);
    EXPECT_TRUE(compareSemVer(must("1.0.0-a"), must("1.0.0-B")) > 0); // ASCII order: 'a' (97) > 'B' (66)
}

} // namespace
} // namespace aedst::update
