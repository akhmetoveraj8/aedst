#pragma once

#include "aedst/media/media_list_model.hpp"
#include "aedst/media/media_upload_controller.hpp"
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

namespace aedst::media {
class MediaRemoteDataSource;
} // namespace aedst::media

namespace aedst::navigation {
class Router;
} // namespace aedst::navigation

namespace aedst::feature::media {

/// "My files": every media item of the caller (ListMedia without task_id), an
/// uploader for library uploads, delete, and a kind filter. This feature has no
/// Domain layer of its own: there are no business rules beyond the contract, so
/// the generated aedst.media.v1 messages (held by Core's MediaListModel) are the
/// model, and the Core MediaRemoteDataSource is the repository.
class MediaLibraryViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(aedst::media::MediaListModel* items READ items CONSTANT)
    Q_PROPERTY(aedst::media::MediaUploadController* uploader READ uploader CONSTANT)
    Q_PROPERTY(QString kindFilter READ kindFilter WRITE setKindFilter NOTIFY kindFilterChanged)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(bool hasMore READ hasMore NOTIFY hasMoreChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)

public:
    static MediaLibraryViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<MediaLibraryViewModel>::create(engine, script);
    }

    struct Dependencies {
        std::shared_ptr<aedst::media::MediaRemoteDataSource> remote;
        std::shared_ptr<core::ErrorSink> errors;
        std::shared_ptr<analytics::AnalyticsTracker> analytics;
        aedst::media::MediaUploadController::Dependencies upload;
        navigation::Router* router{nullptr};
    };

    explicit MediaLibraryViewModel(Dependencies dependencies, QObject* parent = nullptr);

    [[nodiscard]] aedst::media::MediaListModel* items() noexcept { return &items_; }

    [[nodiscard]] aedst::media::MediaUploadController* uploader() noexcept { return &uploader_; }

    /// "all" | "image" | "video" | "document".
    [[nodiscard]] QString kindFilter() const { return kindFilter_; }

    void setKindFilter(const QString& kind);

    [[nodiscard]] bool isLoading() const noexcept { return isLoading_; }

    [[nodiscard]] bool hasMore() const { return !nextPageToken_.empty(); }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    Q_INVOKABLE void reload();
    Q_INVOKABLE void loadMore();
    Q_INVOKABLE void open(const QString& mediaId);
    Q_INVOKABLE void remove(const QString& mediaId);
    Q_INVOKABLE void clear();

signals:
    void kindFilterChanged();
    void isLoadingChanged();
    void hasMoreChanged();
    void errorMessageChanged();

private:
    void load(bool append);
    void schedulePoll();
    void setLoading(bool loading);
    void setErrorMessage(const QString& message);
    void setNextPageToken(std::string token);

    Dependencies deps_;
    aedst::media::MediaListModel items_;
    aedst::media::MediaUploadController uploader_;
    QTimer poll_;
    int pollAttempts_{0};
    QString kindFilter_{QStringLiteral("all")};
    QString errorMessage_;
    std::string nextPageToken_;
    bool isLoading_{false};
    quint64 seq_{0};
};

} // namespace aedst::feature::media
