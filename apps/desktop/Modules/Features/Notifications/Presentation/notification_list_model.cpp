#include "Presentation/notification_list_model.hpp"

#include <QDateTime>
#include <QTimeZone>

#include <algorithm>
#include <iterator>
#include <utility>

namespace aedst::feature::notifications {

NotificationListModel::NotificationListModel(QObject* parent) : QAbstractListModel(parent) {}

int NotificationListModel::rowCount(const QModelIndex& parent) const {
    return parent.isValid() ? 0 : static_cast<int>(items_.size());
}

QVariant NotificationListModel::data(const QModelIndex& index, int role) const {
    if (!checkIndex(index, CheckIndexOption::IndexIsValid | CheckIndexOption::ParentIsInvalid)) {
        return {};
    }
    const Notification& item = items_.at(static_cast<std::size_t>(index.row()));
    switch (role) {
    case Qt::DisplayRole:
    case TitleRole:
        return QString::fromStdString(item.title);
    case NotificationIdRole:
        return QString::fromStdString(item.id);
    case KindRole: {
        const std::string_view kind = toString(item.kind);
        return QString::fromUtf8(kind.data(), static_cast<qsizetype>(kind.size()));
    }
    case BodyRole:
        return QString::fromStdString(item.body);
    case LinkRole:
        return QString::fromStdString(item.link);
    case CreatedAtRole: {
        const auto ms =
            std::chrono::duration_cast<std::chrono::milliseconds>(item.createdAt.time_since_epoch()).count();
        return QDateTime::fromMSecsSinceEpoch(ms, QTimeZone::UTC).toLocalTime();
    }
    case ReadRole:
        return item.isRead();
    default:
        break;
    }
    return {};
}

QHash<int, QByteArray> NotificationListModel::roleNames() const {
    return {
        {NotificationIdRole, "notificationId"},
        {KindRole, "kind"},
        {TitleRole, "title"},
        {BodyRole, "body"},
        {LinkRole, "link"},
        {CreatedAtRole, "createdAt"},
        {ReadRole, "read"},
    };
}

void NotificationListModel::setNotifications(std::vector<Notification> notifications) {
    const bool countChanges = notifications.size() != items_.size();
    beginResetModel();
    items_ = std::move(notifications);
    endResetModel();
    if (countChanges) {
        emit countChanged();
    }
}

void NotificationListModel::appendNotifications(std::vector<Notification> notifications) {
    if (notifications.empty()) {
        return;
    }
    const int first = static_cast<int>(items_.size());
    beginInsertRows({}, first, first + static_cast<int>(notifications.size()) - 1);
    std::ranges::move(notifications, std::back_inserter(items_));
    endInsertRows();
    emit countChanged();
}

void NotificationListModel::prependNotification(Notification notification) {
    const bool known =
        std::ranges::any_of(items_, [&notification](const Notification& item) { return item.id == notification.id; });
    if (known) {
        return;
    }
    beginInsertRows({}, 0, 0);
    items_.insert(items_.begin(), std::move(notification));
    endInsertRows();
    emit countChanged();
}

std::vector<std::string> NotificationListModel::markRead(const std::vector<std::string>& ids,
                                                         std::chrono::system_clock::time_point when) {
    std::vector<std::string> changed;
    for (std::size_t row = 0; row < items_.size(); ++row) {
        Notification& item = items_[row];
        if (!item.isRead() && std::ranges::find(ids, item.id) != ids.end()) {
            item.readAt = when;
            changed.push_back(item.id);
            const QModelIndex idx = index(static_cast<int>(row));
            emit dataChanged(idx, idx, {ReadRole});
        }
    }
    return changed;
}

void NotificationListModel::markAllRead(std::chrono::system_clock::time_point when) {
    for (Notification& item : items_) {
        if (!item.isRead()) {
            item.readAt = when;
        }
    }
    if (!items_.empty()) {
        emit dataChanged(index(0), index(static_cast<int>(items_.size()) - 1), {ReadRole});
    }
}

const Notification* NotificationListModel::at(int row) const {
    return row >= 0 && row < static_cast<int>(items_.size()) ? &items_.at(static_cast<std::size_t>(row)) : nullptr;
}

} // namespace aedst::feature::notifications
