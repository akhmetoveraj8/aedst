#include "aedst/capabilities/capabilities_service.hpp"
#include "aedst/persistence/database_worker.hpp"
#include "capability_test_support.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <functional>
#include <future>
#include <memory>
#include <optional>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace aedst::capabilities {
namespace {

using namespace testsupport;

class CapabilitiesServiceTest : public ::testing::Test {
protected:
    CapabilitiesServiceTest() : remote_(std::make_shared<ScriptedRemote>()), cache_(std::make_shared<MemoryCache>()) {}

    std::unique_ptr<CapabilitiesService> makeService(ClientBuild build = fixtureBuild("1.3.0")) {
        auto service = std::make_unique<CapabilitiesService>(
            CapabilitiesService::Dependencies{.remote = remote_, .cache = cache_, .build = std::move(build)});
        QObject::connect(service.get(), &CapabilitiesService::capabilitiesChanged, [this] { ++changed_; });
        QObject::connect(service.get(), &CapabilitiesService::upgradeRequired, [this] { ++required_; });
        QObject::connect(service.get(), &CapabilitiesService::upgradeRecommended, [this] { ++recommended_; });
        return service;
    }

    std::shared_ptr<ScriptedRemote> remote_;
    std::shared_ptr<MemoryCache> cache_;
    int changed_{0};
    int required_{0};
    int recommended_{0};
};

TEST_F(CapabilitiesServiceTest, WithoutAnyAnswerTheSourceIsUnknownButDefaultsApply) {
    auto service = makeService();
    EXPECT_FALSE(service->current().isKnown()) << "unknown keeps run-time plugins waiting (PluginManager)";
    EXPECT_TRUE(service->isEnabled("tasks"));
    EXPECT_FALSE(service->isEnabled("admin"));
    EXPECT_FALSE(service->hasAnswer());
}

TEST_F(CapabilitiesServiceTest, AFetchedAnswerBecomesCurrentIsCachedAndAnnounced) {
    auto service = makeService();
    service->start();
    ServerCapabilities answer;
    addFeature(answer, "search", false);
    remote_->answer(answer);

    EXPECT_TRUE(service->current().isKnown());
    EXPECT_FALSE(service->current().hasCapability("search"));
    EXPECT_TRUE(service->current().hasCapability("tasks"));
    EXPECT_EQ(changed_, 1);
    ASSERT_TRUE(cache_->stored.has_value());
    ServerCapabilities roundTrip;
    ASSERT_TRUE(roundTrip.ParseFromString(*cache_->stored));
    EXPECT_FALSE(roundTrip.features().at("search").enabled());
}

TEST_F(CapabilitiesServiceTest, ACachedAnswerIsUsedBeforeTheFetchFinishesAndWhenItFails) {
    ServerCapabilities cached;
    addFeature(cached, "admin", true);
    cache_->stored = cached.SerializeAsString();

    auto service = makeService();
    service->start();
    EXPECT_TRUE(service->isEnabled("admin")) << "last known applies while the request is in flight";
    remote_->fail();
    EXPECT_TRUE(service->isEnabled("admin"));
    EXPECT_EQ(cache_->saveCount, 0) << "a cached answer is not written back";
}

TEST_F(CapabilitiesServiceTest, AFailedFetchNeverClearsAFetchedAnswer) {
    auto service = makeService();
    service->start();
    ServerCapabilities answer;
    addFeature(answer, "media", false);
    remote_->answer(answer);

    service->refresh();
    remote_->fail();
    EXPECT_FALSE(service->isEnabled("media"));
    EXPECT_EQ(remote_->fetchCount, 2);
}

TEST_F(CapabilitiesServiceTest, AnUnreadableCacheEntryIsIgnored) {
    cache_->stored = std::string("\xff\xff garbage");
    auto service = makeService();
    service->start();
    EXPECT_FALSE(service->hasAnswer());
    EXPECT_TRUE(service->isEnabled("tasks"));
}

TEST_F(CapabilitiesServiceTest, ALateCacheLoadDoesNotOverrideAFetchedAnswer) {
    auto service = makeService();
    service->refresh(); // fetch before start(): the answer is already applied when the cache is read
    ServerCapabilities fresh;
    addFeature(fresh, "search", false);
    remote_->answer(fresh);

    ServerCapabilities stale;
    addFeature(stale, "search", true);
    cache_->stored = stale.SerializeAsString();
    service->start();
    EXPECT_FALSE(service->isEnabled("search"));
}

TEST_F(CapabilitiesServiceTest, OnlyOneFetchRunsAtATime) {
    auto service = makeService();
    service->refresh();
    service->refresh();
    EXPECT_EQ(remote_->fetchCount, 1);
    remote_->fail();
    service->refresh();
    EXPECT_EQ(remote_->fetchCount, 2);
}

TEST_F(CapabilitiesServiceTest, BelowTheMinimumVersionRequestsTheUpgradeScreenOnce) {
    auto service = makeService(fixtureBuild("1.1.0"));
    service->start();
    ServerCapabilities answer;
    setWindow(answer, "android", "1.2.0", "1.5.0");
    remote_->answer(answer);
    service->refresh();
    ServerCapabilities again;
    setWindow(again, "android", "1.2.0", "1.5.0");
    remote_->answer(again);

    EXPECT_EQ(required_, 1);
    EXPECT_EQ(recommended_, 0);
    EXPECT_EQ(service->versionAdvice().advice, UpdateAdvice::Required);
}

TEST_F(CapabilitiesServiceTest, BelowTheRecommendedVersionOnlyRecommends) {
    auto service = makeService(fixtureBuild("1.3.0"));
    service->start();
    ServerCapabilities answer;
    setWindow(answer, "android", "1.2.0", "1.5.0");
    remote_->answer(answer);

    EXPECT_EQ(required_, 0);
    EXPECT_EQ(recommended_, 1);
    EXPECT_EQ(service->versionAdvice().recommended, "1.5.0");
}

TEST_F(CapabilitiesServiceTest, VisibleFeaturesListsShownCoarseIdsAndSubCapabilitiesSorted) {
    auto service = makeService();
    service->start();
    ServerCapabilities answer;
    addFeature(answer, "search", false);
    addFeature(answer, "media.uploads", true);
    addFeature(answer, "teleport", true);
    remote_->answer(answer);

    const std::vector<std::string> expected{"auth", "media", "media.uploads", "notifications", "tasks"};
    EXPECT_EQ(service->visibleFeatures(), expected);
}

TEST_F(CapabilitiesServiceTest, ADestroyedServiceIsNeverCalledBack) {
    auto service = makeService();
    service->start();
    service.reset();
    ServerCapabilities answer;
    remote_->answer(answer); // must not touch the freed service
    SUCCEED();
}

// The production cache: the `kv` table on the database thread. Completions are delivered on that thread, which is
// enough here because the test only waits on a future.
TEST(SqliteCapabilityCacheTest, RoundTripsTheSerializedAnswerThroughTheDatabaseThread) {
    const auto directory =
        std::filesystem::temp_directory_path() /
        ("aedst-capabilities-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(directory);
    {
        auto worker = std::make_shared<persistence::DatabaseWorker>(directory / "test.sqlite3");
        SqliteCapabilityCache cache(worker, [](std::function<void()> work) { work(); });

        std::promise<std::optional<std::string>> empty;
        cache.load([&empty](core::Outcome<std::optional<std::string>> loaded) {
            empty.set_value(loaded ? *loaded : std::optional<std::string>{"error"});
        });
        EXPECT_FALSE(empty.get_future().get().has_value());

        ServerCapabilities answer;
        addFeature(answer, "media", false);
        std::promise<bool> saved;
        cache.save(answer.SerializeAsString(),
                   [&saved](core::Outcome<void> result) { saved.set_value(result.has_value()); });
        ASSERT_TRUE(saved.get_future().get());

        std::promise<std::optional<std::string>> loaded;
        cache.load([&loaded](core::Outcome<std::optional<std::string>> result) {
            loaded.set_value(result ? *result : std::optional<std::string>{});
        });
        const auto stored = loaded.get_future().get();
        ASSERT_TRUE(stored.has_value());
        ServerCapabilities parsed;
        ASSERT_TRUE(parsed.ParseFromString(*stored));
        EXPECT_FALSE(parsed.features().at("media").enabled());
    }
    std::error_code ignored;
    std::filesystem::remove_all(directory, ignored);
}

} // namespace
} // namespace aedst::capabilities
