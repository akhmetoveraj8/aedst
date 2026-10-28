#include "Presentation/task_list_model.hpp"

#include <QTimeZone>

#include <algorithm>
#include <chrono>
#include <iterator>
#include <utility>

namespace aedst::feature::tasks {

TaskListModel::TaskListModel(QObject* parent) : QAbstractListModel(parent) {}

int TaskListModel::rowCount(const QModelIndex& parent) const {
    return parent.isValid() ? 0 : static_cast<int>(tasks_.size());
}

QDateTime TaskListModel::toQDateTime(const std::optional<std::chrono::system_clock::time_point>& when) {
    if (!when) {
        return {};
    }
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(when->time_since_epoch()).count();
    return QDateTime::fromMSecsSinceEpoch(ms, QTimeZone::UTC).toLocalTime();
}

QVariant TaskListModel::data(const QModelIndex& index, int role) const {
    if (!checkIndex(index, CheckIndexOption::IndexIsValid | CheckIndexOption::ParentIsInvalid)) {
        return {};
    }
    const Task& task = tasks_.at(static_cast<std::size_t>(index.row()));
    switch (role) {
    case Qt::DisplayRole:
    case TitleRole:
        return QString::fromStdString(task.title);
    case TaskIdRole:
        return QString::fromStdString(task.id);
    case DescriptionRole:
        return QString::fromStdString(task.description);
    case StatusRole: {
        const std::string_view name = toString(task.status);
        return QString::fromUtf8(name.data(), static_cast<qsizetype>(name.size()));
    }
    case DoneRole:
        return task.isDone();
    case PriorityRole:
        return static_cast<int>(task.priority);
    case DueDateRole:
        return toQDateTime(task.dueDate);
    case OverdueRole:
        return task.isOverdue(std::chrono::system_clock::now());
    case PendingSyncRole:
        return task.pendingSync;
    default:
        break;
    }
    return {};
}

QHash<int, QByteArray> TaskListModel::roleNames() const {
    return {
        {TaskIdRole, "taskId"},   {TitleRole, "title"},     {DescriptionRole, "description"},
        {StatusRole, "status"},   {DoneRole, "done"},       {PriorityRole, "priority"},
        {DueDateRole, "dueDate"}, {OverdueRole, "overdue"}, {PendingSyncRole, "pendingSync"},
    };
}

void TaskListModel::setTasks(std::vector<Task> tasks) {
    const bool countChanges = tasks.size() != tasks_.size();
    beginResetModel();
    tasks_ = std::move(tasks);
    endResetModel();
    if (countChanges) {
        emit countChanged();
    }
}

void TaskListModel::appendTasks(std::vector<Task> tasks) {
    if (tasks.empty()) {
        return;
    }
    const int first = static_cast<int>(tasks_.size());
    beginInsertRows({}, first, first + static_cast<int>(tasks.size()) - 1);
    std::ranges::move(tasks, std::back_inserter(tasks_));
    endInsertRows();
    emit countChanged();
}

void TaskListModel::update(const Task& task) {
    const int row = indexOf(task.id);
    if (row < 0) {
        return;
    }
    tasks_[static_cast<std::size_t>(row)] = task;
    emit dataChanged(index(row), index(row));
}

void TaskListModel::prepend(Task task) {
    beginInsertRows({}, 0, 0);
    tasks_.insert(tasks_.begin(), std::move(task));
    endInsertRows();
    emit countChanged();
}

void TaskListModel::remove(const std::string& id) {
    const int row = indexOf(id);
    if (row < 0) {
        return;
    }
    beginRemoveRows({}, row, row);
    tasks_.erase(tasks_.begin() + row);
    endRemoveRows();
    emit countChanged();
}

std::optional<Task> TaskListModel::find(const std::string& id) const {
    const int row = indexOf(id);
    return row < 0 ? std::nullopt : std::optional(tasks_.at(static_cast<std::size_t>(row)));
}

int TaskListModel::indexOf(const std::string& id) const {
    const auto it = std::ranges::find_if(tasks_, [&id](const Task& task) { return task.id == id; });
    return it == tasks_.end() ? -1 : static_cast<int>(std::distance(tasks_.begin(), it));
}

} // namespace aedst::feature::tasks
