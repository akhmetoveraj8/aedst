#pragma once

#include "aedst/core/outcome.hpp"

#include <filesystem>
#include <string>

namespace aedst::update {

/// What the previous runs of this install tell about the current one.
struct HealthReport {
    /// The running version started `unhealthyStarts` times in a row without ever being marked healthy.
    int unhealthyStarts{0};
    /// kCrashLoopThreshold or more starts in a row never reached "healthy": the build is probably broken
    /// (crashes at startup, or hangs before the window is usable). The owner then stops applying updates
    /// and reports it; a signed rollback manifest (UpdateManifest::rollback) is what actually moves users back.
    bool crashLoop{false};
    /// First start since this version was installed (a fresh update).
    bool firstStartOfThisVersion{false};
    /// The last version that reached "healthy" (empty on a first install). Operators use it to choose the rollback
    /// target.
    std::string lastKnownGood;
};

/// Detects "the update I just installed does not start": every start is counted as unhealthy until the
/// application says otherwise, either after it has been up and usable for a while or on a clean exit.
///
///   StartupHealthGuard guard(file, AEDST_VERSION);
///   auto report = guard.recordStart();          // first thing in main()
///   ...                                          // window shown, 30 s later (QTimer) or on aboutToQuit:
///   guard.markHealthy();
///
/// State is three key=value lines replaced atomically; a corrupt file reads as "no history". Not thread-safe.
class StartupHealthGuard final {
public:
    static constexpr int kCrashLoopThreshold = 3;

    StartupHealthGuard(std::filesystem::path file, std::string currentVersion);

    /// Counts this start. Failure to persist is reported but the returned report is still meaningful
    /// when the previous state could be read; callers log and continue.
    [[nodiscard]] core::Outcome<HealthReport> recordStart();

    /// The running version works: resets the counter and remembers it as the last known good version.
    [[nodiscard]] core::VoidOutcome markHealthy();

private:
    struct State {
        std::string version;
        int unhealthyStarts{0};
        std::string lastKnownGood;
    };

    [[nodiscard]] State load() const;
    [[nodiscard]] core::VoidOutcome save(const State& state) const;

    std::filesystem::path file_;
    std::string currentVersion_;
};

} // namespace aedst::update
