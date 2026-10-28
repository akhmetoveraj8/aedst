// QtQuickTest runner for AdminView.qml. The view is loaded from its source path against the REAL AdminViewModel fed by
// a scripted repository (the module's static plugin is not linked into this executable, so the singleton is registered
// here under the URI the QML imports).
#include "Domain/admin_repository.hpp"
#include "Presentation/admin_view_model.hpp"
#include "aedst/analytics/no_op_analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"
#include "aedst/designsystem/theme_controller.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QQmlContext>
#include <QQmlEngine>
#include <QUrl>
#include <QtQml>
#include <QtQuickTest>

#include <expected>
#include <memory>
#include <optional>
#include <utility>

namespace {

using namespace aedst::feature::admin;
namespace network = aedst::network;

/// Answers every call at once; `forbidden` makes them all permission_denied; the last broadcast request is recorded.
class ScriptedRepository final : public AdminRepository {
public:
    bool forbidden{false};
    int broadcastCalls{0};

    void overview(network::ApiCompletion<adminv1::GetOverviewResponse> done) override {
        if (denyIfForbidden(done)) {
            return;
        }
        adminv1::GetOverviewResponse response;
        response.set_users_total(42);
        response.set_tasks_done(60);
        done(std::move(response));
    }

    void listUsers(const adminv1::ListUsersRequest&, network::ApiCompletion<adminv1::ListUsersResponse> done) override {
        if (denyIfForbidden(done)) {
            return;
        }
        adminv1::ListUsersResponse response;
        auto* user = response.add_users();
        user->set_id("u-1");
        user->set_email("ada@example.com");
        user->set_display_name("Ada Lovelace");
        done(std::move(response));
    }

    void listAuditLog(const adminv1::ListAuditLogRequest&,
                      network::ApiCompletion<adminv1::ListAuditLogResponse> done) override {
        if (denyIfForbidden(done)) {
            return;
        }
        adminv1::ListAuditLogResponse response;
        response.add_entries()->set_action("broadcast");
        done(std::move(response));
    }

    void broadcast(const adminv1::BroadcastNotificationRequest&,
                   network::ApiCompletion<adminv1::BroadcastNotificationResponse> done) override {
        ++broadcastCalls;
        adminv1::BroadcastNotificationResponse response;
        response.set_recipients(3);
        done(std::move(response));
    }

private:
    template <typename Completion>
    bool denyIfForbidden(Completion& done) {
        if (!forbidden) {
            return false;
        }
        done(std::unexpected(
            network::ApiError{.kind = network::ApiErrorKind::PermissionDenied, .httpStatus = 403, .message = "no"}));
        return true;
    }
};

class Setup final : public QObject {
    Q_OBJECT

public slots:

    void qmlEngineAvailable(QQmlEngine* engine) {
        aedst::qmlsupport::SingletonSlot<aedst::designsystem::ThemeController>::provide(&theme_);
        viewModel_ = std::make_unique<AdminViewModel>(repository_, std::make_shared<aedst::core::NullErrorSink>(),
                                                      std::make_shared<aedst::analytics::NoOpAnalyticsTracker>());
        qmlRegisterSingletonInstance("Aedst.Feature.Admin", 1, 0, "AdminViewModel", viewModel_.get());
        engine->rootContext()->setContextProperty(QStringLiteral("adminQmlDir"),
                                                  QUrl::fromLocalFile(QStringLiteral(AEDST_ADMIN_QML_DIR)));
        engine->rootContext()->setContextProperty(QStringLiteral("adminViewModel"), viewModel_.get());
        engine->rootContext()->setContextProperty(QStringLiteral("scriptedRepository"), this);
    }

public:
    Q_INVOKABLE void setForbidden(bool value) { repository_->forbidden = value; }

    Q_INVOKABLE int broadcastCalls() const { return repository_->broadcastCalls; }

private:
    aedst::designsystem::ThemeController theme_;
    std::shared_ptr<ScriptedRepository> repository_ = std::make_shared<ScriptedRepository>();
    std::unique_ptr<AdminViewModel> viewModel_;
};

} // namespace

QUICK_TEST_MAIN_WITH_SETUP(tst_admin_view, Setup)

#include "qml_test_main.moc"
