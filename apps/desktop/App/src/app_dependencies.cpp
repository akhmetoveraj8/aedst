#include "app_dependencies.hpp"

#include "Data/connect_admin_repository.hpp"
#include "Data/connect_auth_remote_data_source.hpp"
#include "Data/connect_notification_repository.hpp"
#include "Data/connect_notification_stream.hpp"
#include "Data/connect_search_repository.hpp"
#include "Data/connect_task_repository.hpp"
#include "Data/oidc_auth_repository.hpp"
#include "Domain/browser_sign_in_use_case.hpp"
#include "Domain/create_task_use_case.hpp"
#include "Domain/login_use_case.hpp"
#include "Domain/logout_use_case.hpp"
#include "Navigation/admin_destinations.hpp"
#include "Navigation/auth_destinations.hpp"
#include "Navigation/auth_route.hpp"
#include "Navigation/media_destinations.hpp"
#include "Navigation/notifications_destinations.hpp"
#include "Navigation/search_destinations.hpp"
#include "Navigation/tasks_destinations.hpp"
#include "Navigation/tasks_route.hpp"
#include "Presentation/admin_view_model.hpp"
#include "Presentation/media_library_view_model.hpp"
#include "Presentation/media_viewer_view_model.hpp"
#include "Presentation/notifications_view_model.hpp"
#include "Presentation/search_view_model.hpp"
#include "Presentation/task_detail_view_model.hpp"
#include "Presentation/task_list_view_model.hpp"
#include "aedst/capabilities/capabilities_service.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/media/media_remote_data_source.hpp"
#include "aedst/network/access_token_claims.hpp"
#include "aedst/network/client_identification.hpp"
#include "aedst/network/transport_policy.hpp"
#include "aedst/oidc/oidc_session.hpp"
#include "aedst/oidc/refresh_token_store.hpp"
#include "aedst/outbox/outbox_queue.hpp"
#include "aedst/persistence/master_key_provider.hpp"
#include "aedst/telemetry/sentry_reporter.hpp"
#include "plugin_host.hpp"

#include <QCoreApplication>
#include <QMetaObject>
#include <QObject>

#include <functional>
#include <optional>
#include <utility>

