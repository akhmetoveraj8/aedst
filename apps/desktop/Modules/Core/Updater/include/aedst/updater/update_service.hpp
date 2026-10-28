#pragma once

#include "aedst/update/http_fetcher.hpp"
#include "aedst/update/manifest_verifier.hpp"
#include "aedst/update/update_checker.hpp"
#include "aedst/update/update_state_store.hpp"
#include "aedst/updater/update_installer.hpp"
#include "aedst/updater/update_pipeline.hpp"

#include <QObject>
#include <QString>
#include <QThreadPool>
#include <QTimer>

#include <chrono>
#include <memory>
#include <optional>
#include <vector>

namespace aedst::updater {

/// The application's update flow, as state for the UI (QML binds to the properties):
///
///   Idle -> Checking -> (UpToDate | Downloading -> ReadyToInstall | Available | Failed)
///
///  - `Available`: a signed newer version exists but this install cannot replace itself (deb/rpm/Flatpak/portable):
///    the UI shows "version X is available, update with your package manager" and the release notes link.
///  - `ReadyToInstall`: the package was downloaded and verified; installAndRestart() hands it to the installer and
///  quits.
///  - A mandatory update (below the manifest's minSupportedVersion, or a signed rollback) sets `mandatory`; the UI
///    blocks on it instead of offering "later".
///  - Safe mode: when the previous starts of this version never became healthy (StartupHealthGuard), updates are
///  checked
///    but never applied automatically and `crashLoop` is true - the owner reports it and a signed rollback fixes it.
///
/// The blocking work (manifest fetch, feed query, download, hashing) runs on the service's own one-thread QThreadPool;
/// the state and signals are touched on the GUI thread only. One run at a time. Checks run `firstCheckDelay` after
/// start() and then every `interval` (with jitter), never in safe-mode-forbidden situations and never while a run is
/// active.
class UpdateService final : public QObject {
    Q_OBJECT
    Q_PROPERTY(State state READ state NOTIFY stateChanged)
    Q_PROPERTY(QString availableVersion READ availableVersion NOTIFY stateChanged)
    Q_PROPERTY(QString releaseNotesUrl READ releaseNotesUrl NOTIFY stateChanged)
    Q_PROPERTY(int progress READ progress NOTIFY progressChanged)
    Q_PROPERTY(bool mandatory READ mandatory NOTIFY stateChanged)
    Q_PROPERTY(bool isRollback READ isRollback NOTIFY stateChanged)
    Q_PROPERTY(bool crashLoop READ crashLoop NOTIFY stateChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY stateChanged)

public:
    enum class State {
        Idle,
        Checking,
        UpToDate,
        Downloading,
        ReadyToInstall,
        Available,
        Failed
    };
    Q_ENUM(State)

    struct Timing {
        std::chrono::milliseconds firstCheckDelay{std::chrono::minutes{2}};
        std::chrono::milliseconds interval{std::chrono::hours{6}};
    };

    /// Everything is owned by the service except what is passed by reference (fetcher, stateStore, installer), which
    /// must outlive it. The service is the only user of them once start() was called.
    UpdateService(update::UpdateCheckerConfig config, update::HttpFetcher& fetcher, update::ManifestVerifier verifier,
                  update::UpdateStateStore& stateStore, UpdateInstaller& installer, Timing timing = {},
                  QObject* parent = nullptr);
    ~UpdateService() override;

    [[nodiscard]] State state() const noexcept { return state_; }

    [[nodiscard]] QString availableVersion() const;
    [[nodiscard]] QString releaseNotesUrl() const;

    [[nodiscard]] int progress() const noexcept { return progress_; }

    [[nodiscard]] bool mandatory() const noexcept;
    [[nodiscard]] bool isRollback() const noexcept;

    [[nodiscard]] bool crashLoop() const noexcept { return crashLoop_; }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    /// Schedules the periodic checks.
    void start();
    void stop();

    /// Safe mode, see the class comment.
    void setCrashLoop(bool crashLoop);

    Q_INVOKABLE void checkNow();
    /// Applies the downloaded package after exit and quits the application. Only in ReadyToInstall.
    Q_INVOKABLE bool installAndRestart();
    /// Forgets a non-mandatory notification (the next scheduled check shows it again).
    Q_INVOKABLE void dismiss();

signals:
    void stateChanged();
    void progressChanged();
    /// A verified update is ready (or announced in Available state); `mandatory` tells the UI not to offer "later".
    void updateReady(const QString& version, bool mandatory);

private:
    using RunResult = core::Outcome<std::optional<UpdateOutcome>>;

    void onRunFinished(RunResult result);
    void setState(State state);
    void scheduleNext(std::chrono::milliseconds delay);

    update::UpdateCheckerConfig config_;
    update::HttpFetcher& fetcher_;
    update::ManifestVerifier verifier_;
    update::UpdateStateStore& stateStore_;
    UpdateInstaller& installer_;
    Timing timing_;

    QThreadPool pool_;
    QTimer timer_;
    State state_{State::Idle};
    int progress_{0};
    bool crashLoop_{false};
    bool running_{false};
    bool stopped_{true};
    QString errorMessage_;
    std::optional<UpdateOutcome> outcome_;
    quint64 generation_{0};
};

} // namespace aedst::updater
