#include "aedst/persistence/database_worker.hpp"

#include "aedst/core/logger.hpp"
#include "aedst/persistence/migrator.hpp"

#include <cassert>
#include <system_error>

namespace aedst::persistence {

DatabaseWorker::DatabaseWorker(std::filesystem::path file) : file_(std::move(file)) {
    thread_ = std::thread([this] { loop(); });
    threadId_ = thread_.get_id();
}

DatabaseWorker::~DatabaseWorker() {
    // Destroying the worker from its own thread would join itself (deadlock / std::terminate). The last owner must be a
    // thread that is not the worker: in the app that is AppDependencies, which holds the first (last-destroyed)
    // reference.
    assert(std::this_thread::get_id() != threadId_ && "DatabaseWorker destroyed on its own thread");
    {
        const std::scoped_lock lock(mutex_);
        closing_ = true;
    }
    wake_.notify_all();
    if (thread_.joinable()) {
        thread_.join();
    }
}

void DatabaseWorker::enqueue(Job job, Unavailable unavailable) {
    {
        const std::scoped_lock lock(mutex_);
        queue_.push_back(Item{.job = std::move(job), .unavailable = std::move(unavailable)});
    }
    wake_.notify_one();
}

void DatabaseWorker::loop() {
    // Open and migrate first, on this thread: the caller never waits for the file system or the schema.
    std::error_code ec;
    if (file_.has_parent_path()) {
        std::filesystem::create_directories(file_.parent_path(), ec);
    }
    if (ec) {
        openError_ = core::Error::storage("Cannot create the data directory: " + ec.message());
    } else if (auto opened = SqliteConnection::open(file_)) {
        connection_ = std::make_shared<SqliteConnection>(std::move(*opened));
        if (auto migrated = Migrator(appMigrations()).migrate(*connection_); !migrated) {
            openError_ = migrated.error();
            connection_.reset();
        }
    } else {
        openError_ = opened.error();
    }
    if (openError_) {
        core::AedstLogger::error("Local database unavailable: {}", openError_->message);
    }

    for (;;) {
        Item item;
        {
            std::unique_lock lock(mutex_);
            wake_.wait(lock, [this] { return closing_ || !queue_.empty(); });
            if (queue_.empty()) {
                break; // closing and drained
            }
            item = std::move(queue_.front());
            queue_.pop_front();
        }
        if (connection_) {
            item.job(connection_);
        } else {
            item.unavailable(*openError_);
        }
    }
    connection_.reset(); // closed on the thread that opened it
}

} // namespace aedst::persistence
