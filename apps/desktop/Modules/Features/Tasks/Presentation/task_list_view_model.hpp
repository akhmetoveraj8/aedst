#pragma once

#include "Presentation/task_list_model.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

#include <memory>
#include <string>

namespace aedst::analytics {
class AnalyticsTracker;
} // namespace aedst::analytics

namespace aedst::core {
class ErrorSink;
} // namespace aedst::core

namespace aedst::outbox {
class OutboxService;
} // namespace aedst::outbox

namespace aedst::navigation {
class Router;
} // namespace aedst::navigation

namespace aedst::feature::tasks {

class TaskRepository;
class CreateTaskUseCase;

/// The signed-in landing screen: the caller's tasks, a filter field (debounced,
/// server-side ListTasks.search), "show completed", paging, quick complete/reopen
/// and "new task". State is Q_PROPERTY; failures go to the shared ErrorSink
/// (toast) and `errorMessage` (inline error state).
class TaskListViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(QAbstractItemModel* tasks READ tasks CONSTANT)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(bool isCreating READ isCreating NOTIFY isCreatingChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)
    Q_PROPERTY(int totalCount READ totalCount NOTIFY totalCountChanged)
    Q_PROPERTY(bool hasMore READ hasMore NOTIFY hasMoreChanged)
    /// Changes saved on this device that the server has not confirmed yet (the offline outbox).
    Q_PROPERTY(int pendingSyncCount READ pendingSyncCount NOTIFY pendingSyncCountChanged)
    Q_PROPERTY(QString filter READ filter WRITE setFilter NOTIFY filterChanged)
    Q_PROPERTY(bool showCompleted READ showCompleted WRITE setShowCompleted NOTIFY showCompletedChanged)

public:
    static TaskListViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<TaskListViewModel>::create(engine, script);
    }

    static constexpr int kFilterDebounceMs = 300;

    TaskListViewModel(std::shared_ptr<TaskRepository> repository, std::shared_ptr<CreateTaskUseCase> createTask,
                      std::shared_ptr<core::ErrorSink> errors, std::shared_ptr<analytics::AnalyticsTracker> analytics,
                      navigation::Router* router, QObject* parent = nullptr);

    [[nodiscard]] QAbstractItemModel* tasks() noexcept { return &model_; }

    [[nodiscard]] TaskListModel& model() noexcept { return model_; }

    [[nodiscard]] bool isLoading() const noexcept { return isLoading_; }

    [[nodiscard]] bool isCreating() const noexcept { return isCreating_; }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    [[nodiscard]] int totalCount() const noexcept { return totalCount_; }

    [[nodiscard]] bool hasMore() const { return !nextPageToken_.empty(); }

    [[nodiscard]] int pendingSyncCount() const;
    /// Enables offline writes: a create or a complete/reopen that fails for lack of a connection is queued in `outbox`
    /// (which must outlive this view model) and shown as pending until the server confirms it.
    void setOutbox(outbox::OutboxService* outbox);

    [[nodiscard]] QString filter() const { return filter_; }

    void setFilter(const QString& filter);

    [[nodiscard]] bool showCompleted() const noexcept { return showCompleted_; }

    void setShowCompleted(bool show);

    Q_INVOKABLE void reload();
    Q_INVOKABLE void loadMore();
    Q_INVOKABLE void openTask(const QString& taskId);
    Q_INVOKABLE void setDone(const QString& taskId, bool done);
    /// priority: 1 low .. 4 urgent (TaskPriority numbering).
    Q_INVOKABLE void createTask(const QString& title, const QString& description, int priority);
    /// Clears the list on sign-out so the next user never sees it.
    Q_INVOKABLE void clear();

signals:
    void isLoadingChanged();
    void isCreatingChanged();
    void errorMessageChanged();
    void totalCountChanged();
    void hasMoreChanged();
    void pendingSyncCountChanged();
    void filterChanged();
    void showCompletedChanged();
    /// One-shot effect: the create form can close and reset.
    void taskCreated(const QString& taskId);
    void createFailed(const QString& message);

private:
    void load(bool append);
    void setLoading(bool loading);
    void setErrorMessage(const QString& message);
    void setNextPageToken(std::string token);
    /// Offline fallbacks; both return false when nothing was queued (no outbox) so the caller reports the error.
    bool queueCreate(const NewTask& task);
    bool queueSetDone(const std::string& id, bool done, const std::string& requestId, const Task& previous);

    std::shared_ptr<TaskRepository> repository_;
    std::shared_ptr<CreateTaskUseCase> createTask_;
    std::shared_ptr<core::ErrorSink> errors_;
    std::shared_ptr<analytics::AnalyticsTracker> analytics_;
    navigation::Router* router_;
    outbox::OutboxService* outbox_{nullptr};

    TaskListModel model_;
    QTimer filterDebounce_;
    QString filter_;
    QString errorMessage_;
    std::string nextPageToken_;
    int totalCount_{0};
    bool showCompleted_{true};
    bool isLoading_{false};
    bool isCreating_{false};
    /// Incremented per list request; stale responses (filter typed meanwhile) are dropped.
    quint64 requestSeq_{0};
};

} // namespace aedst::feature::tasks
