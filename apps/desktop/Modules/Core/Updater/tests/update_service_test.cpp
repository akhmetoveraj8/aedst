#include "aedst/testing/fake_http_server.hpp"
#include "aedst/testing/test_main.hpp"
#include "aedst/updater/update_service.hpp"
#include "updater_test_support.hpp"

#include <QSignalSpy>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>
#include <vector>

namespace aedst::updater {
namespace {

using namespace std::chrono_literals;
using namespace test_support;
using aedst::testing::waitUntil;

constexpr char kPackage[] = "the bytes of the signed package";

class UpdateServiceTest : public ::testing::Test {
protected:
    UpdateServiceTest() : installer(dir.path()) {
        config.manifestUrl = "https://updates.aedst.com/stable.json";
        config.installedVersion = "1.5.0";
        config.platform = "windows";
        config.arch = "x86_64";
        installer.packageContent = kPackage;
    }

    std::unique_ptr<UpdateService> makeService(UpdateService::Timing timing = {.firstCheckDelay = 1h, .interval = 1h}) {
        update::TrustedKey key;
        key.keyId = "k1";
        key.publicKey = keys.publicKey;
        return std::make_unique<UpdateService>(config, fetcher, update::ManifestVerifier({key}), store, installer,
                                               timing);
    }

    void serve(const std::string& version, const std::string& minSupported = "1.0.0",
               std::int64_t publishedAt = 1'700'000'000, bool rollback = false) {
        std::string json =
            manifestJson(version, "stable", publishedAt, minSupported, sha256Hex(kPackage), sizeof(kPackage) - 1);
        if (rollback) {
            json.replace(json.find('{') + 1, 0, "\"rollback\":true,");
        }
        fetcher.serve(signedEnvelope(keys, "k1", json));
        installer.feed = InstallerCandidate{.version = version,
                                            .sha256 = sha256Hex(kPackage),
                                            .size = sizeof(kPackage) - 1,
                                            .fileName = "aedst-" + version + "-full.nupkg"};
    }

    bool waitForState(UpdateService& service, UpdateService::State wanted) {
        return waitUntil([&] { return service.state() == wanted; }, 10s);
    }

    TempDir dir;
    TestKeyPair keys = generateKeyPair();
    update::UpdateCheckerConfig config;
    FakeFetcher fetcher;
    MemoryStateStore store;
    FakeInstaller installer;
};

TEST_F(UpdateServiceTest, ANewVersionEndsReadyToInstallAndTheUiIsTold) {
    serve("2.0.0");
    const auto service = makeService();
    QSignalSpy ready(service.get(), &UpdateService::updateReady);

    EXPECT_EQ(service->state(), UpdateService::State::Idle);
    service->checkNow();
    EXPECT_EQ(service->state(), UpdateService::State::Checking);
    ASSERT_TRUE(waitForState(*service, UpdateService::State::ReadyToInstall));

    EXPECT_EQ(service->availableVersion(), QStringLiteral("2.0.0"));
    EXPECT_FALSE(service->mandatory());
    ASSERT_EQ(ready.count(), 1);
    EXPECT_EQ(ready.takeFirst().at(0).toString(), QStringLiteral("2.0.0"));
    EXPECT_EQ(installer.applied.load(), 0);
}

TEST_F(UpdateServiceTest, InstallAppliesAfterExitWithARestart) {
    serve("2.0.0");
    const auto service = makeService();
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::ReadyToInstall));

    EXPECT_TRUE(service->installAndRestart());

    EXPECT_EQ(installer.applied.load(), 1);
    EXPECT_EQ(installer.lastAppliedVersion, "2.0.0");
    EXPECT_TRUE(installer.lastRestart);
}

TEST_F(UpdateServiceTest, InstallDoesNothingBeforeAnUpdateIsReady) {
    const auto service = makeService();
    EXPECT_FALSE(service->installAndRestart());
    EXPECT_EQ(installer.applied.load(), 0);
}

TEST_F(UpdateServiceTest, UpToDateIsReported) {
    serve("1.5.0");
    const auto service = makeService();
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::UpToDate));
    EXPECT_TRUE(service->availableVersion().isEmpty());
}

TEST_F(UpdateServiceTest, AMandatoryUpdateIsFlaggedAndCannotBeDismissed) {
    installer.selfUpdatable = false;
    serve("2.0.0", /*minSupported=*/"1.9.0");
    const auto service = makeService();
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::Available));

    EXPECT_TRUE(service->mandatory());
    service->dismiss();
    EXPECT_EQ(service->state(), UpdateService::State::Available);
}

