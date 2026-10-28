#include "aedst/update/manifest.hpp"
#include "test_support.hpp"

#include <gtest/gtest.h>

#include <string>
#include <utility>
#include <vector>

namespace aedst::update {
namespace {

using test_support::manifestJson;

std::string replaceFirst(std::string text, const std::string& from, const std::string& to) {
    const auto pos = text.find(from);
    EXPECT_NE(pos, std::string::npos) << from;
    if (pos != std::string::npos) {
        text.replace(pos, from.size(), to);
    }
    return text;
}

TEST(ManifestTest, ParsesAValidManifest) {
    const auto manifest =
        parseManifest(manifestJson("2.1.0-rc.1", "beta", 1'700'000'123, "1.5.0", std::string(64, 'b'), 4096));
    ASSERT_TRUE(manifest.has_value());
    EXPECT_EQ(manifest->version, "2.1.0-rc.1");
    EXPECT_EQ(manifest->channel, "beta");
    EXPECT_EQ(manifest->minSupportedVersion, "1.5.0");
    EXPECT_EQ(manifest->publishedAt, 1'700'000'123);
    EXPECT_EQ(manifest->releaseNotesUrl, "https://aedst.com/releases/2.1.0-rc.1");
    ASSERT_EQ(manifest->artifacts.size(), 2U);
    EXPECT_EQ(manifest->artifacts[0].platform, "windows");
    EXPECT_EQ(manifest->artifacts[0].arch, "x86_64");
    EXPECT_EQ(manifest->artifacts[0].size, 4096U);
    EXPECT_EQ(manifest->artifacts[0].sha256, std::string(64, 'b'));
    EXPECT_EQ(manifest->artifacts[0].signature, "detached");

    const ArtifactInfo* linuxArtifact = findArtifact(*manifest, "linux", "x86_64");
    ASSERT_NE(linuxArtifact, nullptr);
    EXPECT_TRUE(linuxArtifact->signature.empty());
    EXPECT_EQ(findArtifact(*manifest, "linux", "arm64"), nullptr);
    EXPECT_EQ(findArtifact(*manifest, "windows", "arm64"), nullptr);
}

TEST(ManifestTest, RollbackDefaultsToFalseAndMustBeABoolean) {
    const auto plain = parseManifest(test_support::manifestJson());
    ASSERT_TRUE(plain.has_value());
    EXPECT_FALSE(plain->rollback);

    std::string withRollback = test_support::manifestJson();
    withRollback.replace(withRollback.find('{') + 1, 0, "\"rollback\":true,");
    const auto parsed = parseManifest(withRollback);
    ASSERT_TRUE(parsed.has_value()) << parsed.error().message;
    EXPECT_TRUE(parsed->rollback);

    std::string notBool = test_support::manifestJson();
    notBool.replace(notBool.find('{') + 1, 0, "\"rollback\":\"yes\",");
    EXPECT_FALSE(parseManifest(notBool).has_value());
}

TEST(ManifestTest, MinSupportedVersionIsOptional) {
    const std::string json = replaceFirst(manifestJson(), "\"minSupportedVersion\":\"1.0.0\",", "");
    const auto manifest = parseManifest(json);
    ASSERT_TRUE(manifest.has_value());
    EXPECT_EQ(manifest->minSupportedVersion, "0.0.0");
}

TEST(ManifestTest, RejectsInvalidManifests) {
    const std::string good = manifestJson();
    const std::vector<std::pair<std::string, std::string>> mutations{
        {"\"version\":\"2.0.0\"", "\"version\":\"2.0\""},
        {"\"version\":\"2.0.0\"", "\"version\":2"},
        {"\"channel\":\"stable\"", "\"channel\":\"Stable!\""},
        {"\"channel\":\"stable\"", "\"channel\":\"\""},
        {"\"releaseNotesUrl\":\"https://aedst.com/releases/2.0.0\"", "\"releaseNotesUrl\":\"http://aedst.com/r\""},
        {"\"minSupportedVersion\":\"1.0.0\"", "\"minSupportedVersion\":\"x\""},
        {"\"publishedAt\":1700000000", "\"publishedAt\":0"},
        {"\"publishedAt\":1700000000", "\"publishedAt\":1.5"},
        {"\"publishedAt\":1700000000", "\"publishedAt\":\"1700000000\""},
        {"\"platform\":\"windows\"", "\"platform\":\"Win Dows\""},
        {"\"arch\":\"x86_64\"", "\"arch\":\"\""},
        {"https://downloads.aedst.com/2.0.0/aedst-setup.exe", "http://downloads.aedst.com/2.0.0/aedst-setup.exe"},
        {"https://downloads.aedst.com/2.0.0/aedst-setup.exe", "https://user@downloads.aedst.com/x"},
        {"\"sha256\":\"" + std::string(64, 'a') + "\"", "\"sha256\":\"" + std::string(63, 'a') + "\""},
        {"\"sha256\":\"" + std::string(64, 'a') + "\"", "\"sha256\":\"" + std::string(64, 'A') + "\""},
        {"\"sha256\":\"" + std::string(64, 'a') + "\"", "\"sha256\":\"" + std::string(64, 'g') + "\""},
        {"\"size\":1234,\"signature\"", "\"size\":0,\"signature\""},
        {"\"size\":1234,\"signature\"", "\"size\":-5,\"signature\""},
        {"\"size\":1234,\"signature\"", "\"size\":99999999999,\"signature\""},
        {"\"size\":1234,\"signature\"", "\"size\":\"1234\",\"signature\""},
        {"\"platform\":\"linux\"", "\"platform\":\"windows\""}, // duplicate windows/x86_64
        {"\"artifacts\":[", "\"artifacts\":{},\"x\":["},
    };
    for (const auto& [from, to] : mutations) {
        const auto manifest = parseManifest(replaceFirst(good, from, to));
        EXPECT_FALSE(manifest.has_value()) << "mutation " << from << " -> " << to;
    }
}

TEST(ManifestTest, RejectsNonObjectsAndEmptyArtifacts) {
    EXPECT_FALSE(parseManifest("").has_value());
    EXPECT_FALSE(parseManifest("[]").has_value());
    EXPECT_FALSE(parseManifest("not json").has_value());
    EXPECT_FALSE(parseManifest("{}").has_value());
    std::string noArtifacts = manifestJson();
    noArtifacts = noArtifacts.substr(0, noArtifacts.find(",\"artifacts\"")) + ",\"artifacts\":[]}";
    EXPECT_FALSE(parseManifest(noArtifacts).has_value());
}

} // namespace
} // namespace aedst::update
