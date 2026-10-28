#include "Presentation/task_list_view_model.hpp"

#include "Data/task_outbox_handlers.hpp"
#include "Domain/create_task_use_case.hpp"
#include "Domain/task_repository.hpp"
#include "Navigation/tasks_route.hpp"
#include "aedst/analytics/analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"
#include "aedst/navigation/router.hpp"
#include "aedst/outbox/outbox_service.hpp"

#include <QPointer>
#include <QUuid>

#include <algorithm>
#include <chrono>
#include <optional>
#include <string>
#include <utility>

namespace aedst::feature::tasks {

TaskListViewModel::TaskListViewModel(std::shared_ptr<TaskRepository> repository,
                                     std::shared_ptr<CreateTaskUseCase> createTask,
                                     std::shared_ptr<core::ErrorSink> errors,
                                     std::shared_ptr<analytics::AnalyticsTracker> analytics, navigation::Router* router,
                                     QObject* parent)
    : QObject(parent),
      repository_(std::move(repository)),
      createTask_(std::move(createTask)),
      errors_(std::move(errors)),
      analytics_(std::move(analytics)),
      router_(router) {
    filterDebounce_.setSingleShot(true);
    filterDebounce_.setInterval(kFilterDebounceMs);
    connect(&filterDebounce_, &QTimer::timeout, this, &TaskListViewModel::reload);
}

namespace {

/// One id per user intent: the Idempotency-Key of the direct call and, if that fails for lack of a connection, of the
/// outbox item that repeats it, so the server applies the operation once even when the first response was lost.
[[nodiscard]] std::string newRequestId() {
    return QUuid::createUuid().toString(QUuid::WithoutBraces).toStdString();
}

} // namespace

int TaskListViewModel::pendingSyncCount() const {
    return outbox_ != nullptr ? outbox_->pendingCount() : 0;
}

void TaskListViewModel::setOutbox(outbox::OutboxService* outbox) {
    outbox_ = outbox;
    if (outbox_ == nullptr) {
        return;
    }
    connect(outbox_, &outbox::OutboxService::pendingCountChanged, this, &TaskListViewModel::pendingSyncCountChanged);
    // Everything queued has reached the server: replace the local placeholders by the server's rows. (With items
    // still queued the placeholders must stay, a reload would drop them.)
    connect(outbox_, &outbox::OutboxService::delivered, this, [this]() {
        if (outbox_->pendingCount() == 0 && !isLoading_) {
            reload();
        }
    });
}

void TaskListViewModel::setFilter(const QString& filter) {
    if (filter == filter_) {
        return;
    }
    filter_ = filter;
    emit filterChanged();
    filterDebounce_.start(); // restarts on every keystroke: one request after typing pauses
}

void TaskListViewModel::setShowCompleted(bool show) {
    if (show == showCompleted_) {
        return;
    }
    showCompleted_ = show;
    emit showCompletedChanged();
    reload();
}

void TaskListViewModel::reload() {
    filterDebounce_.stop();
    load(false);
}

void TaskListViewModel::loadMore() {
    if (!hasMore() || isLoading_) {
        return;
    }
    load(true);
}

void TaskListViewModel::load(bool append) {
    setErrorMessage({});
    setLoading(true);
    const quint64 seq = ++requestSeq_;
    TaskQuery query{.search = filter_.trimmed().left(200).toStdString(),
                    .includeDone = showCompleted_,
                    .pageToken = append ? nextPageToken_ : std::string(),
                    .pageSize = 20};
    QPointer<TaskListViewModel> guard(this);
    repository_->list(query, [guard, seq, append](core::Outcome<TaskPage> result) {
        if (!guard || seq != guard->requestSeq_) {
            return; // destroyed, or superseded by a newer filter
        }
        guard->setLoading(false);
        if (!result) {
            guard->setErrorMessage(QString::fromStdString(result.error().message));
            if (guard->errors_) {
                guard->errors_->report(result.error(), "tasks.list",
                                       append ? core::ErrorVisibility::Transient : core::ErrorVisibility::Silent);
            }
            return;
        }
        if (append) {
            guard->model_.appendTasks(std::move(result->tasks));
        } else {
            guard->model_.setTasks(std::move(result->tasks));
            if (guard->totalCount_ != result->totalCount) {
                guard->totalCount_ = result->totalCount;
                emit guard->totalCountChanged();
            }
        }
        guard->setNextPageToken(std::move(result->nextPageToken));
    });
}

void TaskListViewModel::openTask(const QString& taskId) {
    // A task still waiting in the outbox has no server id to open yet.
    if (router_ != nullptr && !taskId.isEmpty() && !isLocalTaskId(taskId.toStdString())) {
        router_->push(taskDetailRoute(taskId.toStdString()));
    }
}

void TaskListViewModel::setDone(const QString& taskId, bool done) {
    const std::string id = taskId.toStdString();
    const auto current = model_.find(id);
    if (!current || current->isDone() == done || isLocalTaskId(id)) {
        return;
    }
    const std::string requestId = newRequestId();
    // Optimistic: flip the row now, roll back if the server refuses.
    Task optimistic = *current;
    optimistic.status = done ? TaskStatus::Done : TaskStatus::Todo;
    model_.update(optimistic);

    QPointer<TaskListViewModel> guard(this);
    auto onDone = [guard, previous = *current, done, id, requestId](core::Outcome<Task> result) {
        if (!guard) {
            return;
        }
        if (!result) {
            if (core::isRetryable(result.error().code) && guard->queueSetDone(id, done, requestId, previous)) {
                return; // kept as shown, marked pending, delivered when the connection is back
            }
            guard->model_.update(previous);
            if (guard->errors_) {
                guard->errors_->report(result.error(), done ? "tasks.complete" : "tasks.reopen");
            }
            return;
        }
        guard->model_.update(*result);
        if (done && guard->analytics_) {
            guard->analytics_->track(analytics::events::kTaskCompleted, {});
        }
    };
    repository_->setDone(id, done, requestId, std::move(onDone));
}

bool TaskListViewModel::queueSetDone(const std::string& id, bool done, const std::string& requestId,
                                     const Task& previous) {
    if (outbox_ == nullptr) {
        return false;
    }
    if (auto row = model_.find(id)) {
        row->pendingSync = true;
        model_.update(*row);
    }
    QPointer<TaskListViewModel> guard(this);
    outbox_->enqueue(std::string(kTaskUpdateOutboxType), taskUpdatePayload(id, done), requestId,
                     [guard, previous](core::VoidOutcome stored) {
                         if (!guard || stored) {
                             return;
                         }
                         // Not even stored locally: show the truth again and say so.
                         guard->model_.update(previous);
                         if (guard->errors_) {
                             guard->errors_->report(stored.error(), "tasks.queue");
                         }
                     });
    return true;
}

bool TaskListViewModel::queueCreate(const NewTask& task) {
    if (outbox_ == nullptr) {
        return false;
    }
    const std::string localId = std::string(kLocalTaskIdPrefix) + task.clientRequestId;
    const auto now = std::chrono::system_clock::now();
    model_.prepend(Task{.id = localId,
                        .title = task.title,
                        .description = task.description,
                        .status = TaskStatus::Todo,
                        .priority = task.priority,
                        .dueDate = task.dueDate,
                        .createdAt = now,
                        .updatedAt = now,
                        .completedAt = std::nullopt,
                        .version = 0,
                        .pendingSync = true});
    ++totalCount_;
    emit totalCountChanged();
    QPointer<TaskListViewModel> guard(this);
    outbox_->enqueue(std::string(kTaskCreateOutboxType), taskCreatePayload(task), task.clientRequestId,
                     [guard, localId](core::VoidOutcome stored) {
                         if (!guard || stored) {
                             return;
                         }
                         guard->model_.remove(localId);
                         --guard->totalCount_;
                         emit guard->totalCountChanged();
                         if (guard->errors_) {
                             guard->errors_->report(stored.error(), "tasks.queue");
                         }
                     });
    emit taskCreated(QString::fromStdString(localId));
    return true;
}

void TaskListViewModel::createTask(const QString& title, const QString& description, int priority) {
    if (isCreating_) {
        return;
    }
    isCreating_ = true;
    emit isCreatingChanged();
    NewTask input{.title = title.toStdString(),
                  .description = description.toStdString(),
                  .priority = static_cast<TaskPriority>(std::clamp(priority, 0, 4)),
                  .dueDate = std::nullopt,
                  .clientRequestId = newRequestId()};
    // The use case trims its own copy; the outbox needs the same normalised values if the call fails offline.
    NewTask forOutbox = input;
    static_cast<void>(CreateTaskUseCase::normalizeAndValidate(forOutbox));
    QPointer<TaskListViewModel> guard(this);
    createTask_->execute(std::move(input), [guard, forOutbox = std::move(forOutbox)](core::Outcome<Task> result) {
        if (!guard) {
            return;
        }
        guard->isCreating_ = false;
        emit guard->isCreatingChanged();
        if (!result) {
            if (core::isRetryable(result.error().code) && guard->queueCreate(forOutbox)) {
                return; // shown as pending; the dialog closes through taskCreated()
            }
            const QString message = QString::fromStdString(result.error().message);
            if (result.error().code != core::ErrorCode::InvalidInput && guard->errors_) {
                guard->errors_->report(result.error(), "tasks.create");
            }
            emit guard->createFailed(message);
            return;
        }
        const QString id = QString::fromStdString(result->id);
        guard->model_.prepend(std::move(*result));
        ++guard->totalCount_;
        emit guard->totalCountChanged();
        if (guard->analytics_) {
            guard->analytics_->track(analytics::events::kTaskCreated, {});
        }
        emit guard->taskCreated(id);
    });
}

void TaskListViewModel::clear() {
    ++requestSeq_;
    filterDebounce_.stop();
    model_.setTasks({});
    setNextPageToken({});
    setErrorMessage({});
    setLoading(false);
    if (!filter_.isEmpty()) {
        filter_.clear();
        emit filterChanged();
    }
    if (totalCount_ != 0) {
        totalCount_ = 0;
        emit totalCountChanged();
    }
}

void TaskListViewModel::setLoading(bool loading) {
    if (loading != isLoading_) {
        isLoading_ = loading;
        emit isLoadingChanged();
    }
}

void TaskListViewModel::setErrorMessage(const QString& message) {
    if (message != errorMessage_) {
        errorMessage_ = message;
        emit errorMessageChanged();
    }
}

void TaskListViewModel::setNextPageToken(std::string token) {
    const bool before = hasMore();
    nextPageToken_ = std::move(token);
    if (before != hasMore()) {
        emit hasMoreChanged();
    }
}

} // namespace aedst::feature::tasks
