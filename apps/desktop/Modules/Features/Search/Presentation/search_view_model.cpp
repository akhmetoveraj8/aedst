#include "Presentation/search_view_model.hpp"

#include "Domain/search_repository.hpp"
#include "Domain/snippet.hpp"
#include "aedst/analytics/analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"
#include "aedst/navigation/router.hpp"

#include <QPointer>

#include <utility>

namespace aedst::feature::search {

SearchViewModel::SearchViewModel(std::shared_ptr<SearchRepository> repository, std::shared_ptr<core::ErrorSink> errors,
                                 std::shared_ptr<analytics::AnalyticsTracker> analytics, navigation::Router* router,
                                 QObject* parent)
    : QObject(parent),
      repository_(std::move(repository)),
      errors_(std::move(errors)),
      analytics_(std::move(analytics)),
      router_(router) {
    debounce_.setSingleShot(true);
    debounce_.setInterval(kDebounceMs);
    connect(&debounce_, &QTimer::timeout, this, &SearchViewModel::submit);
}

void SearchViewModel::setQuery(const QString& query) {
    if (query == query_) {
        return;
    }
    query_ = query;
    emit queryChanged();
    if (normalizeQuery(query_.toStdString()).empty()) {
        debounce_.stop();
        clear();
        return;
    }
    debounce_.start(); // restart: only the text the user paused on is sent
}

void SearchViewModel::setKindFilter(const QString& kind) {
    if (kind == kindFilter_) {
        return;
    }
    kindFilter_ = kind;
    emit kindFilterChanged();
    if (!activeQuery_.empty()) {
        submit();
    }
}

void SearchViewModel::submit() {
    debounce_.stop();
    const std::string normalized = normalizeQuery(query_.toStdString());
    if (normalized.empty()) {
        return;
    }
    activeQuery_ = normalized;
    if (countCodePoints(normalized) <= kMaxSuggestPrefixChars) {
        runSuggest(normalized);
    }
    runSearch(false);
}

void SearchViewModel::loadMore() {
    if (!hasMore() || isLoading_) {
        return;
    }
    runSearch(true);
}

void SearchViewModel::runSearch(bool append) {
    setErrorMessage({});
    setLoading(true);
    SearchQuery request{.text = activeQuery_, .kinds = {}, .pageToken = append ? nextPageToken_ : std::string()};
    if (kindFilter_ == QStringLiteral("task")) {
        request.kinds.push_back(DocumentKind::Task);
    } else if (kindFilter_ == QStringLiteral("media")) {
        request.kinds.push_back(DocumentKind::Media);
    }
    const quint64 seq = ++searchSeq_;
    QPointer<SearchViewModel> guard(this);
    repository_->search(request, [guard, seq, append](core::Outcome<SearchPage> result) {
        if (!guard || seq != guard->searchSeq_) {
            return; // destroyed, or a newer query is in flight
        }
        guard->setLoading(false);
        if (!guard->hasSearched_) {
            guard->hasSearched_ = true;
            emit guard->hasSearchedChanged();
        }
        if (!result) {
            guard->setErrorMessage(QString::fromStdString(result.error().message));
            if (guard->errors_) {
                guard->errors_->report(result.error(), "search.query", core::ErrorVisibility::Silent);
            }
            return;
        }
        if (append) {
            guard->results_.appendHits(std::move(result->hits));
        } else {
            guard->results_.setHits(std::move(result->hits));
            if (result->totalEstimate != guard->totalEstimate_) {
                guard->totalEstimate_ = result->totalEstimate;
                emit guard->totalEstimateChanged();
            }
            if (guard->analytics_) {
                // Never the query text itself: it is user content.
                guard->analytics_->track(analytics::events::kSearchPerformed,
                                         {{"kind", guard->kindFilter_.toStdString()},
                                          {"has_results", guard->results_.count() > 0 ? "true" : "false"}});
            }
        }
        guard->setNextPageToken(std::move(result->nextPageToken));
    });
}

void SearchViewModel::runSuggest(const std::string& prefix) {
    const quint64 seq = ++suggestSeq_;
    QPointer<SearchViewModel> guard(this);
    repository_->suggest(prefix, kSuggestionLimit, [guard, seq](core::Outcome<std::vector<std::string>> result) {
        if (!guard || seq != guard->suggestSeq_ || !result) {
            return; // suggestions are best-effort; failures stay silent
        }
        QStringList suggestions;
        for (const auto& suggestion : *result) {
            suggestions.append(QString::fromStdString(suggestion));
        }
        guard->setSuggestions(std::move(suggestions));
    });
}

void SearchViewModel::openResult(int row) {
    const SearchHit* hit = results_.at(row);
    if (hit == nullptr || router_ == nullptr) {
        return;
    }
    if (router_->openLink(QString::fromStdString(hit->link)) && analytics_) {
        const std::string_view kind = toString(hit->kind);
        analytics_->track(analytics::events::kSearchResultOpened, {{"kind", std::string(kind)}});
    }
}

void SearchViewModel::clear() {
    ++searchSeq_;
    ++suggestSeq_;
    activeQuery_.clear();
    results_.setHits({});
    setSuggestions({});
    setNextPageToken({});
    setErrorMessage({});
    setLoading(false);
    if (hasSearched_) {
        hasSearched_ = false;
        emit hasSearchedChanged();
    }
}

void SearchViewModel::setLoading(bool loading) {
    if (loading != isLoading_) {
        isLoading_ = loading;
        emit isLoadingChanged();
    }
}

void SearchViewModel::setErrorMessage(const QString& message) {
    if (message != errorMessage_) {
        errorMessage_ = message;
        emit errorMessageChanged();
    }
}

void SearchViewModel::setNextPageToken(std::string token) {
    const bool before = hasMore();
    nextPageToken_ = std::move(token);
    if (before != hasMore()) {
        emit hasMoreChanged();
    }
}

void SearchViewModel::setSuggestions(QStringList suggestions) {
    if (suggestions != suggestions_) {
        suggestions_ = std::move(suggestions);
        emit suggestionsChanged();
    }
}

} // namespace aedst::feature::search
