#pragma once

#include "Domain/task.hpp"
#include "aedst/media/media_list_model.hpp"
#include "aedst/media/media_upload_controller.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QDateTime>
#include <QObject>
#include <QString>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

#include <memory>
#include <optional>

namespace aedst::core {
class ErrorSink;
} // namespace aedst::core

namespace aedst::media {
class MediaRemoteDataSource;
} // namespace aedst::media

namespace aedst::navigation {
class Router;
} // namespace aedst::navigation

namespace aedst::feature::tasks {

class TaskRepository;

/// One task plus its attachments. Attachments come from aedst.media.v1 through
/// the Core media building blocks (Aedst::Media) - never from Features/Media -
/// and new files are uploaded with CreateUploadRequest.task_id set, which is how
/// the server attaches media to a task. While an attachment is still
/// PENDING_UPLOAD/PROCESSING the list is re-fetched with a backoff until the
/// server's variants (thumbnails, posters) are READY.
class TaskDetailViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(QString taskId READ taskId NOTIFY taskChanged)
    Q_PROPERTY(bool hasTask READ hasTask NOTIFY taskChanged)
    Q_PROPERTY(QString title READ title NOTIFY taskChanged)
    Q_PROPERTY(QString description READ description NOTIFY taskChanged)
    Q_PROPERTY(QString status READ status NOTIFY taskChanged)
    Q_PROPERTY(bool done READ done NOTIFY taskChanged)
    Q_PROPERTY(int priority READ priority NOTIFY taskChanged)
    Q_PROPERTY(QDateTime dueDate READ dueDate NOTIFY taskChanged)
    Q_PROPERTY(bool overdue READ overdue NOTIFY taskChanged)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(bool isMutating READ isMutating NOTIFY isMutatingChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)
    Q_PROPERTY(aedst::media::MediaListModel* attachments READ attachments CONSTANT)
    Q_PROPERTY(aedst::media::MediaUploadController* uploader READ uploader CONSTANT)

public:
    static TaskDetailViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<TaskDetailViewModel>::create(engine, script);
    }

    struct Dependencies {
        std::shared_ptr<TaskRepository> tasks;
        std::shared_ptr<media::MediaRemoteDataSource> media;
        std::shared_ptr<core::ErrorSink> errors;
        media::MediaUploadController::Dependencies upload;
        navigation::Router* router{nullptr};
    };

    explicit TaskDetailViewModel(Dependencies dependencies, QObject* parent = nullptr);

    [[nodiscard]] QString taskId() const;

    [[nodiscard]] bool hasTask() const noexcept { return task_.has_value(); }

    [[nodiscard]] QString title() const;
    [[nodiscard]] QString description() const;
    [[nodiscard]] QString status() const;
    [[nodiscard]] bool done() const;
    [[nodiscard]] int priority() const;
    [[nodiscard]] QDateTime dueDate() const;
    [[nodiscard]] bool overdue() const;

    [[nodiscard]] bool isLoading() const noexcept { return isLoading_; }

    [[nodiscard]] bool isMutating() const noexcept { return isMutating_; }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    [[nodiscard]] media::MediaListModel* attachments() noexcept { return &attachments_; }

    [[nodiscard]] media::MediaUploadController* uploader() noexcept { return &uploader_; }

    /// Called by TaskDetailView with its `taskId` route parameter.
    Q_INVOKABLE void load(const QString& taskId);
    Q_INVOKABLE void reload();
    Q_INVOKABLE void setDone(bool done);
    Q_INVOKABLE void deleteTask();
    Q_INVOKABLE void deleteAttachment(const QString& mediaId);
    /// Opens the media viewer route (registered by the Media feature) by name.
    Q_INVOKABLE void openAttachment(const QString& mediaId);
    Q_INVOKABLE void clear();

signals:
    void taskChanged();
    void isLoadingChanged();
    void isMutatingChanged();
    void errorMessageChanged();
    /// One-shot: the task was deleted; the view pops itself.
    void taskDeleted();

private:
    void loadAttachments();
    void scheduleAttachmentPoll();
    void setTask(std::optional<Task> task);
    void setLoading(bool loading);
    void setMutating(bool mutating);
    void setErrorMessage(const QString& message);

    Dependencies deps_;
    std::optional<Task> task_;
    QString requestedId_;
    media::MediaListModel attachments_;
    media::MediaUploadController uploader_;
    QTimer attachmentPoll_;
    int pollAttempts_{0};
    QString errorMessage_;
    bool isLoading_{false};
    bool isMutating_{false};
    quint64 seq_{0};
};

} // namespace aedst::feature::tasks
