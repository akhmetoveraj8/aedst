#include "aedst/updater/update_pipeline.hpp"
#include "updater_test_support.hpp"

#include <gtest/gtest.h>

#include <memory>
#include <string>
#include <vector>

namespace aedst::updater {
namespace {

using namespace test_support;

constexpr char kPackage[] = "the bytes of the signed package";

class UpdatePipelineTest : public ::testing::Test {
protected:
    UpdatePipelineTest() : installer(dir.path()) {
        update::TrustedKey key;
        key.keyId = "k1";
        key.publicKey = keys.publicKey;
        verifier = std::make_unique<update::ManifestVerifier>(std::vector<update::TrustedKey>{key});
        config.manifestUrl = "https://updates.aedst.com/stable.json";
        config.installedVersion = "1.5.0";
        config.platform = "windows";
        config.arch = "x86_64";
        installer.packageContent = kPackage;
    }

    /// Serves a signed manifest for `version` whose artifact is the fake package.
    void serve(const std::string& version, std::int64_t publishedAt = 1'700'000'000, bool rollback = false) {
        std::string json =
            manifestJson(version, "stable", publishedAt, "1.0.0", sha256Hex(kPackage), sizeof(kPackage) - 1);
        if (rollback) {
            json.replace(json.find('{') + 1, 0, "\"rollback\":true,");
        }
        fetcher.serve(signedEnvelope(keys, "k1", json));
    }

    /// The feed offers exactly what the manifest names.
    void feedMatches(const std::string& version) {
        installer.feed = InstallerCandidate{.version = version,
                                            .sha256 = sha256Hex(kPackage),
                                            .size = sizeof(kPackage) - 1,
                                            .fileName = "aedst-" + version + "-full.nupkg"};
    }

    core::Outcome<std::optional<UpdateOutcome>> run(const PipelineEvents& events = {}) {
        return runUpdatePipeline(config, fetcher, *verifier, store, installer, events);
    }

    TempDir dir;
    TestKeyPair keys = generateKeyPair();
    std::unique_ptr<update::ManifestVerifier> verifier;
    update::UpdateCheckerConfig config;
    FakeFetcher fetcher;
    MemoryStateStore store;
    FakeInstaller installer;
};

TEST_F(UpdatePipelineTest, ADownloadedAndVerifiedUpdateIsReadyToInstall) {
    serve("2.0.0");
    feedMatches("2.0.0");

    const auto result = run();

    ASSERT_TRUE(result.has_value()) << result.error().message;
    ASSERT_TRUE(result->has_value());
    const UpdateOutcome& outcome = **result;
    EXPECT_TRUE(outcome.readyToInstall());
    EXPECT_EQ(outcome.candidate->version, "2.0.0");
    EXPECT_EQ(outcome.offer.manifest.version, "2.0.0");
    EXPECT_TRUE(std::filesystem::exists(outcome.package));
    EXPECT_EQ(installer.lastChannel, "stable");
    EXPECT_FALSE(installer.lastAllowDowngrade);
    EXPECT_EQ(installer.applied.load(), 0) << "the pipeline never installs by itself";
}

TEST_F(UpdatePipelineTest, NothingHappensWhenTheSignedManifestSaysUpToDate) {
    serve("1.5.0");
    const auto result = run();
    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->has_value());
    EXPECT_EQ(installer.feedChecks.load(), 0);
    EXPECT_EQ(installer.downloads.load(), 0);
}

TEST_F(UpdatePipelineTest, AFeedWithAnotherVersionIsRefusedBeforeAnyDownload) {
    serve("2.0.0");
    feedMatches("2.0.1"); // the feed was tampered with or points at a different release

    const auto result = run();

    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::Unauthenticated);
    EXPECT_NE(result.error().message.find("signed manifest"), std::string::npos);
    EXPECT_EQ(installer.downloads.load(), 0);
}

TEST_F(UpdatePipelineTest, AFeedWithAnotherHashIsRefused) {
    serve("2.0.0");
    feedMatches("2.0.0");
    installer.feed->sha256 = std::string(64, 'b');

    const auto result = run();

    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::Unauthenticated);
    EXPECT_EQ(installer.downloads.load(), 0);
}

TEST_F(UpdatePipelineTest, AFeedWithAnotherSizeIsRefused) {
    serve("2.0.0");
    feedMatches("2.0.0");
    installer.feed->size += 1;
    EXPECT_FALSE(run().has_value());
    EXPECT_EQ(installer.downloads.load(), 0);
}

TEST_F(UpdatePipelineTest, TheHashComparisonIsCaseInsensitive) {
    serve("2.0.0");
    feedMatches("2.0.0");
    for (char& c : installer.feed->sha256) {
        c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    }
    EXPECT_TRUE(run().has_value());
}

