#pragma once

#include <QByteArray>
#include <QHash>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QUrl>

#include <memory>

class QFile;
class QNetworkAccessManager;
class QNetworkReply;

namespace aedst::media {

/// Streams one local file to an object-storage presigned URL (S3 / MinIO / R2)
/// with QNetworkAccessManager: the body is a QFile, never read into memory, and
/// QNetworkReply::uploadProgress drives `progress`. The bytes go straight to
/// object storage - never through the API server (aedst.media.v1 contract).
///
/// Policy: the URL must be https (plain http only for a loopback host when the
/// app allows insecure loopback, i.e. a local MinIO in Debug); the presigned
/// headers are sent verbatim; no Authorization header is ever added (the
/// signature is in the URL). Certificate errors are never ignored. One upload at a
/// time per instance; cancel() aborts it and emits finished(Cancelled).
class PresignedUploader final : public QObject {
    Q_OBJECT

public:
    enum class Outcome {
        Succeeded,
        Cancelled,
        /// The URL expired or the signature was rejected (HTTP 403): ask for a new one.
        Expired,
        /// Network failure or 5xx: retrying the same URL may work.
        Retryable,
        /// Any other rejection (4xx): retrying will not help.
        Failed,
    };
    Q_ENUM(Outcome)

    /// `network` is shared with the rest of the app and must outlive this object.
    explicit PresignedUploader(QNetworkAccessManager& network, bool allowInsecureLoopback, QObject* parent = nullptr);
    ~PresignedUploader() override;
    PresignedUploader(const PresignedUploader&) = delete;
    PresignedUploader& operator=(const PresignedUploader&) = delete;
    PresignedUploader(PresignedUploader&&) = delete;
    PresignedUploader& operator=(PresignedUploader&&) = delete;

    /// Returns false (and emits nothing) when the URL is rejected by policy or the
    /// file cannot be opened; `error` then says why.
    bool start(const QUrl& url, const QByteArray& method, const QHash<QByteArray, QByteArray>& headers,
               const QString& filePath, const QByteArray& contentType, QString* error = nullptr);
    void cancel();

    [[nodiscard]] bool isRunning() const noexcept { return !reply_.isNull(); }

signals:
    void progress(qint64 bytesSent, qint64 bytesTotal);
    void finished(aedst::media::PresignedUploader::Outcome outcome, const QString& message);

private:
    void onFinished();

    QNetworkAccessManager& network_;
    bool allowInsecureLoopback_;
    QPointer<QNetworkReply> reply_;
    std::unique_ptr<QFile> file_;
    bool cancelled_{false};
};

} // namespace aedst::media
