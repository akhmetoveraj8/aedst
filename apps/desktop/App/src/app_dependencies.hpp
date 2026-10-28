#pragma once

#include "Data/connect_auth_repository.hpp"
#include "Data/local_token_store_adapter.hpp"
#include "Domain/refresh_token_use_case.hpp"
#include "Presentation/login_view_model.hpp"
#include "aedst/analytics/analytics_tracker.hpp"
#include "aedst/core/clock.hpp"
#include "aedst/core/outcome.hpp"
#include "aedst/crash/consent_store.hpp"
#include "aedst/designsystem/theme_controller.hpp"
#include "aedst/navigation/deep_link_gate.hpp"
#include "aedst/navigation/nav_graph.hpp"
#include "aedst/navigation/route.hpp"
#include "aedst/navigation/router.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/oidc/oidc_config.hpp"
#include "aedst/outbox/outbox_handler.hpp"
#include "aedst/outbox/outbox_service.hpp"
#include "aedst/persistence/async_token_store.hpp"
#include "aedst/persistence/database_worker.hpp"
#include "aedst/telemetry/error_center.hpp"
#include "aedst/telemetry/posthog_analytics_tracker.hpp"
#include "aedst/telemetry/telemetry_settings.hpp"
#include "session_info.hpp"

#include <QNetworkAccessManager>
#include <QString>
#include <QUrl>

#include <filesystem>
#include <functional>
#include <memory>
#include <string>

namespace aedst::capabilities {
class CapabilitiesService;
} // namespace aedst::capabilities

namespace aedst::media {
class MediaRemoteDataSource;
} // namespace aedst::media

namespace aedst::oidc {
class OidcSession;
} // namespace aedst::oidc

namespace aedst::platform {
class NotificationService;
} // namespace aedst::platform

namespace aedst::feature::tasks {
class TaskListViewModel;
class TaskDetailViewModel;
} // namespace aedst::feature::tasks

namespace aedst::feature::search {
class SearchViewModel;
} // namespace aedst::feature::search

namespace aedst::feature::notifications {
class NotificationsViewModel;
} // namespace aedst::feature::notifications

namespace aedst::feature::media {
class MediaLibraryViewModel;
class MediaViewerViewModel;
} // namespace aedst::feature::media

namespace aedst::feature::admin {
class AdminViewModel;
} // namespace aedst::feature::admin

namespace aedst::app {

class PluginHost;

struct AppConfig {
    QUrl apiBaseUrl;
    std::filesystem::path dataDirectory;
    std::string deviceId;
    /// PostHog (empty key = analytics + flags disabled).
    telemetry::PostHogConfig posthog;
    /// Whether a Sentry DSN is configured (drives the crash-report consent switch).
    bool crashReportingConfigured{false};
    /// Access-token claim holding roles (mirrors the server's AEDST_OIDC_ROLES_CLAIM).
    std::string rolesClaim{"roles"};
    /// OpenID Connect (ZITADEL). When configured, sign-in happens in the system browser and password
    /// login is not offered; otherwise the first-party e-mail/password API is used (until its sunset).
    oidc::OidcConfig oidc;
    /// Semantic version of this build (AEDST_VERSION); sent as `X-Aedst-Client: desktop/<version>` on every API
    /// request. Empty or not a semver = no header.
    std::string appVersion;
};

/// Manual DI composition root — the desktop counterpart of apps/apple's
/// AppDependencies.swift, apps/android's app module, and cmd/server wiring
/// every module. The only class that constructs concrete Data types and sees
/// every feature; features only ever receive interfaces.
///
/// Also owns the session lifecycle that spans features: after sign-in it lands
/// on Tasks, starts notification polling and tags telemetry with the user id;
/// on sign-out (or an expired session reported to ErrorCenter) it clears every
/// feature's state, stops polling and returns to login.
///
/// Members are declared infrastructure-first, so reverse-order destruction
/// tears down ViewModels first and the SQLite connection last.
class AppDependencies final {
public:
    /// `desktopNotifier` (tray / D-Bus / in-app chain) must outlive the dependencies.
    [[nodiscard]] static core::Outcome<std::unique_ptr<AppDependencies>>
    create(const AppConfig& config, platform::NotificationService& desktopNotifier);

    AppDependencies(const AppDependencies&) = delete;
    AppDependencies& operator=(const AppDependencies&) = delete;
    AppDependencies(AppDependencies&&) = delete;
    AppDependencies& operator=(AppDependencies&&) = delete;
    ~AppDependencies();

    [[nodiscard]] navigation::Router& router() noexcept;
    /// Opens an in-app link now when signed in; before sign-in (a cold-start `aedst://` link) it waits and is opened
    /// on top of the home screen once the session is up. The Router still validates the link.
    bool openDeepLink(const QString& link);
    [[nodiscard]] designsystem::ThemeController& theme() noexcept;
    [[nodiscard]] feature::auth::LoginViewModel& loginViewModel() noexcept;
    [[nodiscard]] feature::tasks::TaskListViewModel& taskListViewModel() noexcept;
    [[nodiscard]] feature::tasks::TaskDetailViewModel& taskDetailViewModel() noexcept;
    [[nodiscard]] feature::search::SearchViewModel& searchViewModel() noexcept;
    [[nodiscard]] feature::notifications::NotificationsViewModel& notificationsViewModel() noexcept;
    [[nodiscard]] feature::media::MediaLibraryViewModel& mediaLibraryViewModel() noexcept;
    [[nodiscard]] feature::media::MediaViewerViewModel& mediaViewerViewModel() noexcept;
    [[nodiscard]] feature::admin::AdminViewModel& adminViewModel() noexcept;
    [[nodiscard]] telemetry::ErrorCenter& errorCenter() noexcept;
    /// The offline write queue; main() feeds it the reachability from ConnectivityMonitor.
    [[nodiscard]] outbox::OutboxService& outbox() noexcept;
    /// Server capability negotiation; main() starts it and refreshes it when connectivity returns.
    [[nodiscard]] capabilities::CapabilitiesService& capabilities() noexcept;
    [[nodiscard]] telemetry::TelemetrySettings& telemetrySettings() noexcept;
    [[nodiscard]] telemetry::PostHogAnalyticsTracker& analytics() noexcept;
    [[nodiscard]] SessionInfo& session() noexcept;
    /// The app-wide QNetworkAccessManager for non-RPC HTTP (presigned uploads).
    [[nodiscard]] QNetworkAccessManager& network() noexcept;