TEST_F(UpdatePipelineTest, BuildMetadataInTheFeedVersionDoesNotMatter) {
    serve("2.0.0");
    feedMatches("2.0.0+build.7");
    EXPECT_TRUE(run().has_value());
}

TEST_F(UpdatePipelineTest, AFeedWithoutThePackageIsAnError) {
    serve("2.0.0");
    installer.feed.reset();
    const auto result = run();
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::NotFound);
}

TEST_F(UpdatePipelineTest, ATamperedDownloadFailsTheIndependentHashCheck) {
    serve("2.0.0");
    feedMatches("2.0.0");
    installer.packageContent = "different bytes of the same length!!!";

    const auto result = run();

    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(installer.downloads.load(), 1);
    EXPECT_EQ(installer.applied.load(), 0);
}

TEST_F(UpdatePipelineTest, WhenTheInstallerDoesNotExposeTheFileItsOwnVerificationIsTrusted) {
    serve("2.0.0");
    feedMatches("2.0.0");
    installer.writeFile = false;

    const auto result = run();

    ASSERT_TRUE(result.has_value()) << result.error().message;
    ASSERT_TRUE(result->has_value());
    EXPECT_TRUE((*result)->package.empty());
    EXPECT_TRUE((*result)->readyToInstall());
}

TEST_F(UpdatePipelineTest, AnInstallThatCannotUpdateItselfOnlyReportsTheSignedOffer) {
    serve("2.0.0");
    installer.selfUpdatable = false; // deb/rpm/Flatpak/portable

    const auto result = run();

    ASSERT_TRUE(result.has_value()) << result.error().message;
    ASSERT_TRUE(result->has_value());
    EXPECT_FALSE((*result)->readyToInstall());
    EXPECT_EQ((*result)->offer.manifest.version, "2.0.0");
    EXPECT_EQ(installer.feedChecks.load(), 0);
    EXPECT_EQ(installer.downloads.load(), 0);
}

TEST_F(UpdatePipelineTest, ASignedRollbackAsksTheFeedForADowngrade) {
    config.installedVersion = "1.6.0";
    serve("1.6.0");
    ASSERT_TRUE(run().has_value());
    serve("1.5.0", 1'700'000'100, /*rollback=*/true);
    feedMatches("1.5.0");

    const auto result = run();

    ASSERT_TRUE(result.has_value()) << result.error().message;
    ASSERT_TRUE(result->has_value());
    EXPECT_TRUE((*result)->offer.rollback);
    EXPECT_TRUE((*result)->offer.mandatory);
    EXPECT_TRUE(installer.lastAllowDowngrade);
}

TEST_F(UpdatePipelineTest, AnUnsignedOrForgedManifestNeverReachesTheFeed) {
    fetcher.serve(signedEnvelope(generateKeyPair(), "k1", manifestJson("2.0.0"))); // signed with the wrong key
    const auto result = run();
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(installer.feedChecks.load(), 0);
}

TEST_F(UpdatePipelineTest, FailuresOfTheFeedDownloadAndManifestFetchAreReported) {
    serve("2.0.0");
    feedMatches("2.0.0");
    installer.feedError = core::Error::unavailable("feed offline");
    EXPECT_EQ(run().error().code, core::ErrorCode::Unavailable);

    installer.feedError.reset();
    installer.downloadError = core::Error::unavailable("connection reset");
    EXPECT_EQ(run().error().message, "connection reset");

    installer.downloadError.reset();
    fetcher.failing = true;
    EXPECT_FALSE(run().has_value());
}

TEST_F(UpdatePipelineTest, StagesAndProgressAreReportedInOrderAndClamped) {
    serve("2.0.0");
    feedMatches("2.0.0");
    std::vector<PipelineStage> stages;
    std::vector<int> percents;
    PipelineEvents events;
    events.stage = [&stages](PipelineStage stage) { stages.push_back(stage); };
    events.progress = [&percents](int percent) { percents.push_back(percent); };

    ASSERT_TRUE(run(events).has_value());

    EXPECT_EQ(stages, (std::vector<PipelineStage>{PipelineStage::CheckingManifest, PipelineStage::CheckingFeed,
                                                  PipelineStage::Downloading, PipelineStage::Verifying}));
    EXPECT_EQ(percents, (std::vector<int>{0, 40, 100, 100})) << "150 is clamped to 100";
}

TEST(SameVersionTest, UsesSemverPrecedence) {
    EXPECT_TRUE(sameVersion("2.0.0", "2.0.0+abc"));
    EXPECT_FALSE(sameVersion("2.0.0", "2.0.1"));
    EXPECT_FALSE(sameVersion("2.0.0-rc.1", "2.0.0"));
    EXPECT_FALSE(sameVersion("not-a-version", "not-a-version"));
}

} // namespace
} // namespace aedst::updater
