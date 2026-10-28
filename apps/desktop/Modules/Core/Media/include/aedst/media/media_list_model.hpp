#pragma once

#include <QAbstractListModel>
#include <QHash>
#include <QString>
#include <QtQmlIntegration/qqmlintegration.h>

#include <aedst/media/v1/media.pb.h>
#include <vector>

namespace aedst::media {

namespace mediav1 = ::aedst::media::v1;

/// List of aedst.media.v1.Media for QML (library grid, task attachments).
/// Holds the generated messages themselves - no mirrored DTO - and derives the
/// display roles (thumbnail/preview image sources, kind/status names) from them.
class MediaListModel final : public QAbstractListModel {
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Owned by a ViewModel")
    Q_PROPERTY(int count READ count NOTIFY countChanged)

public:
    enum Role {
        MediaIdRole = Qt::UserRole + 1,
        KindRole,
        StatusRole,
        FileNameRole,
        ContentTypeRole,
        SizeBytesRole,
        WidthRole,
        HeightRole,
        DurationMsRole,
        ThumbnailSourceRole,
        PreviewSourceRole,
        PlaybackUrlRole,
        OriginalUrlRole,
        FailureReasonRole,
        TaskIdRole,
    };
    Q_ENUM(Role)

    explicit MediaListModel(QObject* parent = nullptr);

    [[nodiscard]] int rowCount(const QModelIndex& parent = {}) const override;
    [[nodiscard]] QVariant data(const QModelIndex& index, int role) const override;
    [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

    [[nodiscard]] int count() const { return rowCount(); }

    void setItems(std::vector<mediav1::Media> items);
    void append(std::vector<mediav1::Media> items);
    /// Replaces the row with the same id, or appends it.
    void upsert(const mediav1::Media& item);
    void remove(const QString& mediaId);
    [[nodiscard]] const mediav1::Media* find(const QString& mediaId) const;
    /// True while any row is PENDING_UPLOAD or PROCESSING (callers poll until false).
    [[nodiscard]] bool hasUnfinished() const;

signals:
    void countChanged();

private:
    [[nodiscard]] int indexOf(const QString& mediaId) const;

    std::vector<mediav1::Media> items_;
};

} // namespace aedst::media
