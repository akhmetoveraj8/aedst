#include "aedst/media/media_upload_controller.hpp"

#include "aedst/core/error_sink.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/media/media_remote_data_source.hpp"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMimeDatabase>
#include <QPointer>
#include <QStandardPaths>
#include <QThreadPool>
#include <QTimeZone>
#include <QUuid>

#include <utility>

namespace aedst::media {

namespace {

[[nodiscard]] QByteArray sha256Hex(const QString& path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return {};
    }
    QCryptographicHash hash(QCryptographicHash::Sha256);
    if (!hash.addData(&file)) {
        return {};
    }
    return hash.result().toHex();
}

[[nodiscard]] QString tempUploadPath(const QByteArray& format) {
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
    QDir().mkpath(dir);
    return QDir(dir).filePath(QStringLiteral("aedst-upload-%1.%2")
                                  .arg(QUuid::createUuid().toString(QUuid::WithoutBraces),
                                       format == "jpeg" ? QStringLiteral("jpg") : QString::fromLatin1(format)));
}

} // namespace

MediaUploadController::MediaUploadController(Dependencies dependencies, QObject* parent)
    : QObject(parent), deps_(std::move(dependencies)), uploader_(*deps_.network, deps_.allowInsecureLoopback, this) {
    connect(&uploader_, &PresignedUploader::progress, this, [this](qint64 sent, qint64 total) {
        if (total > 0) {
            setProgress(static_cast<double>(sent) / static_cast<double>(total));
        }
    });
    connect(&uploader_, &PresignedUploader::finished, this, &MediaUploadController::onPutFinished);
}

MediaUploadController::~MediaUploadController() {
    bumpGeneration(); // late worker results become no-ops, and running workers stop early
    discardTempFile();
}

bool MediaUploadController::busy() const noexcept {
    return state_ == State::Preparing || state_ == State::Uploading || state_ == State::Completing;
}

QString MediaUploadController::fileName() const {
    return current_.isEmpty() ? QString() : QFileInfo(current_.toLocalFile()).fileName();
}

void MediaUploadController::setTaskId(const QString& taskId) {
    if (taskId == taskId_) {
        return;
    }
    taskId_ = taskId;
    emit taskIdChanged();
}

void MediaUploadController::enqueue(const QList<QUrl>& files) {
    bool added = false;
    for (const QUrl& url : files) {
        if (!url.isLocalFile() || !QFileInfo(url.toLocalFile()).isFile()) {
            continue;
        }
        queue_.append(url);
        added = true;
    }
    if (!added) {
        return;
    }
    emit queueChanged();
    if (!busy() && state_ != State::Failed) {
        startNext();
    }
}

void MediaUploadController::cancel() {
    if (!busy()) {
        return;
    }
    bumpGeneration();
    uploader_.cancel(); // emits finished(Cancelled) synchronously when running
    deleteOrphan();
    discardTempFile();
    setState(State::Cancelled);
    startNext();
}

void MediaUploadController::retry() {
    if (state_ != State::Failed) {
        return;
    }
    errorMessage_.clear();
    const bool urlStillValid = slot_.expiresAt.isValid() && QDateTime::currentDateTimeUtc() < slot_.expiresAt;
    if (!restartFromCreate_ && urlStillValid && !prepared_.path.isEmpty()) {
        put();
        return;
    }
    if (!prepared_.path.isEmpty()) {
        deleteOrphan();
        createUpload();
        return;
    }
    prepare();
}

void MediaUploadController::reset(bool clearQueue) {
    if (busy()) {
        return;
    }
    discardTempFile();
    current_.clear();
    slot_ = {};
    errorMessage_.clear();
    setProgress(0.0);
    emit fileChanged();
    if (clearQueue && !queue_.isEmpty()) {
        queue_.clear();
        emit queueChanged();
    }
    setState(State::Idle);
    startNext(); // files queued while the previous one had failed
}

void MediaUploadController::abortAll() {
    if (!queue_.isEmpty()) {
        queue_.clear();
        emit queueChanged();
    }
    cancel(); // no-op when idle; with an empty queue it cannot start another file
    reset(true);
}

void MediaUploadController::startNext() {
    if (queue_.isEmpty()) {
        return;
    }
    discardTempFile();
    current_ = queue_.takeFirst();
    slot_ = {};
    errorMessage_.clear();
    emit queueChanged();
    emit fileChanged();
    prepare();
}

void MediaUploadController::prepare() {
    setProgress(0.0);
    setState(State::Preparing);
    const quint64 generation = bumpGeneration();
    const std::shared_ptr<std::atomic<quint64>> live = liveGeneration_;
    const QString input = current_.toLocalFile();
    const CompressionOptions options = deps_.compression;
    QPointer<MediaUploadController> guard(this);
    QThreadPool::globalInstance()->start([guard, generation, live, input, options]() {
        // Off the GUI thread: decoding/encoding a large photo and hashing take seconds.
        const auto superseded = [&live, generation]() { return live->load() != generation; };
        if (superseded()) {
            return; // cancelled while queued: nothing was produced, nothing to clean up
        }
        auto result = compressImage(input, tempUploadPath(options.format), options);
        if (result && result->compressed && superseded()) {
            QFile::remove(result->path); // cancelled during the encode: skip the hash and the hop back
            return;
        }
        QByteArray hash = result && !superseded() ? sha256Hex(result->path) : QByteArray();
        // Hop back to the GUI thread through the application object (always alive);
        // `guard` is only dereferenced there, never on this worker thread.
        QMetaObject::invokeMethod(
            QCoreApplication::instance(),
            [guard, generation, result = std::move(result), hash = std::move(hash)]() mutable {
                if (guard && guard->generation_ == generation) {
                    guard->onPrepared(std::move(result), std::move(hash));
                } else if (result && result->compressed) {
                    QFile::remove(result->path); // superseded: do not leak the temp file
                }
            },
            Qt::QueuedConnection);
    });
}

