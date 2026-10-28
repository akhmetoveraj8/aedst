#include "aedst/updater/update_service.hpp"

#include "aedst/logging/log_categories.hpp"

#include <QCoreApplication>
#include <QMetaObject>
#include <QPointer>
#include <QRandomGenerator>
#include <QThreadPool>

#include <algorithm>
#include <utility>

namespace aedst::updater {

UpdateService::UpdateService(update::UpdateCheckerConfig config, update::HttpFetcher& fetcher,
                             update::ManifestVerifier verifier, update::UpdateStateStore& stateStore,
                             UpdateInstaller& installer, Timing timing, QObject* parent)
    : QObject(parent),
      config_(std::move(config)),
      fetcher_(fetcher),
      verifier_(std::move(verifier)),
      stateStore_(stateStore),
      installer_(installer),
      timing_(timing) {
    timer_.setSingleShot(true);
    timer_.setTimerType(Qt::VeryCoarseTimer); // minutes to hours: no precision needed
    connect(&timer_, &QTimer::timeout, this, &UpdateService::checkNow);
    // Its own pool with ONE thread that never expires: update work never competes with (or blocks on) the global pool,
    // and the QtHttpFetcher's thread-local QNetworkAccessManager is created exactly once, on this thread.
    pool_.setMaxThreadCount(1);
    pool_.setExpiryTimeout(-1);
}

UpdateService::~UpdateService() {
    ++generation_; // a result that arrives after destruction is dropped by the guard in checkNow()
    stop();
    // The worker uses the fetcher, state store and installer the owner passed in; they must not die under it. Every
    // call in the pipeline has its own timeout, so this is bounded. Only THIS service's pool is waited for, never the
    // global one.
    pool_.waitForDone(15'000);
}

QString UpdateService::availableVersion() const {
    return outcome_ ? QString::fromStdString(outcome_->offer.manifest.version) : QString{};
}

QString UpdateService::releaseNotesUrl() const {
    return outcome_ ? QString::fromStdString(outcome_->offer.manifest.releaseNotesUrl) : QString{};
}

bool UpdateService::mandatory() const noexcept {
    return outcome_ && outcome_->offer.mandatory;
}

bool UpdateService::isRollback() const noexcept {
    return outcome_ && outcome_->offer.rollback;
}

void UpdateService::setState(State state) {
    if (state == state_) {
        return;
    }
    state_ = state;
    emit stateChanged();
}

void UpdateService::setCrashLoop(bool crashLoop) {
    if (crashLoop == crashLoop_) {
        return;
    }
    crashLoop_ = crashLoop;
    emit stateChanged();
}

void UpdateService::start() {
    stopped_ = false;
    scheduleNext(timing_.firstCheckDelay);
}

void UpdateService::stop() {
    stopped_ = true;
    timer_.stop();
}

void UpdateService::scheduleNext(std::chrono::milliseconds delay) {
    if (stopped_) {
        return;
    }
    // +-10 % jitter so a fleet that started together does not hit the server together.
    const double jitter = 0.9 + 0.2 * QRandomGenerator::global()->generateDouble();
    timer_.start(static_cast<int>(static_cast<double>(delay.count()) * jitter));
}

void UpdateService::checkNow() {
    if (running_) {
        return;
    }
    if (state_ == State::ReadyToInstall) {
        scheduleNext(timing_.interval); // already holding a verified update; nothing to check
        return;
    }
    running_ = true;
    progress_ = 0;
    errorMessage_.clear();
    setState(State::Checking);

    const quint64 generation = ++generation_;
    QPointer<UpdateService> self(this);
    // Copies for the worker: the service's own members are only touched on the GUI thread.
    const update::UpdateCheckerConfig config = config_;
    const update::ManifestVerifier verifier = verifier_;
    update::HttpFetcher* const fetcher = &fetcher_;
    update::UpdateStateStore* const stateStore = &stateStore_;
    UpdateInstaller* const installer = &installer_;
    pool_.start([self, generation, config, verifier, fetcher, stateStore, installer]() {
        PipelineEvents events;
        events.stage = [self, generation](PipelineStage stage) {
            if (stage == PipelineStage::Downloading && self) {
                QMetaObject::invokeMethod(
                    self.data(),
                    [self, generation]() {
                        if (self && self->generation_ == generation) {
                            self->setState(State::Downloading);
                        }
                    },
                    Qt::QueuedConnection);
            }
        };
        events.progress = [self, generation](int percent) {
            if (!self) {
                return;
            }
            QMetaObject::invokeMethod(
                self.data(),
                [self, generation, percent]() {
                    if (self && self->generation_ == generation && self->progress_ != percent) {
                        self->progress_ = percent;
                        emit self->progressChanged();
                    }
                },
                Qt::QueuedConnection);
        };
        // Blocking; touches nothing of the service (the owner keeps fetcher, store and installer alive, see
        // ~UpdateService).
        RunResult result = runUpdatePipeline(config, *fetcher, verifier, *stateStore, *installer, events);
        if (!self) {
            return;
        }
        QMetaObject::invokeMethod(
            self.data(),
            [self, generation, result = std::move(result)]() mutable {
                if (self && self->generation_ == generation) {
                    self->onRunFinished(std::move(result));
                }
            },
            Qt::QueuedConnection);
    });
}

void UpdateService::onRunFinished(RunResult result) {
    running_ = false;
    outcome_.reset();
    if (!result) {
        errorMessage_ = QString::fromStdString(result.error().message);
        qCWarning(lcUpdater, "Update check failed: %s", result.error().message.c_str());
        setState(State::Failed);
        scheduleNext(timing_.interval);
        return;
    }
    if (!*result) {
        qCInfo(lcUpdater, "Up to date");
        setState(State::UpToDate);
        scheduleNext(timing_.interval);
        return;
    }
    outcome_ = std::move(**result);
    const QString version = QString::fromStdString(outcome_->offer.manifest.version);
    const bool mandatoryUpdate = outcome_->offer.mandatory;
    qCInfo(lcUpdater, "Update %s is %s%s", qUtf8Printable(version),
           outcome_->readyToInstall() ? "downloaded and verified" : "available (installed by the package manager)",
           outcome_->offer.rollback ? " [rollback]" : "");
    setState(outcome_->readyToInstall() ? State::ReadyToInstall : State::Available);
    emit updateReady(version, mandatoryUpdate);
    scheduleNext(timing_.interval);
}

bool UpdateService::installAndRestart() {
    if (state_ != State::ReadyToInstall || !outcome_ || !outcome_->candidate) {
        return false;
    }
    if (crashLoop_ && !outcome_->offer.rollback) {
        // Safe mode: do not move a broken install to yet another build; only a signed rollback may be applied.
        qCWarning(lcUpdater, "Refusing to apply an update while the current version keeps failing to start");
        return false;
    }
    if (auto applied = installer_.applyAfterExit(*outcome_->candidate, /*restart=*/true); !applied) {
        errorMessage_ = QString::fromStdString(applied.error().message);
        qCCritical(lcUpdater, "Applying the update failed: %s", applied.error().message.c_str());
        setState(State::Failed);
        return false;
    }
    qCInfo(lcUpdater, "Update scheduled; quitting to let the installer run");
    QCoreApplication::quit();
    return true;
}

void UpdateService::dismiss() {
    if (outcome_ && !outcome_->offer.mandatory && state_ == State::Available) {
        outcome_.reset();
        setState(State::Idle);
    }
}

} // namespace aedst::updater
