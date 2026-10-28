#include "aedst/crash/crash_uploader.hpp"

#include "aedst/core/logger.hpp"
#include "file_util.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace aedst::crash {
namespace {

constexpr std::int64_t kDaySeconds = 24 * 60 * 60;
constexpr std::uintmax_t kMaxLogBytes = 64 * 1024;
constexpr std::string_view kUploadLogName = "upload_log.txt";

std::int64_t toEpochSeconds(std::chrono::system_clock::time_point when) {
    return std::chrono::duration_cast<std::chrono::seconds>(when.time_since_epoch()).count();
}

std::string contentTypeFor(const std::filesystem::path& path) {
    if (path.extension() == ".txt") {
        return "text/plain; charset=utf-8";
    }
    return "application/octet-stream";
}

} // namespace

ConsentGatedCrashUploader::ConsentGatedCrashUploader(UploaderConfig config, const ConsentStore& consent,
                                                     HttpPoster& poster, const core::Clock& clock)
    : config_(std::move(config)), consent_(consent), poster_(poster), clock_(clock) {}

std::vector<CrashReport> ConsentGatedCrashUploader::pendingReports() const {
    return listPendingReports(config_.crashesDirectory);
}

std::size_t ConsentGatedCrashUploader::discardPending() {
    std::size_t removed = 0;
    for (const CrashReport& report : pendingReports()) {
        std::error_code ec;
        if (std::filesystem::remove(report.path, ec) && !ec) {
            ++removed;
        }
    }
    return removed;
}

std::vector<std::int64_t> ConsentGatedCrashUploader::loadRecentUploads(std::int64_t nowSeconds) const {
    std::vector<std::int64_t> recent;
    auto content = detail::readFile(config_.crashesDirectory / std::string{kUploadLogName}, kMaxLogBytes);
    if (!content) {
        return recent;
    }
    std::istringstream lines{*content};
    std::int64_t value = 0;
    while (lines >> value) {
        // Keep only entries inside the rolling window; drop future-dated ones.
        if (value > nowSeconds - kDaySeconds && value <= nowSeconds) {
            recent.push_back(value);
        }
    }
    return recent;
}

void ConsentGatedCrashUploader::saveRecentUploads(const std::vector<std::int64_t>& uploads) const {
    std::string text;
    for (const std::int64_t value : uploads) {
        text += std::to_string(value);
        text.push_back('\n');
    }
    if (auto saved = detail::writeFileAtomically(config_.crashesDirectory / std::string{kUploadLogName}, text);
        !saved) {
        core::AedstLogger::warn("crash upload: cannot persist the rate-limit log");
    }
}

core::Outcome<UploadSummary> ConsentGatedCrashUploader::uploadPending() {
    UploadSummary summary;
    if (consent_.state() != ConsentState::Granted) {
        return summary;
    }
    summary.consentGranted = true;

    const std::int64_t now = toEpochSeconds(clock_.now());
    std::vector<std::int64_t> recent = loadRecentUploads(now);

    for (const CrashReport& report : pendingReports()) {
        if (report.sizeBytes > config_.maxReportBytes) {
            std::error_code ec;
            std::filesystem::remove(report.path, ec);
            ++summary.discardedOversize;
            continue;
        }
        if (recent.size() >= config_.maxUploadsPerDay) {
            summary.rateLimited = true;
            break;
        }
        auto body = detail::readFile(report.path, config_.maxReportBytes);
        if (!body) {
            ++summary.failed;
            continue;
        }
        UploadPayload payload;
        payload.fileName = report.id;
        payload.contentType = contentTypeFor(report.path);
        payload.body = report.path.extension() == ".txt" ? scrubHomePaths(*body) : std::move(*body);

        if (auto sent = poster_.post(payload); !sent) {
            // Most likely offline: keep the report and stop hammering the endpoint.
            ++summary.failed;
            break;
        }
        std::error_code ec;
        std::filesystem::remove(report.path, ec);
        recent.push_back(now);
        saveRecentUploads(recent);
        ++summary.uploaded;
    }
    return summary;
}

} // namespace aedst::crash
