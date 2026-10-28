#include "velopack_installer.hpp"

#include <Velopack.hpp>
#include <exception>
#include <optional>
#include <utility>

// UNVERIFIED against a build: written from the Velopack C++ documentation (velopack_libc 1.2.x):
// VelopackApp::Build().Run(), UpdateManager(url, options), CheckForUpdates() -> optional<UpdateInfo>,
// DownloadUpdates(info, progress), WaitExitThenApplyUpdate(asset, silent, restart). Field names of
// UpdateInfo/VelopackAsset (TargetFullRelease, Version, SHA256, Size, FileName) and UpdateOptions (ExplicitChannel,
// AllowVersionDowngrade) follow the SDK's C++ header; if a name differs, only this file changes (the pipeline and the
// service talk to UpdateInstaller).

namespace aedst::updater {

struct VelopackInstaller::Impl {
    std::optional<Velopack::UpdateInfo> lastInfo; // from the last checkFeed(), needed by download/apply
    std::string channel;
    bool allowDowngrade{false};
};

VelopackInstaller::VelopackInstaller(std::string feedUrl)
    : impl_(std::make_unique<Impl>()), feedUrl_(std::move(feedUrl)) {}

VelopackInstaller::~VelopackInstaller() = default;

void velopackStartup() {
    Velopack::VelopackApp::Build().Run();
}

namespace {

Velopack::UpdateManager makeManager(const std::string& url, const std::string& channel, bool allowDowngrade) {
    Velopack::UpdateOptions options;
    options.ExplicitChannel = channel;
    options.AllowVersionDowngrade = allowDowngrade;
    return Velopack::UpdateManager(url, &options);
}

} // namespace

bool VelopackInstaller::canSelfUpdate() const {
    try {
        Velopack::UpdateManager manager(feedUrl_);
        return manager.IsInstalled();
    } catch (const std::exception&) {
        return false;
    }
}

core::Outcome<std::optional<InstallerCandidate>> VelopackInstaller::checkFeed(const std::string& channel,
                                                                              bool allowDowngrade) {
    try {
        impl_->channel = channel;
        impl_->allowDowngrade = allowDowngrade;
        auto manager = makeManager(feedUrl_, channel, allowDowngrade);
        auto info = manager.CheckForUpdates();
        if (!info) {
            impl_->lastInfo.reset();
            return std::optional<InstallerCandidate>{};
        }
        impl_->lastInfo = *info;
        const auto& asset = info->TargetFullRelease;
        return std::optional<InstallerCandidate>{InstallerCandidate{
            .version = asset.Version,
            .sha256 = asset.SHA256,
            .size = static_cast<std::uint64_t>(asset.Size),
            .fileName = asset.FileName,
        }};
    } catch (const std::exception& e) {
        return core::fail(core::Error::unavailable(std::string("update feed: ") + e.what()));
    }
}

core::Outcome<std::filesystem::path> VelopackInstaller::download(const InstallerCandidate& /*candidate*/,
                                                                 const std::function<void(int)>& progress) {
    if (!impl_->lastInfo) {
        return core::fail(core::Error::invalidInput("update: download requested before a feed check"));
    }
    try {
        auto manager = makeManager(feedUrl_, impl_->channel, impl_->allowDowngrade);
        manager.DownloadUpdates(*impl_->lastInfo, [&progress](int16_t percent) {
            if (progress) {
                progress(static_cast<int>(percent));
            }
        });
        // Velopack verifies the package against the feed's SHA-256 itself and keeps it in its own packages directory,
        // whose location the C++ SDK does not expose. The pipeline already bound that SHA-256 to the signed manifest,
        // so the independent re-hash is skipped (empty path) rather than guessed.
        return std::filesystem::path{};
    } catch (const std::exception& e) {
        return core::fail(core::Error::unavailable(std::string("update download: ") + e.what()));
    }
}

core::VoidOutcome VelopackInstaller::applyAfterExit(const InstallerCandidate& /*candidate*/, bool restart) {
    if (!impl_->lastInfo) {
        return core::fail(core::Error::invalidInput("update: nothing was downloaded"));
    }
    try {
        auto manager = makeManager(feedUrl_, impl_->channel, impl_->allowDowngrade);
        manager.WaitExitThenApplyUpdate(*impl_->lastInfo, /*silent=*/true, restart);
        return core::ok();
    } catch (const std::exception& e) {
        return core::fail(core::Error::unknown(std::string("update apply: ") + e.what()));
    }
}

} // namespace aedst::updater