void MediaUploadController::onPrepared(std::expected<CompressedImage, QString> result, QByteArray sha256Hex) {
    if (!result) {
        fail(result.error(), true);
        return;
    }
    prepared_ = std::move(*result);
    sha256Hex_ = std::move(sha256Hex);
    if (prepared_.contentType.isEmpty()) {
        prepared_.contentType = QByteArrayLiteral("application/octet-stream");
    }
    emit fileChanged();
    if (prepared_.compressed) {
        qCInfo(lcMedia, "Upload: image compressed to %lld bytes (%dx%d)", static_cast<long long>(prepared_.sizeBytes),
               prepared_.size.width(), prepared_.size.height());
    }
    createUpload();
}

void MediaUploadController::createUpload() {
    setState(State::Uploading);
    setProgress(0.0);
    mediav1::CreateUploadRequest request;
    request.set_filename(fileName().left(255).toStdString());
    request.set_content_type(prepared_.contentType.toStdString());
    request.set_size_bytes(prepared_.sizeBytes);
    if (!taskId_.isEmpty()) {
        request.set_task_id(taskId_.toStdString());
    }
    if (sha256Hex_.size() == 64) {
        request.set_sha256(sha256Hex_.toStdString());
    }
    const quint64 generation = generation_;
    QPointer<MediaUploadController> guard(this);
    deps_.remote->createUpload(request, [guard, generation](network::ApiResult<mediav1::CreateUploadResponse> result) {
        if (!guard || guard->generation_ != generation) {
            return;
        }
        if (!result) {
            if (guard->deps_.errors) {
                guard->deps_.errors->report(result.error().toCoreError(), "media.upload.create");
            }
            guard->fail(QString::fromStdString(result.error().message), true);
            return;
        }
        Slot slot;
        slot.mediaId = QString::fromStdString(result->media().id());
        slot.uploadUrl = QUrl(QString::fromStdString(result->upload_url()), QUrl::StrictMode);
        slot.method = QByteArray::fromStdString(result->method());
        for (const auto& [name, value] : result->headers()) {
            slot.headers.insert(QByteArray::fromStdString(name), QByteArray::fromStdString(value));
        }
        if (result->has_expires_at()) {
            slot.expiresAt = QDateTime::fromSecsSinceEpoch(result->expires_at().seconds(), QTimeZone::UTC);
        }
        guard->slot_ = std::move(slot);
        guard->put();
    });
}

void MediaUploadController::put() {
    setState(State::Uploading);
    setProgress(0.0);
    QString error;
    if (!uploader_.start(slot_.uploadUrl, slot_.method, slot_.headers, prepared_.path, prepared_.contentType, &error)) {
        fail(error, true);
    }
}

void MediaUploadController::onPutFinished(PresignedUploader::Outcome outcome, const QString& message) {
    switch (outcome) {
    case PresignedUploader::Outcome::Succeeded:
        setProgress(1.0);
        complete();
        return;
    case PresignedUploader::Outcome::Cancelled:
        return; // cancel() already moved the state machine on
    case PresignedUploader::Outcome::Retryable:
        fail(message, false);
        return;
    case PresignedUploader::Outcome::Expired:
    case PresignedUploader::Outcome::Failed:
        break;
    }
    fail(message, true);
}

void MediaUploadController::complete() {
    setState(State::Completing);
    mediav1::CompleteUploadRequest request;
    request.set_id(slot_.mediaId.toStdString());
    const quint64 generation = generation_;
    QPointer<MediaUploadController> guard(this);
    deps_.remote->completeUpload(
        request, [guard, generation](network::ApiResult<mediav1::CompleteUploadResponse> result) {
            if (!guard || guard->generation_ != generation) {
                return;
            }
            if (!result) {
                if (guard->deps_.errors) {
                    guard->deps_.errors->report(result.error().toCoreError(), "media.upload.complete");
                }
                // The object is in storage; only completion failed. Retrying
                // from CreateUpload re-sends the bytes, which is always safe.
                guard->fail(QString::fromStdString(result.error().message), true);
                return;
            }
            const QString mediaId = guard->slot_.mediaId;
            guard->discardTempFile();
            guard->slot_ = {};
            guard->setState(State::Done);
            emit guard->uploaded(mediaId);
            guard->startNext();
        });
}

void MediaUploadController::fail(const QString& message, bool restartFromCreate) {
    restartFromCreate_ = restartFromCreate;
    errorMessage_ = message.isEmpty() ? tr("Upload failed") : message;
    setState(State::Failed);
}

void MediaUploadController::setState(State state) {
    if (state == state_ && state != State::Failed) {
        return;
    }
    state_ = state;
    emit stateChanged();
}

void MediaUploadController::setProgress(double progress) {
    if (qFuzzyCompare(progress + 1.0, progress_ + 1.0)) {
        return;
    }
    progress_ = progress;
    emit progressChanged();
}

void MediaUploadController::discardTempFile() {
    if (prepared_.compressed && !prepared_.path.isEmpty()) {
        QFile::remove(prepared_.path);
    }
    prepared_ = {};
    sha256Hex_.clear();
}

void MediaUploadController::deleteOrphan() {
    if (slot_.mediaId.isEmpty()) {
        return;
    }
    mediav1::DeleteMediaRequest request;
    request.set_id(slot_.mediaId.toStdString());
    deps_.remote->deleteMedia(request, [](network::ApiResult<void> result) {
        if (!result) {
            qCDebug(lcMedia, "Orphaned upload cleanup failed: %s", result.error().message.c_str());
        }
    });
    slot_ = {};
}

} // namespace aedst::media
