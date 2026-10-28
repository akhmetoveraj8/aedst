#pragma once

#include "aedst/update/http_fetcher.hpp"
#include "aedst/update/update_state_store.hpp"
#include "aedst/updater/update_installer.hpp"
#include "test_support.hpp" // Ed25519 keys, signed envelopes, manifest builder (Modules/Core/Update/tests)

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <system_error>

namespace aedst::updater::test_support {

using update::test_support::generateKeyPair;
using update::test_support::manifestJson;
using update::test_support::sha256Hex;
using update::test_support::signedEnvelope;
using update::test_support::TestKeyPair;

/// Scratch directory removed on destruction.
class TempDir final {
public:
    TempDir() {
        static std::atomic<unsigned> counter{0};
        path_ = std::filesystem::temp_directory_path() /
                ("aedst-updater-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + "-" +
                 std::to_string(counter.fetch_add(1)));
        std::filesystem::create_directories(path_);
    }

    TempDir(const TempDir&) = delete;
    TempDir& operator=(const TempDir&) = delete;

    ~TempDir() {
        std::error_code ignored;
        std::filesystem::remove_all(path_, ignored);
    }

    [[nodiscard]] const std::filesystem::path& path() const { return path_; }

private:
    std::filesystem::path path_;
};

class FakeFetcher final : public update::HttpFetcher {
public:
    [[nodiscard]] core::Outcome<std::string> fetch(std::string_view /*url*/, std::size_t /*maxBytes*/) override {
        const std::scoped_lock lock(mutex);
        ++calls;
        if (failing) {
            return core::fail(core::Error::unavailable("offline"));
        }
        return body;
    }

    void serve(std::string envelope) {
        const std::scoped_lock lock(mutex);
        body = std::move(envelope);
    }

    std::mutex mutex;
    std::string body;
    bool failing{false};
    std::atomic<int> calls{0};
};

class MemoryStateStore final : public update::UpdateStateStore {
public:
    [[nodiscard]] core::Outcome<update::UpdateState> load() const override {
        const std::scoped_lock lock(mutex);
        return state;
    }

    [[nodiscard]] core::VoidOutcome save(const update::UpdateState& next) override {
        const std::scoped_lock lock(mutex);
        state = next;
        return core::ok();
    }

    mutable std::mutex mutex;
    update::UpdateState state;
};

/// Scripted installer. `packageContent` is what "download" writes into `downloadDir`.
class FakeInstaller final : public UpdateInstaller {
public:
    explicit FakeInstaller(std::filesystem::path downloadDir) : downloadDir_(std::move(downloadDir)) {}

    [[nodiscard]] bool canSelfUpdate() const override { return selfUpdatable; }

    [[nodiscard]] core::Outcome<std::optional<InstallerCandidate>> checkFeed(const std::string& channel,
                                                                             bool allowDowngrade) override {
        feedChecks.fetch_add(1);
        lastChannel = channel;
        lastAllowDowngrade = allowDowngrade;
        if (feedError) {
            return core::fail(*feedError);
        }
        return feed;
    }

    [[nodiscard]] core::Outcome<std::filesystem::path> download(const InstallerCandidate& candidate,
                                                                const std::function<void(int)>& progress) override {
        downloads.fetch_add(1);
        for (const int percent : {0, 40, 100, 150}) {
            progress(percent);
        }
        if (downloadError) {
            return core::fail(*downloadError);
        }
        if (!writeFile) {
            return std::filesystem::path{};
        }
        const std::filesystem::path file = downloadDir_ / candidate.fileName;
        std::ofstream(file, std::ios::binary) << packageContent;
        return file;
    }

    [[nodiscard]] core::VoidOutcome applyAfterExit(const InstallerCandidate& candidate, bool restart) override {
        applied.fetch_add(1);
        lastAppliedVersion = candidate.version;
        lastRestart = restart;
        return applyError ? core::VoidOutcome(core::fail(*applyError)) : core::ok();
    }

    bool selfUpdatable{true};
    bool writeFile{true};
    std::optional<InstallerCandidate> feed;
    std::optional<core::Error> feedError;
    std::optional<core::Error> downloadError;
    std::optional<core::Error> applyError;
    std::string packageContent{"package-bytes"};

    std::atomic<int> feedChecks{0};
    std::atomic<int> downloads{0};
    std::atomic<int> applied{0};
    std::string lastChannel;
    bool lastAllowDowngrade{false};
    std::string lastAppliedVersion;
    bool lastRestart{false};

private:
    std::filesystem::path downloadDir_;
};

} // namespace aedst::updater::test_support
