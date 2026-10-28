#pragma once

#include "aedst/updater/update_installer.hpp"

namespace aedst::updater {

/// The installer of every build that cannot replace itself: portable runs, deb/rpm (the package manager updates them),
/// Flatpak (the Flatpak repo does) and builds without the Velopack SDK. The pipeline then verifies the signed manifest
/// and the UI announces "version X is available"; nothing is downloaded or installed here.
class ReportOnlyInstaller final : public UpdateInstaller {
public:
    [[nodiscard]] bool canSelfUpdate() const override { return false; }

    [[nodiscard]] core::Outcome<std::optional<InstallerCandidate>> checkFeed(const std::string& /*channel*/,
                                                                             bool /*allowDowngrade*/) override {
        return core::fail(core::Error::unknown("this installation is updated by its package manager"));
    }

    [[nodiscard]] core::Outcome<std::filesystem::path> download(const InstallerCandidate& /*candidate*/,
                                                                const std::function<void(int)>& /*progress*/) override {
        return core::fail(core::Error::unknown("this installation is updated by its package manager"));
    }

    [[nodiscard]] core::VoidOutcome applyAfterExit(const InstallerCandidate& /*candidate*/, bool /*restart*/) override {
        return core::fail(core::Error::unknown("this installation is updated by its package manager"));
    }
};

} // namespace aedst::updater
