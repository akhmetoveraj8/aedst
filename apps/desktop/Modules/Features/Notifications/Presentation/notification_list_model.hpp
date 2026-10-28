#pragma once

#include "Domain/notification.hpp"

#include <QAbstractListModel>
#include <QHash>

#include <chrono>
#include <optional>
#include <vector>

namespace aedst::feature::notifications {

class NotificationListModel final : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(int count READ count NOTIFY countChanged)

public:
    enum Role {
        NotificationIdRole = Qt::UserRole + 1,
        KindRole,
        TitleRole,
        BodyRole,
        LinkRole,
        CreatedAtRole,
        ReadRole,
    };

    explicit NotificationListModel(QObject* parent = nullptr);

    [[nodiscard]] int rowCount(const QModelIndex& parent = {}) const override;
    [[nodiscard]] QVariant data(const QModelIndex& index, int role) const override;
    [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

    [[nodiscard]] int count() const { return rowCount(); }

    void setNotifications(std::vector<Notification> notifications);
    void appendNotifications(std::vector<Notification> notifications);
    /// A live notification arrived: inserted at the top unless that id is already listed.
    void prependNotification(Notification notification);
    /// Marks rows read locally (optimistic); returns the ids that were unread.
    std::vector<std::string> markRead(const std::vector<std::string>& ids, std::chrono::system_clock::time_point when);
    void markAllRead(std::chrono::system_clock::time_point when);
    [[nodiscard]] const Notification* at(int row) const;

signals:
    void countChanged();

private:
    std::vector<Notification> items_;
};

} // namespace aedst::feature::notifications
