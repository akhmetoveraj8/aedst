#include "Presentation/search_results_model.hpp"

#include <QDateTime>
#include <QTimeZone>

#include <algorithm>
#include <chrono>
#include <iterator>
#include <utility>

namespace aedst::feature::search {

QString snippetToStyledText(const std::vector<SnippetSegment>& segments) {
    QString out;
    for (const SnippetSegment& segment : segments) {
        const QString escaped = QString::fromStdString(segment.text).toHtmlEscaped();
        if (segment.highlighted) {
            out += QStringLiteral("<b>") + escaped + QStringLiteral("</b>");
        } else {
            out += escaped;
        }
    }
    return out;
}

SearchResultsModel::SearchResultsModel(QObject* parent) : QAbstractListModel(parent) {}

int SearchResultsModel::rowCount(const QModelIndex& parent) const {
    return parent.isValid() ? 0 : static_cast<int>(hits_.size());
}

QVariant SearchResultsModel::data(const QModelIndex& index, int role) const {
    if (!checkIndex(index, CheckIndexOption::IndexIsValid | CheckIndexOption::ParentIsInvalid)) {
        return {};
    }
    const SearchHit& hit = hits_.at(static_cast<std::size_t>(index.row()));
    switch (role) {
    case Qt::DisplayRole:
    case TitleRole:
        return QString::fromStdString(hit.title);
    case HitIdRole:
        return QString::fromStdString(hit.id);
    case KindRole: {
        const std::string_view kind = toString(hit.kind);
        return QString::fromUtf8(kind.data(), static_cast<qsizetype>(kind.size()));
    }
    case SnippetRole:
        return snippetToStyledText(hit.snippet);
    case SnippetPlainRole: {
        QString plain;
        for (const auto& segment : hit.snippet) {
            plain += QString::fromStdString(segment.text);
        }
        return plain;
    }
    case LinkRole:
        return QString::fromStdString(hit.link);
    case UpdatedAtRole:
        if (hit.updatedAt) {
            const auto ms =
                std::chrono::duration_cast<std::chrono::milliseconds>(hit.updatedAt->time_since_epoch()).count();
            return QDateTime::fromMSecsSinceEpoch(ms, QTimeZone::UTC).toLocalTime();
        }
        return QDateTime();
    default:
        break;
    }
    return {};
}

QHash<int, QByteArray> SearchResultsModel::roleNames() const {
    return {
        {HitIdRole, "hitId"},
        {KindRole, "kind"},
        {TitleRole, "title"},
        {SnippetRole, "snippet"},
        {SnippetPlainRole, "snippetPlain"},
        {LinkRole, "link"},
        {UpdatedAtRole, "updatedAt"},
    };
}

void SearchResultsModel::setHits(std::vector<SearchHit> hits) {
    const bool countChanges = hits.size() != hits_.size();
    beginResetModel();
    hits_ = std::move(hits);
    endResetModel();
    if (countChanges) {
        emit countChanged();
    }
}

void SearchResultsModel::appendHits(std::vector<SearchHit> hits) {
    if (hits.empty()) {
        return;
    }
    const int first = static_cast<int>(hits_.size());
    beginInsertRows({}, first, first + static_cast<int>(hits.size()) - 1);
    std::ranges::move(hits, std::back_inserter(hits_));
    endInsertRows();
    emit countChanged();
}

const SearchHit* SearchResultsModel::at(int row) const {
    return row >= 0 && row < static_cast<int>(hits_.size()) ? &hits_.at(static_cast<std::size_t>(row)) : nullptr;
}

} // namespace aedst::feature::search