    /// Opens the API connection (TCP + TLS + HTTP/2 negotiation) ahead of the first
    /// request. Call once the first screen is on its way; best-effort.
    void prewarmNetwork();

    /// Runs at the end of every sign-out (explicit, expired or revoked), after the feature state was cleared: the
    /// shell drops caches that hold the signed-out user's data (media thumbnails, decoded images).
    void setSignedOutHook(std::function<void()> hook);

    /// Tasks when a session is stored, login otherwise.
    [[nodiscard]] navigation::Route initialRoute() const;

    /// Startup session handling. First-party mode: rotates an expired access token once and routes to
    /// login if the server rejects the refresh token. OIDC mode: loads the refresh token from the OS
    /// keychain and exchanges it for an access token (the login view shows progress meanwhile).
    /// Offline failures keep the stored session.
    void refreshSessionIfNeeded();

    /// Starts per-user background work for a stored session (notification polling,
    /// telemetry user id). Call once after QML is loaded.
    void resumeSession();

private:
    AppDependencies() = default;

    void wireSessionLifecycle();
    void onSignedIn();
    void restoreOidcSession();
    void restoreFirstPartySession();
    void refreshStoredSession();
    void onSignedOut();
    /// The server refuses this app version: lock the router on the blocking upgrade screen.
    void onUpgradeRequired();
    void updateSessionInfo();
    /// Capability negotiation (app_dependencies_capabilities.cpp): builds the service, makes it the plugins'
    /// capability source and routes its answers to the shell, the plugin host and the upgrade screen.
    void createCapabilities(std::string version, std::shared_ptr<persistence::DatabaseWorker> worker,
                            persistence::Dispatcher dispatcher);

    // FIRST member, so it is destroyed LAST: every other member that holds a DatabaseWorker reference (token store,
    // outbox queue, KV store) is gone by then, and the final release - the join of the database thread - happens here
    // on the GUI thread, never on the worker itself (a self-join would deadlock).
    std::shared_ptr<persistence::DatabaseWorker> databaseWorker_;

    std::string rolesClaim_;
    std::function<void()> signedOutHook_;

    // Infrastructure (Core)
    std::shared_ptr<persistence::AsyncTokenStore> asyncTokenStore_;
    std::shared_ptr<core::Clock> clock_;
    std::unique_ptr<crash::FileConsentStore> crashConsent_;
    std::unique_ptr<crash::FileConsentStore> analyticsConsent_;
    std::shared_ptr<telemetry::PostHogAnalyticsTracker> analytics_;
    std::unique_ptr<telemetry::TelemetrySettings> telemetrySettings_;
    std::shared_ptr<telemetry::ErrorCenter> errorCenter_;
    std::shared_ptr<navigation::NavGraph> navGraph_;
    std::unique_ptr<PluginHost> plugins_;
    std::unique_ptr<navigation::Router> router_;
    std::unique_ptr<navigation::DeepLinkGate> deepLinks_;
    std::unique_ptr<designsystem::ThemeController> theme_;
    std::unique_ptr<QNetworkAccessManager> network_;
    std::unique_ptr<SessionInfo> session_;
    std::shared_ptr<outbox::OutboxHandlers> outboxHandlers_;
    std::unique_ptr<outbox::OutboxService> outbox_;

    // Auth
    std::shared_ptr<feature::auth::LocalTokenStoreAdapter> tokenAdapter_;
    std::shared_ptr<network::AuthInterceptor> authInterceptor_;
    std::shared_ptr<network::ConnectClient> connectClient_;
    std::unique_ptr<capabilities::CapabilitiesService> capabilities_;
    std::shared_ptr<oidc::OidcSession> oidcSession_;
    std::shared_ptr<feature::auth::AuthRepository> authRepository_;
    std::shared_ptr<feature::auth::RefreshTokenUseCase> refreshToken_;
    std::shared_ptr<media::MediaRemoteDataSource> mediaRemote_;

    // ViewModels (QML singletons)
    std::unique_ptr<feature::auth::LoginViewModel> loginViewModel_;
    std::unique_ptr<feature::tasks::TaskListViewModel> taskListViewModel_;
    std::unique_ptr<feature::tasks::TaskDetailViewModel> taskDetailViewModel_;
    std::unique_ptr<feature::search::SearchViewModel> searchViewModel_;
    std::unique_ptr<feature::notifications::NotificationsViewModel> notificationsViewModel_;
    std::unique_ptr<feature::media::MediaLibraryViewModel> mediaLibraryViewModel_;
    std::unique_ptr<feature::media::MediaViewerViewModel> mediaViewerViewModel_;
    std::unique_ptr<feature::admin::AdminViewModel> adminViewModel_;
};

} // namespace aedst::app
