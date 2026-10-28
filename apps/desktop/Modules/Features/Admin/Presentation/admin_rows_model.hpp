#pragma once

#include <QAbstractListModel>
#include <QByteArray>
#include <QHash>
#include <QList>
#include <QVariant>

namespace aedst::feature::admin {

/// Read-only table rows for the admin lists (users, audit log). Each row is a
/// fixed set of named cells; roles are the column names, so QML delegates use
/// `required property string email` etc. Small pages (<= 100 rows) only.
class AdminRowsModel final : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(int count READ count NOTIFY countChanged)

public:
    explicit AdminRowsModel(QList<QByteArray> columns, QObject* parent = nullptr);

    [[nodiscard]] int rowCount(const QModelIndex& parent = {}) const override;
    [[nodiscard]] QVariant data(const QModelIndex& index, int role) const override;
    [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

    [[nodiscard]] int count() const { return rowCount(); }

    /// Each inner list holds one value per column, in column order.
    void setRows(QList<QVariantList> rows);
    void appendRows(QList<QVariantList> rows);

signals:
    void countChanged();

private:
    QList<QByteArray> columns_;
    QList<QVariantList> rows_;
};

} // namespace aedst::feature::admin
