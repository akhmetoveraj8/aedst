#pragma once

// Private to AedstUpdater; compiled only when the Velopack C/C++ SDK was found (AEDST_ENABLE_VELOPACK).

#include "aedst/updater/update_installer.hpp"

#include <memory>
#include <string>

namespace aedst::updater {

/// UpdateInstaller over the Velopack SDK (velopack_libc: Velopack::UpdateManager).
///
/// Velopack replaces the application from a feed it reads over https (`releases.<channel>.json` plus the package
/// files). It checks the package against the SHA-256 in that feed; it has no publisher signature of its own for
/// packages, which is why the pipeline binds the feed to the Ed25519-signed manifest before anything is downloaded (see
/// update_pipeline.hpp). Windows installers/binaries are additionally Authenticode-signed at packaging time (`vpk pack
/// --signParams ...`).
///
/// The first thing the application does in main() must be `Velopack::VelopackApp::Build().Run()` (hooks and restart
/// after an update): see velopackStartup() below.
class VelopackInstaller final : public UpdateInstaller {
public:
    /// `feedUrl`: base https URL that serves releases.<channel>.json and the packages.
    explicit VelopackInstaller(std::string feedUrl);
    ~VelopackInstaller() override;

    [[nodiscard]] bool canSelfUpdate() const override;
    [[nodiscard]] core::Outcome<std::optional<InstallerCandidate>> checkFeed(const std::string& channel,
                                                                             bool allowDowngrade) override;
    [[nodiscard]] core::Outcome<std::filesystem::path> download(const InstallerCandidate& candidate,
                                                                const std::function<void(int)>& progress) override;
    [[nodiscard]] core::VoidOutcome applyAfterExit(const InstallerCandidate& candidate, bool restart) override;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    std::string feedUrl_;
};

/// Runs Velopack's startup hooks. Must be the first call in main(); it may exit or restart the process (install,
/// update, uninstall hooks). Safe to call in an uninstalled/dev run (no-op).
void velopackStartup();

} // namespace aedst::updater