namespace aedst::app {

namespace auth = feature::auth;
namespace tasks = feature::tasks;
namespace search = feature::search;
namespace notifications = feature::notifications;
namespace mediafeature = feature::media;
namespace admin = feature::admin;

AppDependencies::~AppDependencies() = default;

core::Outcome<std::unique_ptr<AppDependencies>>
AppDependencies::create(const AppConfig& config, platform::NotificationService& desktopNotifier) {
    // Private constructor, so no make_unique.
    std::unique_ptr<AppDependencies> deps(new AppDependencies());
    deps->rolesClaim_ = config.rolesClaim;

    const bool useOidc = config.oidc.isConfigured();

    // --- Cross-cutting: telemetry (consent-gated), errors, theme ---------------
    deps->clock_ = std::make_shared<core::SystemClock>();
    deps->crashConsent_ = std::make_unique<crash::FileConsentStore>(config.dataDirectory / "crash_consent");
    deps->analyticsConsent_ = std::make_unique<crash::FileConsentStore>(config.dataDirectory / "analytics_consent");
    deps->analytics_ = std::make_shared<telemetry::PostHogAnalyticsTracker>(config.posthog);
    deps->telemetrySettings_ = std::make_unique<telemetry::TelemetrySettings>(
        *deps->crashConsent_, *deps->analyticsConsent_, *deps->analytics_, config.crashReportingConfigured);
    deps->telemetrySettings_->applyStoredDecisions();
    deps->errorCenter_ = std::make_shared<telemetry::ErrorCenter>();
    deps->theme_ = std::make_unique<designsystem::ThemeController>();
    deps->network_ = std::make_unique<QNetworkAccessManager>();
    deps->session_ = std::make_unique<SessionInfo>();

    // --- Navigation: the only place every feature's destinations meet ---------
    deps->navGraph_ = std::make_shared<navigation::NavGraph>();
    // Every feature is a plugin (ADR-0033): validated, capability-gated, then its routes join the graph.
    deps->plugins_ = std::make_unique<PluginHost>();
    deps->plugins_->addRuntimePlugins(); // no-op unless built with AEDST_ENABLE_RUNTIME_PLUGINS
    // The plugins are activated, and the router built from their routes, after the API client exists (below): a
    // plugin's registerServices() receives the ConnectClient and the OutboxHandlers it contributes to.
    // App-level screens that no feature owns:
    deps->navGraph_->registerDestination(navigation::routes::kUpgradeRequired,
                                         QUrl(QStringLiteral("qrc:/qt/qml/Aedst/App/UpgradeRequiredView.qml")));

    // --- Database thread (shared by the first-party token store and the offline outbox) ----------------------------
    // One thread owns SQLite (ADR-0028): opening the file, the schema migration, the OS keyring probe for the master
    // key and every row access happen there, never on the GUI thread. Completions come back through a queued call on
    // the application object. A database that cannot be opened does not stop the app: the first-party session just
    // cannot be stored (the error reaches the login screen) and offline writes are refused.
    persistence::Dispatcher toGuiThread = [](std::function<void()> work) {
        if (QCoreApplication* application = QCoreApplication::instance()) {
            QMetaObject::invokeMethod(application, std::move(work), Qt::QueuedConnection);
        }
    };
    auto worker = std::make_shared<persistence::DatabaseWorker>(config.dataDirectory / "aedst.sqlite3");
    deps->databaseWorker_ = worker; // see the member's comment: last owner, released on the GUI thread

    // --- Network ---------------------------------------------------------------
    std::shared_ptr<const network::TokenProvider> tokenProvider;
    if (!useOidc) {
        // First-party (password) login: the session is stored in SQLite on the database thread (see above).
        // Master key lives in the OS credential store (DPAPI-wrapped file on Windows, Secret Service on Linux) with
        // a 0600 key file only as fallback; the provider is created lazily ON the database thread.
        deps->asyncTokenStore_ = std::make_shared<persistence::AsyncTokenStore>(
            worker,
            [dataDirectory = config.dataDirectory]() {
                return persistence::createPlatformMasterKeyProvider(dataDirectory);
            },
            toGuiThread);
        deps->tokenAdapter_ = std::make_shared<auth::LocalTokenStoreAdapter>(deps->asyncTokenStore_);
        tokenProvider = deps->tokenAdapter_;
    } else {
        if (auto valid = oidc::validateOidcConfig(config.oidc); !valid) {
            return core::fail(valid.error());
        }
        // The refresh token lives in the OS credential store only (Credential Manager / Secret Service).
        // If that is unavailable, sign-in fails with an explicit message; there is no file fallback.
        oidc::OidcSession::Dependencies oidcDeps;
        oidcDeps.network = deps->network_.get();
        oidcDeps.store = std::shared_ptr<oidc::RefreshTokenStore>(oidc::makeKeychainRefreshTokenStore(
            "com.aedst.Desktop", oidc::keychainEntryName(oidc::normalizedIssuer(config.oidc.issuer).toStdString(),
                                                         config.oidc.clientId.toStdString())));
        oidcDeps.clock = deps->clock_;
        deps->oidcSession_ = std::make_shared<oidc::OidcSession>(config.oidc, std::move(oidcDeps));
        tokenProvider = deps->oidcSession_;
    }
    // With OIDC the interceptor also refreshes the access token: before a call when it is about to
    // expire, and once after an `unauthenticated` answer (single flight, shared by all callers).
    deps->authInterceptor_ = std::make_shared<network::AuthInterceptor>(
        tokenProvider, useOidc ? std::static_pointer_cast<network::TokenRefresher>(deps->oidcSession_) : nullptr);
    // Every API request carries `X-Aedst-Client: desktop/<semver>` (ADR-0009); the server's version gate keys on it.
    deps->connectClient_ = std::make_shared<network::ConnectClient>(
        network::ClientConfig{.baseUrl = config.apiBaseUrl,
                              .clientIdentifier = network::makeClientIdentifier(config.appVersion)},
        deps->authInterceptor_);

    // --- Offline outbox + plugins ---------------------------------------------------
    // Features contribute OutboxHandlers while their plugin registers (Tasks: task.create / task.update), so the
    // handler set and the client are provided to the registry BEFORE the plugins are activated.
    deps->outboxHandlers_ = std::make_shared<outbox::OutboxHandlers>();
    deps->outbox_ = std::make_unique<outbox::OutboxService>(
        outbox::OutboxService::Dependencies{.queue = std::make_shared<outbox::SqliteOutboxQueue>(worker, toGuiThread),
                                            .handlers = deps->outboxHandlers_,
                                            .clock = deps->clock_});
    for (const auto& provided : {deps->plugins_->services().provide(deps->outboxHandlers_),
                                 deps->plugins_->services().provide(deps->connectClient_)}) {
        if (!provided) {
            qCWarning(lcApp, "Could not provide a host service to the plugins: %s", provided.error().message.c_str());
        }
    }
    // Capability negotiation is the plugins' capability source. Nothing is known yet at this point (the cache is read
    // asynchronously), so built-ins activate and run-time plugins wait; each answer re-runs activation.
    deps->createCapabilities(config.appVersion, worker, toGuiThread);
    deps->plugins_->activate();
    deps->plugins_->registerRoutes(*deps->navGraph_);
    deps->router_ = std::make_unique<navigation::Router>(deps->navGraph_);
    deps->deepLinks_ = std::make_unique<navigation::DeepLinkGate>(*deps->router_);
    QObject::connect(deps->connectClient_.get(), &network::ConnectClient::clientUpgradeRequired, deps->outbox_.get(),
                     [raw = deps.get()]() { raw->onUpgradeRequired(); });

    deps->mediaRemote_ = std::make_shared<media::ConnectMediaRemoteDataSource>(deps->connectClient_);
    const media::MediaUploadController::Dependencies upload{
        .remote = deps->mediaRemote_,
        .network = deps->network_.get(),
        .errors = deps->errorCenter_,
        .allowInsecureLoopback = network::insecureLoopbackAllowedByDefault(),
        .compression = {},
    };
    navigation::Router* router = deps->router_.get();

    // --- Auth ------------------------------------------------------------------
    if (useOidc) {
        deps->authRepository_ = std::make_shared<auth::OidcAuthRepository>(deps->oidcSession_);
    } else {
        deps->authRepository_ = std::make_shared<auth::ConnectAuthRepository>(
            std::make_shared<auth::ConnectAuthRemoteDataSource>(deps->connectClient_), deps->tokenAdapter_,
            deps->clock_, config.deviceId);
    }
    deps->refreshToken_ = std::make_shared<auth::RefreshTokenUseCase>(deps->authRepository_, deps->clock_);
    deps->loginViewModel_ = std::make_unique<auth::LoginViewModel>(
        std::make_shared<auth::LoginUseCase>(deps->authRepository_),
        std::make_shared<auth::LogoutUseCase>(deps->authRepository_), deps->analytics_, router);
    if (useOidc) {
        deps->loginViewModel_->setBrowserSignIn(std::make_shared<auth::BrowserSignInUseCase>(deps->authRepository_));
    }

    // --- Tasks (+ attachments through Core media) ------------------------------
    auto taskRepository = std::make_shared<tasks::ConnectTaskRepository>(deps->connectClient_);
    deps->taskListViewModel_ = std::make_unique<tasks::TaskListViewModel>(
        taskRepository, std::make_shared<tasks::CreateTaskUseCase>(taskRepository), deps->errorCenter_,
        deps->analytics_, router);
    deps->taskListViewModel_->setOutbox(deps->outbox_.get());
    deps->taskDetailViewModel_ = std::make_unique<tasks::TaskDetailViewModel>(tasks::TaskDetailViewModel::Dependencies{
        .tasks = taskRepository,
        .media = deps->mediaRemote_,
        .errors = deps->errorCenter_,
        .upload = upload,
        .router = router,
    });

    // --- Search / Notifications / Media / Admin --------------------------------
    deps->searchViewModel_ = std::make_unique<search::SearchViewModel>(
        std::make_shared<search::ConnectSearchRepository>(deps->connectClient_), deps->errorCenter_, deps->analytics_,
        router);
    deps->notificationsViewModel_ = std::make_unique<notifications::NotificationsViewModel>(
        std::make_shared<notifications::ConnectNotificationRepository>(deps->connectClient_), deps->errorCenter_,
        deps->analytics_, &desktopNotifier, router);
#if defined(AEDST_CONTRACT_HAS_WATCH_NOTIFICATIONS)
    // The server streams notifications: live delivery, polling only while the stream is not healthy.
    deps->notificationsViewModel_->setStream(
        std::make_shared<notifications::ConnectNotificationStream>(deps->connectClient_));
#endif
    deps->mediaLibraryViewModel_ =
        std::make_unique<mediafeature::MediaLibraryViewModel>(mediafeature::MediaLibraryViewModel::Dependencies{
            .remote = deps->mediaRemote_,
            .errors = deps->errorCenter_,
            .analytics = deps->analytics_,
            .upload = upload,
            .router = router,
        });
    deps->mediaViewerViewModel_ =
        std::make_unique<mediafeature::MediaViewerViewModel>(deps->mediaRemote_, deps->errorCenter_);
    deps->adminViewModel_ = std::make_unique<admin::AdminViewModel>(
        std::make_shared<admin::ConnectAdminRepository>(deps->connectClient_), deps->errorCenter_, deps->analytics_);

    deps->wireSessionLifecycle();
    deps->updateSessionInfo();

    qCInfo(lcApp, "Dependencies ready (api=%s, data=%s)", config.apiBaseUrl.toString().toStdString().c_str(),
           config.dataDirectory.string().c_str());
    return deps;
}

bool AppDependencies::openDeepLink(const QString& link) {
    return deepLinks_->submit(link);
}

navigation::Router& AppDependencies::router() noexcept {
    return *router_;
}

designsystem::ThemeController& AppDependencies::theme() noexcept {
    return *theme_;
}

feature::auth::LoginViewModel& AppDependencies::loginViewModel() noexcept {
    return *loginViewModel_;
}

feature::tasks::TaskListViewModel& AppDependencies::taskListViewModel() noexcept {
    return *taskListViewModel_;
}

feature::tasks::TaskDetailViewModel& AppDependencies::taskDetailViewModel() noexcept {
    return *taskDetailViewModel_;
}

feature::search::SearchViewModel& AppDependencies::searchViewModel() noexcept {
    return *searchViewModel_;
}

feature::notifications::NotificationsViewModel& AppDependencies::notificationsViewModel() noexcept {
    return *notificationsViewModel_;
}

feature::media::MediaLibraryViewModel& AppDependencies::mediaLibraryViewModel() noexcept {
    return *mediaLibraryViewModel_;
}

feature::media::MediaViewerViewModel& AppDependencies::mediaViewerViewModel() noexcept {
    return *mediaViewerViewModel_;
}

feature::admin::AdminViewModel& AppDependencies::adminViewModel() noexcept {
    return *adminViewModel_;
}

outbox::OutboxService& AppDependencies::outbox() noexcept {
    return *outbox_;
}

telemetry::ErrorCenter& AppDependencies::errorCenter() noexcept {
    return *errorCenter_;
}

telemetry::TelemetrySettings& AppDependencies::telemetrySettings() noexcept {
    return *telemetrySettings_;
}

telemetry::PostHogAnalyticsTracker& AppDependencies::analytics() noexcept {
    return *analytics_;
}

SessionInfo& AppDependencies::session() noexcept {
    return *session_;
}

QNetworkAccessManager& AppDependencies::network() noexcept {
    return *network_;
}

void AppDependencies::prewarmNetwork() {
    connectClient_->prewarm();
}

navigation::Route AppDependencies::initialRoute() const {
    // A stored session lands on the signed-in home (Tasks); refreshSessionIfNeeded()
    // routes back to login if the server rejects it.
    return authRepository_->currentSession() ? tasks::taskListRoute() : auth::loginRoute();
}

} // namespace aedst::app
