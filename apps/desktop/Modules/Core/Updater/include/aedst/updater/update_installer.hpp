#pragma once

#include "aedst/core/outcome.hpp"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>

namespace aedst::updater {

/// What the installer's own release feed says about the package it would install. The pipeline compares it with the
/// Ed25519-signed manifest before anything is downloaded: the feed is only a transport, the signed manifest is the
/// authority on which exact package (version, SHA-256, size) may be installed.
struct InstallerCandidate {
    std::string version;
    std::string sha256; // hex, any case
    std::uint64_t size{0};
    std::string fileName;
};

/// Port to the thing that downloads and installs a package (Velopack in production, a fake in tests).
/// All calls are blocking: run them on a worker thread.
class UpdateInstaller {
public:
    UpdateInstaller() = default;
    UpdateInstaller(const UpdateInstaller&) = delete;
    UpdateInstaller& operator=(const UpdateInstaller&) = delete;
    UpdateInstaller(UpdateInstaller&&) = delete;
    UpdateInstaller& operator=(UpdateInstaller&&) = delete;
    virtual ~UpdateInstaller() = default;

    /// True only when this process runs from an installation the installer manages (a Velopack-installed app).
    /// Portable, development, deb/rpm and Flatpak runs cannot replace themselves; they are told to update through
    /// their package manager (the pipeline then only reports the signed offer).
    [[nodiscard]] virtual bool canSelfUpdate() const = 0;

    /// The candidate in the release feed of `channel`. nullopt = the feed has nothing different from what is installed.
    /// `allowDowngrade` is passed when the signed manifest is an explicit rollback.
    [[nodiscard]] virtual core::Outcome<std::optional<InstallerCandidate>> checkFeed(const std::string& channel,
                                                                                     bool allowDowngrade) = 0;

    /// Downloads the candidate (progress 0..100). Returns where the package file is when the installer exposes it, so
    /// the pipeline can hash it independently; an empty path means "verified by the installer only".
    [[nodiscard]] virtual core::Outcome<std::filesystem::path> download(const InstallerCandidate& candidate,
                                                                        const std::function<void(int)>& progress) = 0;

    /// Installs the downloaded package when this process exits and, if asked, starts the new version. Returns at once;
    /// the caller must then quit the application.
    [[nodiscard]] virtual core::VoidOutcome applyAfterExit(const InstallerCandidate& candidate, bool restart) = 0;
};

} // namespace aedst::updater
