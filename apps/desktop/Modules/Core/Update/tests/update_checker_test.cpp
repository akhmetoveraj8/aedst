#include "aedst/update/update_checker.hpp"
#include "test_support.hpp"

#include <gtest/gtest.h>

#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace aedst::update {
namespace {

using test_support::generateKeyPair;
using test_support::manifestJson;
using test_support::signedEnvelope;
using test_support::TestKeyPair;

class FakeFetcher final : public HttpFetcher {
public:
    [[nodiscard]] core::Outcome<std::string> fetch(std::string_view url, std::size_t /*maxBytes*/) override {
        lastUrl = std::string{url};
        ++calls;
        if (failing) {
            return core::fail(core::Error::unavailable("offline"));
        }
        return body;
    }

    std::string body;
    bool failing{false};
    std::string lastUrl;
    int calls{0};
};

class InMemoryStateStore final : public UpdateStateStore {
public:
    [[nodiscard]] core::Outcome<UpdateState> load() const override { return state; }

    [[nodiscard]] core::VoidOutcome save(const UpdateState& next) override {
        state = next;
        ++saves;
        return core::ok();
    }

    UpdateState state;
    int saves{0};
};

class UpdateCheckerTest : public ::testing::Test {
protected:
    UpdateCheckerTest() {
        TrustedKey key;
        key.keyId = "k1";
        key.publicKey = keys_.publicKey;
        verifier_ = std::make_unique<ManifestVerifier>(std::vector<TrustedKey>{key});
        config_.manifestUrl = "https://updates.aedst.com/stable.json";
        config_.installedVersion = "1.5.0";
        config_.platform = "windows";
        config_.arch = "x86_64";
    }

    void serve(const std::string& manifest) { fetcher_.body = signedEnvelope(keys_, "k1", manifest); }

    [[nodiscard]] core::Outcome<std::optional<UpdateOffer>> check() {
        UpdateChecker checker{config_, fetcher_, *verifier_, store_};
        return checker.check();
    }

