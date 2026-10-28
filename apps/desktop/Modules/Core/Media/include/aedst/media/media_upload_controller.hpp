#pragma once

#include "aedst/media/image_compressor.hpp"
#include "aedst/media/presigned_uploader.hpp"

#include <QByteArray>
#include <QDateTime>
#include <QHash>
#include <QList>
#include <QObject>
#include <QString>
#include <QUrl>
#include <QtQmlIntegration/qqmlintegration.h>

#include <atomic>
#include <memory>

class QNetworkAccessManager;

namespace aedst::core {
class ErrorSink;
} // namespace aedst::core

namespace aedst::media {

class MediaRemoteDataSource;

/// The upload pipeline as one QML-bindable object:
///   pick/drop file -> (images) compress off the GUI thread + SHA-256
///   -> CreateUpload -> PUT to the presigned URL (progress) -> CompleteUpload.
///
/// State machine (`state`): Idle -> Preparing -> Uploading -> Completing -> Done,
/// with Failed / Cancelled from any active state. Several files can be queued
/// (`enqueue`, drag & drop of many files); they are uploaded one at a time.
///  - cancel(): aborts the current step; a media row that was already created
///    is deleted best-effort (DeleteMedia) so no PENDING_UPLOAD orphan is left.
///  - retry(): after Failed. A transient PUT failure re-sends to the same URL
///    while it has not expired; an expired/rejected URL or an API failure starts
///    over from CreateUpload. CreateUpload/CompleteUpload are never retried
///    automatically (not idempotent, see contract/methods.hpp).
/// Instances are created in C++ (ViewModels own them) and exposed to QML as
/// properties; QML only binds and calls the invokables.
class MediaUploadController final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Owned by a ViewModel; expose it as a property")
    Q_PROPERTY(State state READ state NOTIFY stateChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY stateChanged)
    Q_PROPERTY(double progress READ progress NOTIFY progressChanged)
    Q_PROPERTY(QString fileName READ fileName NOTIFY fileChanged)
    Q_PROPERTY(QUrl fileUrl READ fileUrl NOTIFY fileChanged)
    Q_PROPERTY(QString contentType READ contentType NOTIFY fileChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY stateChanged)
    Q_PROPERTY(int queuedCount READ queuedCount NOTIFY queueChanged)
    /// Attach uploads to this task (CreateUploadRequest.task_id); empty = library only.
    Q_PROPERTY(QString taskId READ taskId WRITE setTaskId NOTIFY taskIdChanged)

public:
    enum class State {
        Idle,
        Preparing,
        Uploading,
        Completing,
        Done,
        Failed,
        Cancelled,
    };
    Q_ENUM(State)

    struct Dependencies {
        std::shared_ptr<MediaRemoteDataSource> remote;
        /// Shared app-wide QNetworkAccessManager for the PUT; must outlive the controller.
        QNetworkAccessManager* network{nullptr};
        std::shared_ptr<core::ErrorSink> errors;
        bool allowInsecureLoopback{false};
        CompressionOptions compression{};
    };

    explicit MediaUploadController(Dependencies dependencies, QObject* parent = nullptr);
    ~MediaUploadController() override;
    MediaUploadController(const MediaUploadController&) = delete;
    MediaUploadController& operator=(const MediaUploadController&) = delete;
    MediaUploadController(MediaUploadController&&) = delete;
    MediaUploadController& operator=(MediaUploadController&&) = delete;

    [[nodiscard]] State state() const noexcept { return state_; }

    [[nodiscard]] bool busy() const noexcept;

    [[nodiscard]] double progress() const noexcept { return progress_; }

    [[nodiscard]] QString fileName() const;

    [[nodiscard]] QUrl fileUrl() const { return current_; }

    [[nodiscard]] QString contentType() const { return QString::fromUtf8(prepared_.contentType); }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    [[nodiscard]] int queuedCount() const noexcept { return static_cast<int>(queue_.size()); }

    [[nodiscard]] QString taskId() const { return taskId_; }

    void setTaskId(const QString& taskId);

    /// Adds local files (file:// URLs from FileDialog or a DropArea) and starts if idle.
    /// Non-local URLs and directories are ignored.
    Q_INVOKABLE void enqueue(const QList<QUrl>& files);
    Q_INVOKABLE void cancel();
    Q_INVOKABLE void retry();
    /// Clears a Done/Failed/Cancelled state back to Idle (and the queue when `clearQueue`).
    Q_INVOKABLE void reset(bool clearQueue = false);
    /// Drops the queue, cancels the running upload and returns to Idle (screen closed, sign-out).
    Q_INVOKABLE void abortAll();

signals:
    void stateChanged();
    void progressChanged();
    void fileChanged();
    void queueChanged();
    void taskIdChanged();
    /// One file finished (CompleteUpload succeeded); the media may still be PROCESSING.
    void uploaded(const QString& mediaId);

private:
    struct Slot {
        QString mediaId;
        QUrl uploadUrl;
        QByteArray method;
        QHash<QByteArray, QByteArray> headers;
        QDateTime expiresAt;
    };

    void startNext();
    void prepare();
    void onPrepared(std::expected<CompressedImage, QString> result, QByteArray sha256Hex);
    void createUpload();
    void put();
    void onPutFinished(PresignedUploader::Outcome outcome, const QString& message);
    void complete();
    void fail(const QString& message, bool restartFromCreate);
    void setState(State state);
    void setProgress(double progress);
    void discardTempFile();
    void deleteOrphan();

    Dependencies deps_;
    PresignedUploader uploader_;
    QList<QUrl> queue_;
    QUrl current_;
    CompressedImage prepared_;
    QByteArray sha256Hex_;
    Slot slot_;
    QString taskId_;
    QString errorMessage_;
    State state_{State::Idle};
    double progress_{0.0};
    bool restartFromCreate_{true};
    quint64 generation_{0};
    /// generation_ as the worker threads see it: a preparation whose generation is no longer current (cancelled,
    /// replaced, controller destroyed) stops before the next expensive step instead of finishing work nobody will use.
    std::shared_ptr<std::atomic<quint64>> liveGeneration_{std::make_shared<std::atomic<quint64>>(0)};

    quint64 bumpGeneration() {
        liveGeneration_->store(++generation_);
        return generation_;
    }
};

} // namespace aedst::media
