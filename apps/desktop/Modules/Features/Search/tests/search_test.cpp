#include "Domain/search_repository.hpp"
#include "Domain/snippet.hpp"
#include "Presentation/search_results_model.hpp"
#include "Presentation/search_view_model.hpp"

#include <QSignalSpy>
#include <QTest>

#include <functional>
#include <memory>
#include <string>
#include <vector>

using namespace aedst::feature::search;

namespace {

const std::string kOn(kHighlightStart);
const std::string kOff(kHighlightEnd);

/// Records calls; the test completes them by hand (out of order on purpose).
class FakeSearchRepository final : public SearchRepository {
public:
    void search(const SearchQuery& query, aedst::core::Completion<SearchPage> done) override {
        queries.push_back(query.text);
        pending.push_back(std::move(done));
    }

    void suggest(const std::string& /*prefix*/, int /*limit*/,
                 aedst::core::Completion<std::vector<std::string>> done) override {
        done(std::vector<std::string>{"alpha"});
    }

    std::vector<std::string> queries;
    std::vector<aedst::core::Completion<SearchPage>> pending;
};

SearchPage pageWithTitle(const std::string& title) {
    SearchPage page;
    page.hits.push_back(SearchHit{.kind = DocumentKind::Task, .id = "1", .title = title, .link = "/tasks/1"});
    return page;
}

} // namespace

class SearchTest : public QObject {
    Q_OBJECT

private slots:

    void parsesHighlightMarkers() {
        const auto segments = parseSnippet("buy " + kOn + "milk" + kOff + " and " + kOn + "eggs" + kOff);
        QCOMPARE(segments.size(), std::size_t{4});
        QCOMPARE(segments[1].text, std::string("milk"));
        QVERIFY(segments[1].highlighted);
        QVERIFY(!segments[2].highlighted);
    }

    void toleratesBrokenMarkers() {
        // Unterminated highlight runs to the end; stray end markers vanish.
        auto segments = parseSnippet("a" + kOff + "b" + kOn + "c");
        QCOMPARE(segments.size(), std::size_t{2});
        QCOMPARE(segments[0].text, std::string("ab"));
        QVERIFY(segments[1].highlighted);
        QVERIFY(parseSnippet("").empty());
        QCOMPARE(parseSnippet(kOn + kOn + "x" + kOff).size(), std::size_t{1});
    }

    void escapesBeforeHighlighting() {
        const QString html = snippetToStyledText(parseSnippet("<img src=x>" + kOn + "a&b" + kOff));
        QCOMPARE(html, QStringLiteral("&lt;img src=x&gt;<b>a&amp;b</b>"));
    }

    void normalizesQueries() {
        QCOMPARE(normalizeQuery("   "), std::string());
        QCOMPARE(normalizeQuery("  milk \n"), std::string("milk"));
        std::string longText;
        for (int i = 0; i < 250; ++i) {
            longText += "\xD0\x96";
        }
        QCOMPARE(countCodePoints(normalizeQuery(longText)), kMaxQueryChars);
    }

    void debouncesAndDropsStaleResponses() {
        auto repository = std::make_shared<FakeSearchRepository>();
        SearchViewModel viewModel(repository, nullptr, nullptr, nullptr);

        viewModel.setQuery(QStringLiteral("m"));
        viewModel.setQuery(QStringLiteral("mi"));
        viewModel.setQuery(QStringLiteral("milk"));
        QVERIFY(repository->queries.empty()); // still waiting for the pause
        QTRY_COMPARE_WITH_TIMEOUT(repository->queries.size(), std::size_t{1}, SearchViewModel::kDebounceMs * 5);
        QCOMPARE(repository->queries.front(), std::string("milk"));

        viewModel.setQuery(QStringLiteral("eggs"));
        viewModel.submit(); // Enter: no wait
        QCOMPARE(repository->queries.size(), std::size_t{2});

        // The newer response lands first, then the stale one: the stale one is ignored.
        repository->pending[1](pageWithTitle("eggs result"));
        repository->pending[0](pageWithTitle("milk result"));
        QCOMPARE(viewModel.resultsModel().count(), 1);
        QCOMPARE(
            viewModel.resultsModel().data(viewModel.resultsModel().index(0), SearchResultsModel::TitleRole).toString(),
            QStringLiteral("eggs result"));
        QCOMPARE(viewModel.suggestions(), QStringList{QStringLiteral("alpha")});
    }
};

QTEST_GUILESS_MAIN(SearchTest)
#include "search_test.moc"
