#include "Domain/admin_repository.hpp"
#include "Presentation/admin_rows_model.hpp"
#include "Presentation/admin_view_model.hpp"
#include "aedst/analytics/no_op_analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"

#include <QSignalSpy>
#include <QTest>

#include <expected>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using namespace aedst::feature::admin;
namespace network = aedst::network;
namespace core = aedst::core;

namespace {

/// Answers at once (the ViewModel must cope with synchronous completions) or fails every call with `failWith`.
class FakeAdminRepository final : public AdminRepository {
public:
    void overview(network::ApiCompletion<adminv1::GetOverviewResponse> done) override {
        ++overviewCalls;
        if (failWith) {
            done(std::unexpected(*failWith));
            return;
        }
        adminv1::GetOverviewResponse response;
        response.set_users_total(42);
        response.set_tasks_total(100);
        response.set_tasks_done(60);
        done(std::move(response));
    }

    void listUsers(const adminv1::ListUsersRequest& request,
                   network::ApiCompletion<adminv1::ListUsersResponse> done) override {
        userQueries.push_back(request.query());
        if (failWith) {
            done(std::unexpected(*failWith));
            return;
        }
        adminv1::ListUsersResponse response;
        auto* user = response.add_users();
        user->set_id("u-1");
        user->set_email("ada@example.com");
        user->set_display_name("Ada");
        user->set_task_count(3);
        done(std::move(response));
    }

    void listAuditLog(const adminv1::ListAuditLogRequest& /*request*/,
                      network::ApiCompletion<adminv1::ListAuditLogResponse> done) override {
        ++auditCalls;
        if (failWith) {
            done(std::unexpected(*failWith));
            return;
        }
        adminv1::ListAuditLogResponse response;
        auto* entry = response.add_entries();
        entry->set_id("a-1");
        entry->set_action("broadcast");
        done(std::move(response));
    }

    void broadcast(const adminv1::BroadcastNotificationRequest& request,
                   network::ApiCompletion<adminv1::BroadcastNotificationResponse> done) override {
        broadcasts.push_back(request);
        if (failWith) {
            done(std::unexpected(*failWith));
            return;
        }
        adminv1::BroadcastNotificationResponse response;
        response.set_recipients(7);
        done(std::move(response));
    }

    std::optional<network::ApiError> failWith;
    int overviewCalls{0};
    int auditCalls{0};
    std::vector<std::string> userQueries;
    std::vector<adminv1::BroadcastNotificationRequest> broadcasts;
};

class RecordingErrors final : public core::ErrorSink {
public:
    struct Report {
        std::string context;
        core::ErrorCode code;
        core::ErrorVisibility visibility;
    };

    void report(const core::Error& error, std::string_view context, core::ErrorVisibility visibility) override {
        reports.push_back(Report{std::string(context), error.code, visibility});
    }

    std::vector<Report> reports;
};

network::ApiError permissionDenied() {
    return network::ApiError{.kind = network::ApiErrorKind::PermissionDenied, .httpStatus = 403, .message = "no"};
}

} // namespace

class AdminViewModelTest : public QObject {
    Q_OBJECT

private slots:

    void init() {
        repository_ = std::make_shared<FakeAdminRepository>();
        errors_ = std::make_shared<RecordingErrors>();
        viewModel_ = std::make_unique<AdminViewModel>(repository_, errors_,
                                                      std::make_shared<aedst::analytics::NoOpAnalyticsTracker>());
    }

    void rowsModelExposesColumnsAsRoles() {
        AdminRowsModel model({"email", "taskCount"});
        model.setRows({QVariantList{"a@b.co", 1}, QVariantList{"c@d.co", 2}});
        QCOMPARE(model.rowCount(), 2);
        const auto roles = model.roleNames();
        QCOMPARE(model.data(model.index(1), roles.key("email")).toString(), QStringLiteral("c@d.co"));
        QCOMPARE(model.data(model.index(0), roles.key("taskCount")).toInt(), 1);
        model.appendRows({QVariantList{"e@f.co", 3}});
        QCOMPARE(model.count(), 3);
    }

