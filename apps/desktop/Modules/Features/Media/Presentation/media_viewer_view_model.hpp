#pragma once

#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QTimer>
#include <QUrl>
#include <QtQml/qqmlregistration.h>

#include <aedst/media/v1/media.pb.h>
#include <memory>
#include <optional>

namespace aedst::core {
class ErrorSink;
} // namespace aedst::core

namespace aedst::media {
class MediaRemoteDataSource;
} // namespace aedst::media

namespace aedst::feature::media {

/// One media item full-screen: image preview (image://media provider) or
/// VideoPlayer (Qt Multimedia) for videos/audio. Presigned URLs are short-lived,
/// so the item is re-fetched (GetMedia) when the view opens and while it is
/// still processing; `refresh()` re-signs URLs after a long pause.
class MediaViewerViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(QString mediaId READ mediaId NOTIFY mediaChanged)
    Q_PROPERTY(bool hasMedia READ hasMedia NOTIFY mediaChanged)
    Q_PROPERTY(QString kind READ kind NOTIFY mediaChanged)
    Q_PROPERTY(QString status READ status NOTIFY mediaChanged)
    Q_PROPERTY(QString fileName READ fileName NOTIFY mediaChanged)
    Q_PROPERTY(QString failureReason READ failureReason NOTIFY mediaChanged)
    Q_PROPERTY(QString previewSource READ previewSource NOTIFY mediaChanged)
    Q_PROPERTY(QUrl playbackUrl READ playbackUrl NOTIFY mediaChanged)
    Q_PROPERTY(QString posterSource READ posterSource NOTIFY mediaChanged)
    Q_PROPERTY(qint64 sizeBytes READ sizeBytes NOTIFY mediaChanged)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)

public:
    static MediaViewerViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<MediaViewerViewModel>::create(engine, script);
    }

    MediaViewerViewModel(std::shared_ptr<aedst::media::MediaRemoteDataSource> remote,
                         std::shared_ptr<core::ErrorSink> errors, QObject* parent = nullptr);

    [[nodiscard]] QString mediaId() const { return requestedId_; }

    [[nodiscard]] bool hasMedia() const noexcept { return media_.has_value(); }

    [[nodiscard]] QString kind() const;
    [[nodiscard]] QString status() const;
    [[nodiscard]] QString fileName() const;
    [[nodiscard]] QString failureReason() const;
    [[nodiscard]] QString previewSource() const;
    [[nodiscard]] QUrl playbackUrl() const;
    [[nodiscard]] QString posterSource() const;
    [[nodiscard]] qint64 sizeBytes() const;

    [[nodiscard]] bool isLoading() const noexcept { return isLoading_; }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    Q_INVOKABLE void load(const QString& mediaId);
    Q_INVOKABLE void refresh();
    Q_INVOKABLE void clear();

signals:
    void mediaChanged();
    void isLoadingChanged();
    void errorMessageChanged();

private:
    void setLoading(bool loading);
    void setErrorMessage(const QString& message);

    std::shared_ptr<aedst::media::MediaRemoteDataSource> remote_;
    std::shared_ptr<core::ErrorSink> errors_;
    std::optional<::aedst::media::v1::Media> media_;
    QString requestedId_;
    QTimer poll_;
    int pollAttempts_{0};
    QString errorMessage_;
    bool isLoading_{false};
    quint64 seq_{0};
};

} // namespace aedst::feature::media
