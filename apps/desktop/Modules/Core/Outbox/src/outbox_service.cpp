#include "aedst/outbox/outbox_service.hpp"

#include "aedst/logging/log_categories.hpp"

#include <QPointer>
#include <QRandomGenerator>
#include <QUuid>

#include <chrono>
#include <utility>

namespace aedst::outbox {

OutboxService::OutboxService(Dependencies dependencies, QObject* parent)
    : QObject(parent), deps_(std::move(dependencies)) {
    drainer_ = OutboxDrainer::create(deps_.queue, deps_.handlers, deps_.drainer);
    retryTimer_.setSingleShot(true);
    connect(&retryTimer_, &QTimer::timeout, this, &OutboxService::kick);
}

void OutboxService::start() {
    refreshPendingCount();
    kick();
}

void OutboxService::enqueue(std::string type, std::string payload, std::string id, core::Completion<void> done) {
    if (id.empty()) {
        id = QUuid::createUuid().toString(QUuid::WithoutBraces).toStdString();
    }
    const auto now = deps_.clock ? deps_.clock->now() : core::Clock::TimePoint::clock::now();
    OutboxItem item{.id = std::move(id),
                    .type = std::move(type),
                    .payload = std::move(payload),
                    .attempts = 0,
                    .status = OutboxStatus::Pending,
                    .createdAtMs =
                        std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count(),
                    .lastError = {}};
    QPointer<OutboxService> guard(this);
    deps_.queue->enqueue(std::move(item), [guard, done = std::move(done)](core::VoidOutcome stored) {
        if (guard) {
            guard->refreshPendingCount();
            if (stored) {
                guard->kick();
            } else {
                qCCritical(lcOutbox, "could not store an operation: %s", stored.error().message.c_str());
            }
        }
        if (done) {
            done(std::move(stored));
        }
    });
}

void OutboxService::setOnline(bool online) {
    if (online == online_) {
        return;
    }
    online_ = online;
    if (online_) {
        retryStreak_ = 0;
        kick();
    } else {
        retryTimer_.stop();
    }
}

void OutboxService::kick() {
    if (!online_) {
        return;
    }
    if (running_) {
        rerun_ = true;
        return;
    }
    startRun();
}

void OutboxService::startRun() {
    running_ = true;
    retryTimer_.stop();
    QPointer<OutboxService> guard(this);
    const quint64 generation = generation_;
    drainer_->run([guard, generation](core::Outcome<RunReport> report) {
        if (guard) {
            guard->onRunFinished(generation, report);
        }
    });
}

void OutboxService::onRunFinished(quint64 generation, const core::Outcome<RunReport>& report) {
    running_ = false;
    if (generation == generation_) {
        if (!report) {
            // The database could not be read or written. Try again later; nothing was lost.
            qCWarning(lcOutbox, "run failed: %s", report.error().message.c_str());
            scheduleRetry();
        } else {
            refreshPendingCount(report->delivered > 0);
            switch (report->result) {
            case RunResult::Complete:
                retryStreak_ = 0;
                break;
            case RunResult::Retry:
                scheduleRetry();
                break;
            case RunResult::Blocked:
                retryStreak_ = 0; // the next trigger (enqueue, online, start) tries again
                break;
            }
        }
    }
    if (rerun_) {
        rerun_ = false;
        if (!retryTimer_.isActive()) {
            kick();
        }
    }
}

void OutboxService::scheduleRetry() {
    ++retryStreak_;
    if (!online_) {
        return;
    }
    const auto delay = deps_.backoff.delayBefore(retryStreak_ + 1, QRandomGenerator::global()->generateDouble());
    qCDebug(lcOutbox, "retrying in %lld ms", static_cast<long long>(delay.count()));
    retryTimer_.start(delay);
}

void OutboxService::purge(core::Completion<void> done) {
    ++generation_;
    retryTimer_.stop();
    retryStreak_ = 0;
    rerun_ = false;
    setPendingCount(0);
    QPointer<OutboxService> guard(this);
    deps_.queue->clear([guard, done = std::move(done)](core::VoidOutcome cleared) {
        if (!cleared) {
            qCCritical(lcOutbox, "could not purge the queue: %s", cleared.error().message.c_str());
        }
        if (guard) {
            guard->refreshPendingCount();
        }
        if (done) {
            done(std::move(cleared));
        }
    });
}

void OutboxService::refreshPendingCount(bool announceDelivery) {
    QPointer<OutboxService> guard(this);
    const quint64 generation = generation_;
    deps_.queue->pendingCount([guard, generation, announceDelivery](core::Outcome<int> count) {
        if (guard && count && generation == guard->generation_) {
            guard->setPendingCount(*count);
            if (announceDelivery) {
                emit guard->delivered();
            }
        }
    });
}

void OutboxService::setPendingCount(int count) {
    if (count != pendingCount_) {
        pendingCount_ = count;
        emit pendingCountChanged();
    }
}

} // namespace aedst::outbox
