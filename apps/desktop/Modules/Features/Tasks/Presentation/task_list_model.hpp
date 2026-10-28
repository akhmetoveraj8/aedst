#pragma once

#include "Domain/task.hpp"

#include <QAbstractListModel>
#include <QDateTime>
#include <QHash>

#include <optional>
#include <vector>

namespace aedst::feature::tasks {

/// Rows for TaskListView's ListView (QAbstractListModel with roles, never a
/// QVariantList - see docs/performance.md).
class TaskListModel final : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(int count READ count NOTIFY countChanged)

public:
    enum Role {
        TaskIdRole = Qt::UserRole + 1,
        TitleRole,
        DescriptionRole,
        StatusRole,
        DoneRole,
        PriorityRole,
        DueDateRole,
        OverdueRole,
        PendingSyncRole,
    };

    explicit TaskListModel(QObject* parent = nullptr);

    [[nodiscard]] int rowCount(const QModelIndex& parent = {}) const override;
    [[nodiscard]] QVariant data(const QModelIndex& index, int role) const override;
    [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

    [[nodiscard]] int count() const { return rowCount(); }

    void setTasks(std::vector<Task> tasks);
    void appendTasks(std::vector<Task> tasks);
    /// Replaces the row with the same id (after complete/reopen); no-op otherwise.
    void update(const Task& task);
    void prepend(Task task);
    void remove(const std::string& id);
    [[nodiscard]] std::optional<Task> find(const std::string& id) const;

    [[nodiscard]] static QDateTime toQDateTime(const std::optional<std::chrono::system_clock::time_point>& when);

signals:
    void countChanged();

private:
    [[nodiscard]] int indexOf(const std::string& id) const;

    std::vector<Task> tasks_;
};

} // namespace aedst::feature::tasks