    void reloadFillsOverviewUsersAndAuditLog() {
        viewModel_->reload();

        QCOMPARE(viewModel_->overview().value("usersTotal").toLongLong(), 42);
        QCOMPARE(viewModel_->overview().value("tasksDone").toLongLong(), 60);
        QCOMPARE(viewModel_->users()->rowCount(), 1);
        QCOMPARE(viewModel_->auditLog()->rowCount(), 1);
        QVERIFY(!viewModel_->isLoading());
        QVERIFY(!viewModel_->forbidden());
    }

    void aForbiddenAnswerSetsForbiddenInsteadOfAnError() {
        repository_->failWith = permissionDenied();
        QSignalSpy forbidden(viewModel_.get(), &AdminViewModel::forbiddenChanged);

        viewModel_->reload();

        QVERIFY(viewModel_->forbidden());
        QCOMPARE(forbidden.count(), 1);
        QVERIFY(viewModel_->errorMessage().isEmpty());
        QVERIFY(!errors_->reports.empty());
        QCOMPARE(errors_->reports.front().visibility, core::ErrorVisibility::Silent);
    }

    void otherFailuresShowOneErrorMessage() {
        repository_->failWith =
            network::ApiError{.kind = network::ApiErrorKind::Unavailable, .httpStatus = 503, .message = "down"};

        viewModel_->reload();

        QVERIFY(!viewModel_->forbidden());
        QCOMPARE(viewModel_->errorMessage(), QStringLiteral("down"));
    }

    void clearForgetsTheStateAndLeavesForbidden() {
        viewModel_->reload();
        repository_->failWith = permissionDenied();
        viewModel_->reload();
        QVERIFY(viewModel_->forbidden());

        viewModel_->clear();

        QVERIFY(!viewModel_->forbidden());
        QVERIFY(viewModel_->overview().isEmpty());
        QCOMPARE(viewModel_->users()->rowCount(), 0);
        QCOMPARE(viewModel_->auditLog()->rowCount(), 0);
    }

    void theUserQueryIsDebouncedAndTrimmed() {
        viewModel_->setUserQuery(QStringLiteral("  ad"));
        viewModel_->setUserQuery(QStringLiteral("  ada  "));
        QVERIFY2(repository_->userQueries.empty(), "nothing is sent before the debounce interval");

        QTRY_COMPARE_WITH_TIMEOUT(repository_->userQueries.size(), std::size_t{1}, 2000);
        QCOMPARE(repository_->userQueries.front(), std::string("ada"));
    }

    void broadcastRejectsInvalidInputWithoutCallingTheServer() {
        QSignalSpy failed(viewModel_.get(), &AdminViewModel::broadcastFailed);

        viewModel_->broadcast(QString(), QStringLiteral("body"), QString(), QString()); // empty title
        viewModel_->broadcast(QStringLiteral("t"), QString(), QStringLiteral("//evil.example"), QString());
        viewModel_->broadcast(QStringLiteral("t"), QString(), QStringLiteral("https://evil.example"), QString());

        QCOMPARE(failed.count(), 3);
        QVERIFY(repository_->broadcasts.empty());
    }

    void aValidBroadcastReportsRecipientsAndRefreshesTheAuditLog() {
        QSignalSpy sent(viewModel_.get(), &AdminViewModel::broadcastSent);

        viewModel_->broadcast(QStringLiteral("  Maintenance "), QStringLiteral("Tonight"), QStringLiteral("/tasks"),
                              QString());

        QCOMPARE(sent.count(), 1);
        QCOMPARE(sent.first().first().toLongLong(), 7);
        QCOMPARE(repository_->broadcasts.size(), std::size_t{1});
        QCOMPARE(repository_->broadcasts.front().title(), std::string("Maintenance"));
        QCOMPARE(repository_->auditCalls, 1);
        QVERIFY(!viewModel_->isBroadcasting());
    }

private:
    std::shared_ptr<FakeAdminRepository> repository_;
    std::shared_ptr<RecordingErrors> errors_;
    std::unique_ptr<AdminViewModel> viewModel_;
};

QTEST_GUILESS_MAIN(AdminViewModelTest)
#include "admin_view_model_test.moc"
