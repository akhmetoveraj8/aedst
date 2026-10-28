#include "app_updater.hpp"

#include "aedst/logging/log_categories.hpp"
#include "aedst/update/manifest_verifier.hpp"
#include "aedst/updater/report_only_installer.hpp"
#if defined(AEDST_HAS_VELOPACK)
#include "velopack_installer.hpp"
#endif

#include <QSysInfo>
#include <QTimer>

#include <chrono>
#include <utility>

namespace aedst::app {
namespace {

using namespace std::chrono_literals;

constexpr auto kHealthyAfter = 30s;

std::string platformName() {
#if defined(_WIN32)
    return "windows";
#else
    return "linux";
#endif
}

std::string archName() {
    const QString arch = QSysInfo::currentCpuArchitecture();
    if (arch == QLatin1String("x86_64")) {
        return "x86_64";
    }
    if (arch == QLatin1String("arm64") || arch == QLatin1String("aarch64")) {
        return "arm64";
    }
    return arch.toStdString();
}

} // namespace

AppUpdater::AppUpdater(const std::filesystem::path& dataDirectory, const UpdaterSettings& settings)
    : guard_(dataDirectory / "update" / "health", AEDST_VERSION) {
    if (auto report = guard_.recordStart(); report) {
        crashLoop_ = report->crashLoop;
        if (report->crashLoop) {
            qCCritical(lcUpdater, "Version %s never became healthy in %d starts in a row (last good: %s); safe mode",
                       AEDST_VERSION, report->unhealthyStarts,
                       report->lastKnownGood.empty() ? "unknown" : report->lastKnownGood.c_str());
        } else if (report->firstStartOfThisVersion) {
            qCInfo(lcUpdater, "First start of %s (last good: %s)", AEDST_VERSION,
                   report->lastKnownGood.empty() ? "none" : report->lastKnownGood.c_str());
        }
    } else {
        qCWarning(lcUpdater, "Could not record the start: %s", report.error().message.c_str());
    }

    if (settings.manifestUrl.isEmpty()) {
        qCInfo(lcUpdater, "Updates are off: no manifest URL configured");
        return;
    }
    auto keys = update::embeddedTrustedKeys();
    if (keys.empty()) {
        qCWarning(lcUpdater, "Updates are off: this build embeds no update signing key (AEDST_UPDATE_PUBLIC_KEYS)");
        return;
    }

#if defined(AEDST_HAS_VELOPACK)
    if (!settings.feedUrl.isEmpty()) {
        installer_ = std::make_unique<updater::VelopackInstaller>(settings.feedUrl.toStdString());
    }
#endif
    if (!installer_) {
        installer_ = std::make_unique<updater::ReportOnlyInstaller>();
    }

    update::UpdateCheckerConfig config;
    config.manifestUrl = settings.manifestUrl.toStdString();
    config.installedVersion = AEDST_VERSION;
    config.channel = settings.channel.toStdString();
    config.platform = platformName();
    config.arch = archName();

    store_ = std::make_unique<update::FileUpdateStateStore>(dataDirectory / "update" / "state");
    service_ = std::make_unique<updater::UpdateService>(
        std::move(config), fetcher_, update::ManifestVerifier(std::move(keys)), *store_, *installer_);
    service_->setCrashLoop(crashLoop_);
    qCInfo(lcUpdater, "Updates on: channel %s, installer %s", qUtf8Printable(settings.channel),
           installer_->canSelfUpdate() ? "self-updating" : "report only");
}

AppUpdater::~AppUpdater() = default;

void AppUpdater::start() {
    if (service_) {
        service_->start();
    }
    // The guard counted this start as unhealthy; it becomes healthy once the app has stayed up and usable.
    healthyTimer_.setSingleShot(true);
    healthyTimer_.setTimerType(Qt::VeryCoarseTimer);
    QObject::connect(&healthyTimer_, &QTimer::timeout, [this]() { markHealthy(); });
    healthyTimer_.start(kHealthyAfter);
}

void AppUpdater::markHealthy() {
    if (auto marked = guard_.markHealthy(); !marked) {
        qCWarning(lcUpdater, "Could not record a healthy start: %s", marked.error().message.c_str());
    }
}

} // namespace aedst::app
