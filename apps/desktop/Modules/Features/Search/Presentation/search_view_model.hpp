#pragma once

#include "Presentation/search_results_model.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QStringList>
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

namespace aedst::navigation {
class Router;
} // namespace aedst::navigation

namespace aedst::feature::search {

class SearchRepository;

/// Search-as-you-type over aedst.search.v1:
///  - `query` changes restart a single-shot QTimer (kDebounceMs); when it fires,
///    Suggest (prefix <= 100 chars) and Search run once for the settled text;
///    submit() (Enter) skips the wait;
///  - responses are tagged with a sequence number, so an older, slower response
///    can never overwrite the results of a newer query;
///  - snippets arrive parsed (Domain/snippet) and are rendered as escaped
///    StyledText with <b> highlights by SearchResultsModel;
///  - opening a hit goes through Router::openLink(link) - the allow-listed
///    relative route the server sent ("/tasks/<id>"), so Search never knows
///    another feature's types.
class SearchViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(QString query READ query WRITE setQuery NOTIFY queryChanged)
    Q_PROPERTY(QString kindFilter READ kindFilter WRITE setKindFilter NOTIFY kindFilterChanged)
    Q_PROPERTY(QAbstractItemModel* results READ results CONSTANT)
    Q_PROPERTY(QStringList suggestions READ suggestions NOTIFY suggestionsChanged)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(bool hasSearched READ hasSearched NOTIFY hasSearchedChanged)
    Q_PROPERTY(bool hasMore READ hasMore NOTIFY hasMoreChanged)
    Q_PROPERTY(int totalEstimate READ totalEstimate NOTIFY totalEstimateChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)

public:
    static SearchViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<SearchViewModel>::create(engine, script);
    }

    static constexpr int kDebounceMs = 300;
    static constexpr int kSuggestionLimit = 8;

    SearchViewModel(std::shared_ptr<SearchRepository> repository, std::shared_ptr<core::ErrorSink> errors,
                    std::shared_ptr<analytics::AnalyticsTracker> analytics, navigation::Router* router,
                    QObject* parent = nullptr);

    [[nodiscard]] QString query() const { return query_; }

    void setQuery(const QString& query);

    /// "all" | "task" | "media".
    [[nodiscard]] QString kindFilter() const { return kindFilter_; }

    void setKindFilter(const QString& kind);

    [[nodiscard]] QAbstractItemModel* results() noexcept { return &results_; }

    [[nodiscard]] SearchResultsModel& resultsModel() noexcept { return results_; }

    [[nodiscard]] QStringList suggestions() const { return suggestions_; }

    [[nodiscard]] bool isLoading() const noexcept { return isLoading_; }

    [[nodiscard]] bool hasSearched() const noexcept { return hasSearched_; }

    [[nodiscard]] bool hasMore() const { return !nextPageToken_.empty(); }

    [[nodiscard]] int totalEstimate() const noexcept { return totalEstimate_; }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    [[nodiscard]] bool isDebouncing() const { return debounce_.isActive(); }

    Q_INVOKABLE void submit();
    Q_INVOKABLE void loadMore();
    Q_INVOKABLE void openResult(int row);
    Q_INVOKABLE void clear();

signals:
    void queryChanged();
    void kindFilterChanged();
    void suggestionsChanged();
    void isLoadingChanged();
    void hasSearchedChanged();
    void hasMoreChanged();
    void totalEstimateChanged();
    void errorMessageChanged();

private:
    void runSearch(bool append);
    void runSuggest(const std::string& prefix);
    void setLoading(bool loading);
    void setErrorMessage(const QString& message);
    void setNextPageToken(std::string token);
    void setSuggestions(QStringList suggestions);

    std::shared_ptr<SearchRepository> repository_;
    std::shared_ptr<core::ErrorSink> errors_;
    std::shared_ptr<analytics::AnalyticsTracker> analytics_;
    navigation::Router* router_;

    SearchResultsModel results_;
    QTimer debounce_;
    QString query_;
    QString kindFilter_{QStringLiteral("all")};
    QStringList suggestions_;
    QString errorMessage_;
    std::string activeQuery_;
    std::string nextPageToken_;
    int totalEstimate_{0};
    bool isLoading_{false};
    bool hasSearched_{false};
    quint64 searchSeq_{0};
    quint64 suggestSeq_{0};
};

} // namespace aedst::feature::search