TEST_F(UpdateServiceTest, AnInstallThatCannotUpdateItselfShowsTheOfferAndCanBeDismissed) {
    installer.selfUpdatable = false;
    serve("2.0.0");
    const auto service = makeService();
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::Available));
    EXPECT_FALSE(service->releaseNotesUrl().isEmpty());
    EXPECT_FALSE(service->installAndRestart()) << "nothing downloaded, nothing to apply";

    service->dismiss();
    EXPECT_EQ(service->state(), UpdateService::State::Idle);
    EXPECT_EQ(installer.downloads.load(), 0);
}

TEST_F(UpdateServiceTest, AFeedThatDisagreesWithTheSignatureFailsTheRun) {
    serve("2.0.0");
    installer.feed->sha256 = std::string(64, 'c');
    const auto service = makeService();
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::Failed));

    EXPECT_NE(service->errorMessage().indexOf(QStringLiteral("signed manifest")), -1);
    EXPECT_EQ(installer.downloads.load(), 0);
}

TEST_F(UpdateServiceTest, ANetworkFailureEndsInFailedAndIsRetriedOnTheSchedule) {
    serve("2.0.0");
    fetcher.failing = true;
    const auto service = makeService({.firstCheckDelay = 20ms, .interval = 60ms});
    service->start();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::Failed));
    const int firstCalls = fetcher.calls.load();

    fetcher.failing = false; // connectivity is back
    ASSERT_TRUE(waitForState(*service, UpdateService::State::ReadyToInstall));
    EXPECT_GT(fetcher.calls.load(), firstCalls);
}

TEST_F(UpdateServiceTest, OnlyOneRunAtATime) {
    serve("2.0.0");
    const auto service = makeService();
    service->checkNow();
    service->checkNow();
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::ReadyToInstall));
    EXPECT_EQ(fetcher.calls.load(), 1);
}

TEST_F(UpdateServiceTest, AReadyUpdateIsNotCheckedAgain) {
    serve("2.0.0");
    const auto service = makeService({.firstCheckDelay = 1h, .interval = 30ms});
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::ReadyToInstall));
    const int calls = fetcher.calls.load();

    waitUntil([] { return false; }, 200ms); // several intervals pass
    EXPECT_EQ(fetcher.calls.load(), calls);
    EXPECT_EQ(service->state(), UpdateService::State::ReadyToInstall);
}

TEST_F(UpdateServiceTest, SafeModeRefusesToApplyOrdinaryUpdatesButAcceptsASignedRollback) {
    serve("2.0.0");
    const auto service = makeService();
    service->setCrashLoop(true);
    EXPECT_TRUE(service->crashLoop());
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::ReadyToInstall));
    EXPECT_FALSE(service->installAndRestart()) << "do not move a broken install to yet another build";
    EXPECT_EQ(installer.applied.load(), 0);

    // The operators publish a signed rollback to the last good version.
    config.installedVersion = "2.0.0";
    const auto rollbackService = makeService();
    rollbackService->setCrashLoop(true);
    serve("1.9.0", "1.0.0", 1'700'000'500, /*rollback=*/true);
    rollbackService->checkNow();
    ASSERT_TRUE(waitForState(*rollbackService, UpdateService::State::ReadyToInstall));
    EXPECT_TRUE(rollbackService->isRollback());
    EXPECT_TRUE(rollbackService->mandatory());
    EXPECT_TRUE(rollbackService->installAndRestart());
    EXPECT_EQ(installer.lastAppliedVersion, "1.9.0");
}

TEST_F(UpdateServiceTest, ProgressIsReportedWhileDownloading) {
    serve("2.0.0");
    const auto service = makeService();
    QSignalSpy progress(service.get(), &UpdateService::progressChanged);
    service->checkNow();
    ASSERT_TRUE(waitForState(*service, UpdateService::State::ReadyToInstall));
    EXPECT_GE(progress.count(), 1);
    EXPECT_EQ(service->progress(), 100);
}

TEST_F(UpdateServiceTest, StopCancelsTheSchedule) {
    serve("2.0.0");
    const auto service = makeService({.firstCheckDelay = 30ms, .interval = 30ms});
    service->start();
    service->stop();
    waitUntil([] { return false; }, 150ms);
    EXPECT_EQ(fetcher.calls.load(), 0);
    EXPECT_EQ(service->state(), UpdateService::State::Idle);
}

} // namespace
} // namespace aedst::updater

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