    TestKeyPair keys_ = generateKeyPair();
    std::unique_ptr<ManifestVerifier> verifier_;
    UpdateCheckerConfig config_;
    FakeFetcher fetcher_;
    InMemoryStateStore store_;
};

TEST_F(UpdateCheckerTest, OffersANewerVersion) {
    serve(manifestJson("2.0.0", "stable", 1'700'000'000, "1.0.0"));
    const auto result = check();
    ASSERT_TRUE(result.has_value()) << result.error().message;
    ASSERT_TRUE(result->has_value());
    const UpdateOffer& offer = **result;
    EXPECT_EQ(offer.manifest.version, "2.0.0");
    EXPECT_EQ(offer.artifact.platform, "windows");
    EXPECT_EQ(offer.artifact.url, "https://downloads.aedst.com/2.0.0/aedst-setup.exe");
    EXPECT_FALSE(offer.mandatory);
    EXPECT_FALSE(offer.isDowngrade);
    EXPECT_EQ(fetcher_.lastUrl, "https://updates.aedst.com/stable.json");
}

TEST_F(UpdateCheckerTest, FlagsMandatoryUpdates) {
    serve(manifestJson("2.0.0", "stable", 1'700'000'000, "1.6.0"));
    const auto result = check();
    ASSERT_TRUE(result.has_value() && result->has_value());
    EXPECT_TRUE((*result)->mandatory);
}

TEST_F(UpdateCheckerTest, SameVersionMeansUpToDate) {
    serve(manifestJson("1.5.0"));
    const auto result = check();
    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->has_value());
}

TEST_F(UpdateCheckerTest, BuildMetadataDoesNotCreateAnUpdate) {
    config_.installedVersion = "1.5.0+local.build";
    serve(manifestJson("1.5.0"));
    const auto result = check();
    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->has_value());
}

TEST_F(UpdateCheckerTest, PrereleaseIsOlderThanItsRelease) {
    config_.installedVersion = "2.0.0-rc.1";
    serve(manifestJson("2.0.0"));
    const auto result = check();
    ASSERT_TRUE(result.has_value() && result->has_value());
    EXPECT_EQ((*result)->manifest.version, "2.0.0");
}

/// manifestJson() with "rollback":true spliced in.
std::string rollbackManifest(const std::string& version, std::int64_t publishedAt,
                             const std::string& channel = "stable") {
    std::string json = manifestJson(version, channel, publishedAt, "1.0.0");
    json.replace(json.find('{') + 1, 0, "\"rollback\":true,");
    return json;
}

TEST_F(UpdateCheckerTest, ASignedRollbackMovesClientsBackAsAMandatoryDowngrade) {
    config_.installedVersion = "1.6.0";
    serve(manifestJson("1.6.0", "stable", 1'700'000'000, "1.0.0")); // the release that turned out bad
    ASSERT_TRUE(check().has_value());

    serve(rollbackManifest("1.5.0", 1'700'000'100));
    const auto result = check();

    ASSERT_TRUE(result.has_value()) << result.error().message;
    ASSERT_TRUE(result->has_value());
    const UpdateOffer& offer = **result;
    EXPECT_EQ(offer.manifest.version, "1.5.0");
    EXPECT_TRUE(offer.rollback);
    EXPECT_TRUE(offer.isDowngrade);
    EXPECT_TRUE(offer.mandatory) << "a withdrawn release is not something the user may keep running";
}

TEST_F(UpdateCheckerTest, ARollbackStillNeedsAFresherPublishedAtThanAnythingSeen) {
    serve(manifestJson("1.6.0", "stable", 1'700'000'500, "1.0.0"));
    config_.installedVersion = "1.6.0";
    ASSERT_TRUE(check().has_value());

    serve(rollbackManifest("1.5.0", 1'700'000'100)); // an old rollback manifest, replayed later
    const auto result = check();

    ASSERT_FALSE(result.has_value());
    EXPECT_NE(result.error().message.find("replay"), std::string::npos);
}

TEST_F(UpdateCheckerTest, ARollbackToTheInstalledVersionIsUpToDate) {
    config_.installedVersion = "1.5.0";
    serve(rollbackManifest("1.5.0", 1'700'000'100));
    const auto result = check();
    ASSERT_TRUE(result.has_value());
    EXPECT_FALSE(result->has_value());
}

TEST_F(UpdateCheckerTest, AfterARollbackNormalReleasesFlowAgain) {
    config_.installedVersion = "1.6.0";
    serve(manifestJson("1.6.0", "stable", 1'700'000'000, "1.0.0"));
    ASSERT_TRUE(check().has_value());
    serve(rollbackManifest("1.5.0", 1'700'000'100));
    ASSERT_TRUE(check().has_value());

    config_.installedVersion = "1.5.0";
    serve(manifestJson("1.6.1", "stable", 1'700'000'200, "1.0.0")); // the fixed release
    const auto result = check();

    ASSERT_TRUE(result.has_value()) << result.error().message;
    ASSERT_TRUE(result->has_value());
    EXPECT_EQ((*result)->manifest.version, "1.6.1");
    EXPECT_FALSE((*result)->isDowngrade);
    EXPECT_FALSE((*result)->rollback);
}

TEST_F(UpdateCheckerTest, ARollbackOnAnotherChannelIsIgnored) {
    config_.installedVersion = "1.6.0";
    serve(rollbackManifest("1.5.0", 1'700'000'100, "beta"));
    const auto result = check();
    ASSERT_FALSE(result.has_value()) << "channel confusion must not let a beta rollback move stable clients";
}

TEST_F(UpdateCheckerTest, RejectsAnOlderManifestAsRollback) {
    serve(manifestJson("1.4.0"));
    const auto result = check();
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::InvalidInput);
}

TEST_F(UpdateCheckerTest, AllowsDowngradeOnlyWhenFlagged) {
    config_.allowDowngrade = true;
    serve(manifestJson("1.4.0"));
    const auto result = check();
    ASSERT_TRUE(result.has_value() && result->has_value());
    EXPECT_TRUE((*result)->isDowngrade);
}

TEST_F(UpdateCheckerTest, RejectsAReplayedOlderManifest) {
    serve(manifestJson("2.0.0", "stable", 1'700'000'500));
    ASSERT_TRUE(check().has_value());
    EXPECT_EQ(store_.state.lastSeenPublishedAt, 1'700'000'500);
    EXPECT_EQ(store_.state.lastSeenVersion, "2.0.0");

    // A validly signed but older manifest (e.g. one with a known vulnerability).
    serve(manifestJson("2.0.0", "stable", 1'700'000'100));
    const auto replay = check();
    ASSERT_FALSE(replay.has_value());
    EXPECT_EQ(store_.state.lastSeenPublishedAt, 1'700'000'500) << "state must not move backwards";
}

TEST_F(UpdateCheckerTest, RejectsAVersionOlderThanOneAlreadySeen) {
    serve(manifestJson("3.0.0", "stable", 1'700'000'500));
    ASSERT_TRUE(check().has_value());

    // Newer publishedAt but an older version: a rollback dressed as a fresh manifest.
    config_.installedVersion = "1.0.0";
    serve(manifestJson("2.5.0", "stable", 1'700'000'900));
    EXPECT_FALSE(check().has_value());
}

TEST_F(UpdateCheckerTest, AcceptsARepublishedManifestWithTheSameTimestamp) {
    serve(manifestJson("2.0.0", "stable", 1'700'000'500));
    ASSERT_TRUE(check().has_value());
    EXPECT_TRUE(check().has_value());
}

TEST_F(UpdateCheckerTest, PersistsStateOnlyAfterVerification) {
    fetcher_.body = signedEnvelope(keys_, "k1", manifestJson("2.0.0")) + "tampered";
    EXPECT_FALSE(check().has_value());
    EXPECT_EQ(store_.saves, 0);

    serve(manifestJson("2.0.0"));
    ASSERT_TRUE(check().has_value());
    EXPECT_EQ(store_.saves, 1);
}

TEST_F(UpdateCheckerTest, RejectsManifestsSignedByAnUntrustedKey) {
    const TestKeyPair attacker = generateKeyPair();
    fetcher_.body = signedEnvelope(attacker, "k1", manifestJson("9.0.0"));
    const auto result = check();
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::Unauthenticated);
    EXPECT_EQ(store_.saves, 0);
}

TEST_F(UpdateCheckerTest, RejectsAManifestFromAnotherChannel) {
    serve(manifestJson("2.0.0", "beta"));
    EXPECT_FALSE(check().has_value());
}

TEST_F(UpdateCheckerTest, RejectsNonHttpsManifestUrlWithoutFetching) {
    config_.manifestUrl = "http://updates.aedst.com/stable.json";
    serve(manifestJson("2.0.0"));
    EXPECT_FALSE(check().has_value());
    EXPECT_EQ(fetcher_.calls, 0);

    config_.manifestUrl = "https://user:pw@updates.aedst.com/stable.json";
    EXPECT_FALSE(check().has_value());
    EXPECT_EQ(fetcher_.calls, 0);
}

TEST_F(UpdateCheckerTest, RejectsBadConfiguration) {
    serve(manifestJson("2.0.0"));
    config_.installedVersion = "not-a-version";
    EXPECT_FALSE(check().has_value());
    config_.installedVersion = "1.5.0";
    config_.platform.clear();
    EXPECT_FALSE(check().has_value());
    EXPECT_EQ(fetcher_.calls, 0);
}

TEST_F(UpdateCheckerTest, PropagatesFetchFailures) {
    fetcher_.failing = true;
    const auto result = check();
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::Unavailable);
}

TEST_F(UpdateCheckerTest, RejectsOversizeResponses) {
    serve(manifestJson("2.0.0"));
    config_.maxManifestBytes = 16;
    EXPECT_FALSE(check().has_value());
}

TEST_F(UpdateCheckerTest, ReportsMissingArtifactForThisPlatform) {
    config_.platform = "linux";
    config_.arch = "arm64";
    serve(manifestJson("2.0.0"));
    const auto result = check();
    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().code, core::ErrorCode::NotFound);
}

} // namespace
} // namespace aedst::update
