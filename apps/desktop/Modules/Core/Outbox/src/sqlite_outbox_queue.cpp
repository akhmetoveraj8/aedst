#include "aedst/outbox/outbox_queue.hpp"
#include "aedst/outbox/outbox_store.hpp"

#include <utility>

namespace aedst::outbox {

using persistence::SqliteConnection;

SqliteOutboxQueue::SqliteOutboxQueue(std::shared_ptr<persistence::DatabaseWorker> worker,
                                     persistence::Dispatcher dispatcher)
    : worker_(std::move(worker)), dispatcher_(std::move(dispatcher)) {}

void SqliteOutboxQueue::enqueue(OutboxItem item, core::Completion<void> done) {
    worker_->run<void>(
        [item = std::move(item)](const std::shared_ptr<SqliteConnection>& connection) {
            return store::enqueue(*connection, item);
        },
        dispatcher_, std::move(done));
}

void SqliteOutboxQueue::pending(int limit, core::Completion<std::vector<OutboxItem>> done) {
    worker_->run<std::vector<OutboxItem>>(
        [limit](const std::shared_ptr<SqliteConnection>& connection) { return store::pending(*connection, limit); },
        dispatcher_, std::move(done));
}

void SqliteOutboxQueue::snapshot(core::Completion<std::vector<OutboxItem>> done) {
    worker_->run<std::vector<OutboxItem>>(
        [](const std::shared_ptr<SqliteConnection>& connection) { return store::all(*connection); }, dispatcher_,
        std::move(done));
}

void SqliteOutboxQueue::pendingCount(core::Completion<int> done) {
    worker_->run<int>(
        [](const std::shared_ptr<SqliteConnection>& connection) { return store::pendingCount(*connection); },
        dispatcher_, std::move(done));
}

void SqliteOutboxQueue::remove(std::string id, core::Completion<void> done) {
    worker_->run<void>(
        [id = std::move(id)](const std::shared_ptr<SqliteConnection>& connection) {
            return store::remove(*connection, id);
        },
        dispatcher_, std::move(done));
}

void SqliteOutboxQueue::recordAttempt(std::string id, std::string errorKind, core::Completion<void> done) {
    worker_->run<void>(
        [id = std::move(id), errorKind = std::move(errorKind)](const std::shared_ptr<SqliteConnection>& connection) {
            return store::recordAttempt(*connection, id, errorKind);
        },
        dispatcher_, std::move(done));
}

void SqliteOutboxQueue::markFailed(std::string id, std::string errorKind, core::Completion<void> done) {
    worker_->run<void>(
        [id = std::move(id), errorKind = std::move(errorKind)](const std::shared_ptr<SqliteConnection>& connection) {
            return store::markFailed(*connection, id, errorKind);
        },
        dispatcher_, std::move(done));
}

void SqliteOutboxQueue::clear(core::Completion<void> done) {
    worker_->run<void>([](const std::shared_ptr<SqliteConnection>& connection) { return store::clear(*connection); },
                       dispatcher_, std::move(done));
}

} // namespace aedst::outbox
