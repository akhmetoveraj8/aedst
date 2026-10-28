#include "aedst/update/artifact_verifier.hpp"
#include "aedst/update/manifest.hpp"
#include "aedst/update/update_state_store.hpp"
#include "test_support.hpp"

#include <gtest/gtest.h>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <ios>
#include <string>
#include <system_error>
#include <vector>

namespace aedst::update {
namespace {

namespace fs = std::filesystem;

class ArtifactVerifierTest : public ::testing::Test {
protected:
    void SetUp() override {
        std::error_code ec;
        const auto* info = ::testing::UnitTest::GetInstance()->current_test_info();
        root_ =
            fs::temp_directory_path(ec) / (std::string{"aedst_update_"} + info->test_suite_name() + "_" + info->name());
        fs::remove_all(root_, ec);
        fs::create_directories(root_, ec);
    }

    void TearDown() override {
        std::error_code ec;
        fs::remove_all(root_, ec);
    }

    fs::path write(const std::string& name, const std::string& content) const {
        const fs::path path = root_ / name;
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        out.write(content.data(), static_cast<std::streamsize>(content.size()));
        return path;
    }

    [[nodiscard]] static ExpectedArtifact expectedFor(const std::string& content) {
        return ExpectedArtifact{test_support::sha256Hex(content), content.size()};
    }

    fs::path root_;
};

TEST_F(ArtifactVerifierTest, AcceptsAMatchingFile) {
    const std::string content = "installer bytes";
    const auto path = write("a.bin", content);
    EXPECT_TRUE(ArtifactVerifier::verifyFile(path, expectedFor(content)).has_value());
}

TEST_F(ArtifactVerifierTest, AcceptsFilesLargerThanOneChunk) {
    std::string content(200 * 1024 + 17, '\0');
    for (std::size_t i = 0; i < content.size(); ++i) {
        content[i] = static_cast<char>(i % 251U);
    }
    const auto path = write("big.bin", content);
    EXPECT_TRUE(ArtifactVerifier::verifyFile(path, expectedFor(content)).has_value());
}

TEST_F(ArtifactVerifierTest, RejectsAModifiedFile) {
    const std::string content = "installer bytes";
    const ExpectedArtifact expected = expectedFor(content);
    std::string tampered = content;
    tampered[3] = static_cast<char>(tampered[3] ^ 0x01);
    const auto path = write("a.bin", tampered);
    const auto result = ArtifactVerifier::verifyFile(path, expected);
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::Unauthenticated);
}

TEST_F(ArtifactVerifierTest, RejectsSizeMismatches) {
    const std::string content = "installer bytes";
    const ExpectedArtifact expected = expectedFor(content);

    const auto larger = write("larger.bin", content + "x");
    const auto shorter = write("shorter.bin", content.substr(0, content.size() - 1));
    EXPECT_FALSE(ArtifactVerifier::verifyFile(larger, expected).has_value());
    EXPECT_FALSE(ArtifactVerifier::verifyFile(shorter, expected).has_value());
}

TEST_F(ArtifactVerifierTest, RejectsInvalidExpectations) {
    const std::string content = "installer bytes";
    const auto path = write("a.bin", content);

    ExpectedArtifact zeroSize = expectedFor(content);
    zeroSize.size = 0;
    EXPECT_FALSE(ArtifactVerifier::verifyFile(path, zeroSize).has_value());

    ExpectedArtifact oversize = expectedFor(content);
    oversize.size = kMaxArtifactBytes + 1;
    EXPECT_FALSE(ArtifactVerifier::verifyFile(path, oversize).has_value());

    ExpectedArtifact badHex = expectedFor(content);
    badHex.sha256 = "xyz";
    EXPECT_FALSE(ArtifactVerifier::verifyFile(path, badHex).has_value());

    ExpectedArtifact shortHex = expectedFor(content);
    shortHex.sha256 = std::string(62, 'a');
    EXPECT_FALSE(ArtifactVerifier::verifyFile(path, shortHex).has_value());
}

TEST_F(ArtifactVerifierTest, MissingFileIsAnError) {
    const auto result = ArtifactVerifier::verifyFile(root_ / "nope.bin", ExpectedArtifact{std::string(64, 'a'), 10});
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::Storage);
}

TEST_F(ArtifactVerifierTest, AcceptsUppercaseExpectedDigest) {
    const std::string content = "installer bytes";
    ExpectedArtifact expected = expectedFor(content);
    for (char& c : expected.sha256) {
        if (c >= 'a' && c <= 'f') {
            c = static_cast<char>(c - 'a' + 'A');
        }
    }
    EXPECT_TRUE(ArtifactVerifier::verifyFile(write("a.bin", content), expected).has_value());
}

TEST(ConstantTimeEqualsTest, ComparesBytes) {
    const std::vector<std::uint8_t> a{1, 2, 3};
    const std::vector<std::uint8_t> b{1, 2, 3};
    const std::vector<std::uint8_t> c{1, 2, 4};
    const std::vector<std::uint8_t> d{1, 2};
    EXPECT_TRUE(constantTimeEquals(a, b));
    EXPECT_FALSE(constantTimeEquals(a, c));
    EXPECT_FALSE(constantTimeEquals(a, d));
    EXPECT_TRUE(constantTimeEquals(std::vector<std::uint8_t>{}, std::vector<std::uint8_t>{}));
}

TEST_F(ArtifactVerifierTest, FileUpdateStateStoreRoundTripsAndToleratesCorruption) {
    FileUpdateStateStore store{root_ / "nested" / "update_state"};
    const auto initial = store.load();
    ASSERT_TRUE(initial.has_value());
    EXPECT_EQ(*initial, UpdateState{});

    const UpdateState saved{1'700'000'000, "2.0.0-rc.1"};
    ASSERT_TRUE(store.save(saved).has_value());
    EXPECT_EQ(*FileUpdateStateStore{root_ / "nested" / "update_state"}.load(), saved);

    write("corrupt", "garbage without equals");
    EXPECT_EQ(*FileUpdateStateStore{root_ / "corrupt"}.load(), UpdateState{});
    write("badversion", "publishedAt=5\nversion=not-semver\n");
    EXPECT_EQ(*FileUpdateStateStore{root_ / "badversion"}.load(), UpdateState{});
}

} // namespace
} // namespace aedst::update
