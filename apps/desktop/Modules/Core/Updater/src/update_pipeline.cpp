#include "aedst/updater/update_pipeline.hpp"

#include "aedst/core/logger.hpp"
#include "aedst/update/artifact_verifier.hpp"
#include "aedst/update/semver.hpp"

#include <algorithm>
#include <cctype>
#include <utility>

namespace aedst::updater {
namespace {

[[nodiscard]] std::string lowered(std::string text) {
    std::ranges::transform(text, text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

void notify(const PipelineEvents& events, PipelineStage stage) {
    if (events.stage) {
        events.stage(stage);
    }
}

} // namespace

bool sameVersion(const std::string& a, const std::string& b) {
    const auto left = update::parseSemVer(a);
    const auto right = update::parseSemVer(b);
    return left && right && update::compareSemVer(*left, *right) == 0;
}

core::Outcome<std::optional<UpdateOutcome>>
runUpdatePipeline(const update::UpdateCheckerConfig& config, update::HttpFetcher& fetcher,
                  const update::ManifestVerifier& verifier, update::UpdateStateStore& stateStore,
                  UpdateInstaller& installer, const PipelineEvents& events) {
    // 1. The signed manifest decides whether there is an update at all.
    notify(events, PipelineStage::CheckingManifest);
    update::UpdateChecker checker(config, fetcher, verifier, stateStore);
    auto checked = checker.check();
    if (!checked) {
        return core::fail(checked.error());
    }
    if (!*checked) {
        return std::optional<UpdateOutcome>{};
    }
    UpdateOutcome outcome;
    outcome.offer = std::move(**checked);

    if (!installer.canSelfUpdate()) {
        // deb/rpm/Flatpak/portable/dev: report the signed offer, the package manager does the rest.
        return std::optional<UpdateOutcome>{std::move(outcome)};
    }

    // 2. The installer's feed must say exactly what the signature says.
    notify(events, PipelineStage::CheckingFeed);
    const update::UpdateOffer& offer = outcome.offer;
    auto feed = installer.checkFeed(config.channel, offer.isDowngrade);
    if (!feed) {
        return core::fail(feed.error());
    }
    if (!*feed) {
        return core::fail(core::Error::notFound("update: the release feed has no package for the signed manifest"));
    }
    const InstallerCandidate& candidate = **feed;
    if (!sameVersion(candidate.version, offer.manifest.version) ||
        lowered(candidate.sha256) != lowered(offer.artifact.sha256) || candidate.size != offer.artifact.size) {
        core::AedstLogger::error("update: SECURITY: the release feed offers {} (sha256 {}) but the signed manifest "
                                 "names {} (sha256 {}); refusing",
                                 candidate.version, candidate.sha256, offer.manifest.version, offer.artifact.sha256);
        return core::fail(core::Error::unauthenticated(
            "update: the release feed does not match the signed manifest; the update was refused"));
    }

    // 3. Download, then check the file ourselves against the signed values.
    notify(events, PipelineStage::Downloading);
    auto downloaded = installer.download(candidate, [&events](int percent) {
        if (events.progress) {
            events.progress(std::clamp(percent, 0, 100));
        }
    });
    if (!downloaded) {
        return core::fail(downloaded.error());
    }
    notify(events, PipelineStage::Verifying);
    if (!downloaded->empty()) {
        if (auto verified = update::ArtifactVerifier::verifyFile(
                *downloaded, update::ExpectedArtifact{.sha256 = offer.artifact.sha256, .size = offer.artifact.size});
            !verified) {
            return core::fail(verified.error());
        }
    }
    outcome.package = std::move(*downloaded);
    outcome.candidate = candidate;
    return std::optional<UpdateOutcome>{std::move(outcome)};
}

} // namespace aedst::updater
