#include "aedst/outbox/outbox_drainer.hpp"

#include "aedst/core/logger.hpp"

#include <exception>
#include <utility>
#include <vector>

namespace aedst::outbox {

struct OutboxDrainer::Run {
    core::Completion<RunReport> done;
    std::vector<OutboxItem> batch;
    std::size_t index{0};
    RunReport report;
};

std::shared_ptr<OutboxDrainer> OutboxDrainer::create(std::shared_ptr<OutboxQueue> queue,
                                                     std::shared_ptr<const OutboxHandlers> handlers,
                                                     DrainerConfig config) {
    // Private constructor, so no make_shared.
    return std::shared_ptr<OutboxDrainer>(new OutboxDrainer(std::move(queue), std::move(handlers), config));
}

OutboxDrainer::OutboxDrainer(std::shared_ptr<OutboxQueue> queue, std::shared_ptr<const OutboxHandlers> handlers,
                             DrainerConfig config)
    : queue_(std::move(queue)), handlers_(std::move(handlers)), config_(config) {}

void OutboxDrainer::run(core::Completion<RunReport> done) {
    auto run = std::make_shared<Run>();
    run->done = std::move(done);
    nextBatch(run);
}

void OutboxDrainer::nextBatch(const std::shared_ptr<Run>& run) {
    queue_->pending(config_.batchSize, [self = shared_from_this(), run](core::Outcome<std::vector<OutboxItem>> batch) {
        if (!batch) {
            run->done(core::fail(batch.error()));
            return;
        }
        if (batch->empty()) {
            self->finish(run, RunResult::Complete);
            return;
        }
        run->batch = std::move(*batch);
        run->index = 0;
        self->deliverNext(run);
    });
}

void OutboxDrainer::deliverNext(const std::shared_ptr<Run>& run) {
    if (run->index >= run->batch.size()) {
        nextBatch(run); // parked and delivered items left the pending set; whatever remains is the next batch
        return;
    }
    const OutboxItem item = run->batch[run->index];
    const std::shared_ptr<OutboxHandler> handler = handlers_->find(item.type);
    if (!handler) {
        core::AedstLogger::error("Outbox: no handler for item type '{}'; parking it", item.type);
        park(run, item, "NoHandler");
        return;
    }
    const OutboxDelivery delivery{.item = item, .idempotencyKey = item.id};
    // Completes at most once: a handler that completes twice must not advance the run twice.
    auto completed = std::make_shared<bool>(false);
    auto complete = [self = shared_from_this(), run, item, completed](DeliveryResult result) {
        if (std::exchange(*completed, true)) {
            return;
        }
        self->onDelivered(run, item, result);
    };
    try {
        handler->deliver(delivery, complete);
    } catch (const std::exception& e) {
        core::AedstLogger::error("Outbox: handler for '{}' threw: {}", item.type, e.what());
        complete(DeliveryResult::permanent("Exception"));
    } catch (...) {
        core::AedstLogger::error("Outbox: handler for '{}' threw a non-standard exception", item.type);
        complete(DeliveryResult::permanent("Exception"));
    }
}

void OutboxDrainer::onDelivered(const std::shared_ptr<Run>& run, const OutboxItem& item, const DeliveryResult& result) {
    switch (result.status) {
    case DeliveryStatus::Delivered:
        queue_->remove(item.id, [self = shared_from_this(), run](core::VoidOutcome removed) {
            if (removed) {
                ++run->report.delivered;
            }
            self->proceed(run, std::move(removed));
        });
        return;
    case DeliveryStatus::Retryable:
        if (item.attempts + 1 < config_.maxAttempts) {
            queue_->recordAttempt(item.id, result.errorKind,
                                  [self = shared_from_this(), run](core::VoidOutcome recorded) {
                                      if (!recorded) {
                                          run->done(core::fail(recorded.error()));
                                          return;
                                      }
                                      self->finish(run, RunResult::Retry);
                                  });
            return;
        }
        core::AedstLogger::warn("Outbox: giving up on '{}' after {} attempts ({})", item.type, item.attempts + 1,
                                result.errorKind);
        park(run, item, result.errorKind);
        return;
    case DeliveryStatus::Permanent:
        park(run, item, result.errorKind);
        return;
    case DeliveryStatus::Blocked:
        finish(run, RunResult::Blocked);
        return;
    }
}

void OutboxDrainer::park(const std::shared_ptr<Run>& run, const OutboxItem& item, const std::string& errorKind) {
    queue_->markFailed(item.id, errorKind, [self = shared_from_this(), run](core::VoidOutcome marked) {
        if (marked) {
            ++run->report.parked;
        }
        self->proceed(run, std::move(marked));
    });
}

void OutboxDrainer::proceed(const std::shared_ptr<Run>& run, core::VoidOutcome outcome) {
    if (!outcome) {
        run->done(core::fail(outcome.error()));
        return;
    }
    ++run->index;
    deliverNext(run);
}

void OutboxDrainer::finish(const std::shared_ptr<Run>& run, RunResult result) {
    run->report.result = result;
    run->done(run->report);
}

} // namespace aedst::outbox
