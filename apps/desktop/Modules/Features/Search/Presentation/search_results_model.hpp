#pragma once

#include "Domain/search_hit.hpp"

#include <QAbstractListModel>
#include <QHash>
#include <QString>

#include <vector>

namespace aedst::feature::search {

/// Qt rich text for a parsed snippet: every run is HTML-escaped first (server text
/// is untrusted), highlighted runs are wrapped in <b>. Safe for Text.StyledText.
[[nodiscard]] QString snippetToStyledText(const std::vector<SnippetSegment>& segments);

class SearchResultsModel final : public QAbstractListModel {
    Q_OBJECT
    Q_PROPERTY(int count READ count NOTIFY countChanged)

public:
    enum Role {
        HitIdRole = Qt::UserRole + 1,
        KindRole,
        TitleRole,
        SnippetRole,
        SnippetPlainRole,
        LinkRole,
        UpdatedAtRole,
    };

    explicit SearchResultsModel(QObject* parent = nullptr);

    [[nodiscard]] int rowCount(const QModelIndex& parent = {}) const override;
    [[nodiscard]] QVariant data(const QModelIndex& index, int role) const override;
    [[nodiscard]] QHash<int, QByteArray> roleNames() const override;

    [[nodiscard]] int count() const { return rowCount(); }

    void setHits(std::vector<SearchHit> hits);
    void appendHits(std::vector<SearchHit> hits);
    [[nodiscard]] const SearchHit* at(int row) const;

signals:
    void countChanged();

private:
    std::vector<SearchHit> hits_;
};

} // namespace aedst::feature::search
