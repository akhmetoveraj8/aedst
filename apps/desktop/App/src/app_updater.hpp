#pragma once

#include "aedst/update/startup_health_guard.hpp"
#include "aedst/update/update_state_store.hpp"
#include "aedst/updater/qt_http_fetcher.hpp"
#include "aedst/updater/update_installer.hpp"
#include "aedst/updater/update_service.hpp"

#include <QString>
#include <QTimer>

#include <filesystem>
#include <memory>

namespace aedst::app {

/// Where the updates come from. Empty `manifestUrl` (or no embedded trusted key) = updates are off.
struct UpdaterSettings {
    QString manifestUrl;
    QString feedUrl;
    QString channel{QStringLiteral("stable")};
};

/// Composition of the self-update stack for the App: the startup health guard (safe mode after repeated unhealthy
/// starts), the signed-manifest pipeline and the installer that fits this installation (Velopack when the app was
/// installed by it, report-only otherwise). See docs/adr/0029-delivery-updates-signing.md.
class AppUpdater final {
public:
    /// `service()` is null when updates are disabled; the health guard works either way.
    AppUpdater(const std::filesystem::path& dataDirectory, const UpdaterSettings& settings);
    ~AppUpdater();
    AppUpdater(const AppUpdater&) = delete;
    AppUpdater& operator=(const AppUpdater&) = delete;

    /// Call once the window is shown: starts the schedule and the "this start is healthy" timer.
    void start();
    /// Clean exit: the version demonstrably ran.
    void markHealthy();

    [[nodiscard]] updater::UpdateService* service() noexcept { return service_.get(); }

    [[nodiscard]] bool crashLoop() const noexcept { return crashLoop_; }

private:
    update::StartupHealthGuard guard_;
    bool crashLoop_{false};
    QTimer healthyTimer_;
    updater::QtHttpFetcher fetcher_;
    std::unique_ptr<update::FileUpdateStateStore> store_;
    std::unique_ptr<updater::UpdateInstaller> installer_;
    std::unique_ptr<updater::UpdateService> service_;
};

} // namespace aedst::app
