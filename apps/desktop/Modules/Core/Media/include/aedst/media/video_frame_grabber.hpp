#pragma once

#include <QImage>
#include <QObject>
#include <QTimer>
#include <QUrl>
#include <QtQmlIntegration/qqmlintegration.h>

#include <memory>

class QMediaPlayer;
class QVideoFrame;
class QVideoSink;

namespace aedst::media {

/// Thumbnail fallback for videos the server has no POSTER/THUMBNAIL variant for
/// yet (a local file before upload, or a READY video still processing): plays
/// `source` muted into a QVideoSink (no window), seeks to `positionMs`, takes the
/// first valid frame (QVideoFrame::toImage), scales it to `maxPixels` and stops.
/// The result is written as a PNG into the cache directory and exposed as a
/// file:// URL (`thumbnailUrl`) so QML can show it with a plain Image.
///
///   VideoFrameGrabber { id: grab; source: upload.fileUrl }
///   Image { source: grab.thumbnailUrl; visible: grab.ready }
///
/// Gives up after kTimeoutMs (codec missing, DRM, broken file): `failed` is set.
class VideoFrameGrabber final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(QUrl source READ source WRITE setSource NOTIFY sourceChanged)
    Q_PROPERTY(qint64 positionMs READ positionMs WRITE setPositionMs NOTIFY sourceChanged)
    Q_PROPERTY(int maxPixels READ maxPixels WRITE setMaxPixels NOTIFY sourceChanged)
    Q_PROPERTY(QUrl thumbnailUrl READ thumbnailUrl NOTIFY resultChanged)
    Q_PROPERTY(bool ready READ ready NOTIFY resultChanged)
    Q_PROPERTY(bool failed READ failed NOTIFY resultChanged)

public:
    explicit VideoFrameGrabber(QObject* parent = nullptr);
    ~VideoFrameGrabber() override;
    VideoFrameGrabber(const VideoFrameGrabber&) = delete;
    VideoFrameGrabber& operator=(const VideoFrameGrabber&) = delete;
    VideoFrameGrabber(VideoFrameGrabber&&) = delete;
    VideoFrameGrabber& operator=(VideoFrameGrabber&&) = delete;

    [[nodiscard]] QUrl source() const { return source_; }

    void setSource(const QUrl& source);

    [[nodiscard]] qint64 positionMs() const noexcept { return positionMs_; }

    void setPositionMs(qint64 positionMs);

    [[nodiscard]] int maxPixels() const noexcept { return maxPixels_; }

    void setMaxPixels(int maxPixels);

    [[nodiscard]] QUrl thumbnailUrl() const { return thumbnailUrl_; }

    [[nodiscard]] bool ready() const noexcept { return !thumbnailUrl_.isEmpty(); }

    [[nodiscard]] bool failed() const noexcept { return failed_; }

    /// The last grabbed frame (C++ callers, e.g. tests).
    [[nodiscard]] const QImage& image() const noexcept { return image_; }

    static constexpr int kTimeoutMs = 8000;

    /// Where grabbed frames are written: `<cache root>/video-thumbnails`. The cache root defaults to the OS cache
    /// location; main() points it at the isolated profile when AEDST_DATA_DIR is set.
    static void setCacheRoot(const QString& root);
    [[nodiscard]] static QString thumbnailDirectory();
    /// Deletes every grabbed frame. Called on sign-out: thumbnails of a user's media must not outlive the session.
    static void clearThumbnailCache();

signals:
    void sourceChanged();
    void resultChanged();

private:
    void restart();
    void onFrame(const QVideoFrame& frame);
    void finish(QImage image);

    QUrl source_;
    qint64 positionMs_{1000};
    int maxPixels_{512};
    QUrl thumbnailUrl_;
    QImage image_;
    bool failed_{false};
    bool seeked_{false};
    std::unique_ptr<QMediaPlayer> player_;
    std::unique_ptr<QVideoSink> sink_;
    QTimer timeout_;
};

} // namespace aedst::media
