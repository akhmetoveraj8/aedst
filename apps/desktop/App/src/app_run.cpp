#include "app_run.hpp"

#include "Presentation/notifications_view_model.hpp"
#include "activation.hpp"
#include "aedst/capabilities/capabilities_service.hpp"
#include "aedst/connectivity/connectivity_monitor.hpp"
#include "aedst/designsystem/translation_loader.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/media/media_image_provider.hpp"
#include "aedst/media/video_frame_grabber.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/oidc/oidc_config.hpp"
#include "aedst/outbox/outbox_service.hpp"
#include "aedst/platform/notification_service.hpp"
#include "aedst/platform/power_monitor.hpp"
#include "aedst/platform/single_instance_guard.hpp"
#include "aedst/platform/tray_notification_service.hpp"
#include "aedst/telemetry/posthog_analytics_tracker.hpp"
#include "app_dependencies.hpp"
#include "app_updater.hpp"
#include "qml_singletons.hpp"
#include "startup_config.hpp"

#include <QCoreApplication>
#include <QDir>
#include <QPointer>
#include <QProcessEnvironment>
#include <QQmlApplicationEngine>
#include <QQmlEngine>
#include <QQuickWindow>
#include <QSettings>
#include <QTimer>
#include <QVariantMap>

#include <cstdlib>
#include <string>

namespace aedst::app {
namespace {

using startup::analyticsAnonymousId;
using startup::apiBaseUrl;
using startup::configured;
using startup::deviceId;

constexpr const char* kAppId = "com.aedst.Desktop";

/// The root configuration from the environment and the build. Returns false (and logs) for an unusable OIDC setup.
[[nodiscard]] bool buildConfig(const RunOptions& options, AppConfig& config) {
    config = AppConfig{
        .apiBaseUrl = apiBaseUrl(),
        .dataDirectory = options.dataDirectory,
        .deviceId = deviceId().toStdString(),
        .posthog = {},
        .crashReportingConfigured = options.crashReportingConfigured,
        .rolesClaim = configured("AEDST_OIDC_ROLES_CLAIM", "roles").toStdString(),
    };
    config.appVersion = AEDST_VERSION; // X-Aedst-Client: desktop/<version> (ADR-0009)
    // Identity provider (ZITADEL). Configured -> browser sign-in; not configured -> first-party password login.
    // aedst-allow: non-secret OIDC client configuration (issuer, client id); tokens use QtKeychain (ADR-0025)
    config.oidc = oidc::loadOidcConfig(QSettings(), QProcessEnvironment::systemEnvironment());
    if (config.oidc.isConfigured()) {
        if (auto valid = oidc::validateOidcConfig(config.oidc); !valid) {
            qCCritical(lcApp, "Invalid OIDC configuration: %s", valid.error().message.c_str());
            return false;
        }
        if (qEnvironmentVariableIsEmpty("AEDST_OIDC_ROLES_CLAIM")) {
            config.rolesClaim = "urn:zitadel:iam:org:project:roles"; // roles claim of ZITADEL
        }
        qCInfo(lcApp, "OpenID Connect sign-in enabled (issuer %s)",
               qUtf8Printable(oidc::normalizedIssuer(config.oidc.issuer)));
    }
    config.posthog.apiKey = configured("AEDST_POSTHOG_KEY", AEDST_POSTHOG_KEY_DEFAULT);
    config.posthog.host = QUrl(configured("AEDST_POSTHOG_HOST", AEDST_POSTHOG_HOST_DEFAULT));
    config.posthog.anonymousId = analyticsAnonymousId();
    config.posthog.appVersion = QStringLiteral(AEDST_VERSION);

    // Fail fast on an insecure or malformed endpoint (https required; http only for
    // loopback in Debug or with AEDST_ALLOW_INSECURE_LOCALHOST).
    if (auto valid = network::validateClientConfig({.baseUrl = config.apiBaseUrl}); !valid) {
        qCCritical(lcApp, "Invalid API configuration: %s (set AEDST_API_BASE_URL to an https:// URL)",
                   valid.error().message.c_str());
        return false;
    }
    return true;
}

/// Reachability drives three consumers: the offline outbox (drains when the network is up and holds its writes while
/// it is down), capability negotiation (asked again when connectivity returns) and notification polling.
void wireConnectivity(connectivity::ConnectivityMonitor& monitor, AppDependencies& deps) {
    outbox::OutboxService* outbox = &deps.outbox();
    capabilities::CapabilitiesService* capabilities = &deps.capabilities();
    feature::notifications::NotificationsViewModel* notifications = &deps.notificationsViewModel();
    connectivity::ConnectivityMonitor* source = &monitor;
    const auto apply = [source, outbox, capabilities, notifications]() {
        const bool online = !source->isOffline();
        outbox->setOnline(online);
        notifications->setOnline(online);
        if (online) {
            capabilities->refresh(); // the answer is cached for a failed fetch
        }
    };
    QObject::connect(&monitor, &connectivity::ConnectivityMonitor::isOfflineChanged, outbox, apply);
    outbox->setOnline(!monitor.isOffline());
    notifications->setOnline(!monitor.isOffline());
}

/// After a sleep the sockets are dead and the reachability signal may not change: rebuild the live connections now.
void wirePowerResume(platform::PowerMonitor& power, AppDependencies& deps) {
    outbox::OutboxService* outbox = &deps.outbox();
    capabilities::CapabilitiesService* capabilities = &deps.capabilities();
    feature::notifications::NotificationsViewModel* notifications = &deps.notificationsViewModel();
    QObject::connect(&power, &platform::PowerMonitor::resumedFromSleep, &power,
                     [outbox, capabilities, notifications]() {
                         notifications->onSystemResumed();
                         outbox->kick();
                         capabilities->refresh();
                     });
    power.start();
}

/// Tray, notification clicks and the unread badge.
void wireNotifications(QApplication& app, AppDependencies& deps, platform::TrayNotificationService& tray,
                       const QPointer<QQuickWindow>& window) {
    auto& viewModel = deps.notificationsViewModel();
    AppDependencies* dependencies = &deps;
    // Tray: clicking a balloon (or the icon) brings the window forward. The badge mirrors the unread count.
    QObject::connect(&tray, &platform::TrayNotificationService::messageClicked, &app,
                     [window]() { handleActivation({}, window, nullptr); });
    // A click on a native notification (Windows toast, D-Bus, tray balloon) opens what it is about; the summary
    // notification links to the inbox. The route is validated by Router::openLink behind the sign-in gate.
    QObject::connect(&viewModel, &feature::notifications::NotificationsViewModel::notificationActivated, &app,
                     [window, dependencies](const QString& link) {
                         handleActivation({}, window, nullptr);
                         dependencies->openDeepLink(link);
                     });
    QObject::connect(&tray, &platform::TrayNotificationService::activated, &app,
                     [window]() { handleActivation({}, window, nullptr); });
    QObject::connect(&viewModel, &feature::notifications::NotificationsViewModel::unreadCountChanged, &tray,
                     [&tray, &viewModel]() { tray.setBadgeCount(viewModel.unreadCount()); });
    // Poll faster while the user is looking at the app.
    QObject::connect(
        &app, &QGuiApplication::applicationStateChanged, &viewModel,
        [&viewModel](Qt::ApplicationState state) { viewModel.setForeground(state == Qt::ApplicationActive); });
}

} // namespace

int runApplication(QApplication& app, const StartupTrace& startup, const RunOptions& options) {
    // One instance per user: a second launch forwards its arguments (deep links)
    // to the first and exits before it can open the database.
    platform::SingleInstanceGuard instanceGuard(QString::fromUtf8(kAppId),
                                                QString::fromStdU16String(options.dataDirectory.u16string()));
    if (instanceGuard.acquire(app.arguments()) == platform::SingleInstanceGuard::Role::Secondary) {
        qCInfo(lcApp, "Another instance is running; activation forwarded, exiting");
        return EXIT_SUCCESS;
    }

    // Self-update: signed manifest + the installer that fits this installation; off without a manifest URL or key.
    AppUpdater appUpdater(options.dataDirectory,
                          {.manifestUrl = configured("AEDST_UPDATE_MANIFEST_URL", AEDST_UPDATE_MANIFEST_URL_DEFAULT),
                           .feedUrl = configured("AEDST_UPDATE_FEED_URL", AEDST_UPDATE_FEED_URL_DEFAULT),
                           .channel = configured("AEDST_UPDATE_CHANNEL", AEDST_UPDATE_CHANNEL_DEFAULT)});

    AppConfig config;
    if (!buildConfig(options, config)) {
        return EXIT_FAILURE;
    }

    // Notifications: native desktop (tray toast / Notification Center / D-Bus) with
    // the in-app AedstToast as universal fallback. Created before the dependencies
    // because NotificationsViewModel announces through it.
    platform::InAppNotificationService inAppNotifications;
    platform::TrayNotificationService trayNotifications(inAppNotifications);
    const auto notifications = platform::makeNotificationService(inAppNotifications, &trayNotifications);

    auto dependencies = AppDependencies::create(config, *notifications);
    if (!dependencies) {
        qCCritical(lcApp, "Startup failed: %s", dependencies.error().message.c_str());
        return EXIT_FAILURE;
    }
    // Declared before the engine so it outlives every QML object that references it.
    AppDependencies& deps = **dependencies;
    startup.mark("dependencies ready");

    // Reachability (Offline banner / disabled submit) and UI language + RTL layout.
    auto reachability = connectivity::ConnectivityMonitor::createDefault();
    wireConnectivity(*reachability, deps);
    platform::PowerMonitor powerMonitor; // declared before the engine; stopped with the app
    wirePowerResume(powerMonitor, deps);
    designsystem::TranslationLoader translations(
        {QStringLiteral("designsystem"), QStringLiteral("auth"), QStringLiteral("tasks"), QStringLiteral("search"),
         QStringLiteral("notifications"), QStringLiteral("media"), QStringLiteral("admin"), QStringLiteral("app")});
    translations.installSystemLanguage();

    // Every QML singleton is declared with QML_ELEMENT/QML_SINGLETON; this only hands over the instances.
    provideQmlSingletons(deps, *reachability, inAppNotifications);

    // image://media - async, cached thumbnails/previews. The fetcher (GUI thread,
    // owns the disk-cached QNetworkAccessManager) must outlive the engine.
    const QString cacheRoot = startup::cacheRoot();
    media::VideoFrameGrabber::setCacheRoot(cacheRoot);
    media::MediaImageFetcher imageFetcher(QDir(cacheRoot).filePath(QStringLiteral("media")), 256LL * 1024 * 1024);
    auto* imageProvider = new media::MediaImageProvider(imageFetcher);
    // Signing out forgets the user's media: the disk cache, the decoded images and the video thumbnails.
    deps.setSignedOutHook([&imageFetcher, imageProvider]() {
        imageFetcher.clear();
        imageProvider->clear();
        media::VideoFrameGrabber::clearThumbnailCache();
    });

    QQmlApplicationEngine engine;
    engine.addImageProvider(QStringLiteral("media"), imageProvider); // the engine owns the provider
    QObject::connect(
        &engine, &QQmlApplicationEngine::objectCreationFailed, &app,
        []() {
            qCCritical(lcApp, "Failed to create the QML root object");
            QCoreApplication::exit(EXIT_FAILURE);
        },
        Qt::QueuedConnection);
    QObject::connect(&translations, &designsystem::TranslationLoader::languageChanged, &engine,
                     [&engine]() { engine.retranslate(); });

    engine.setInitialProperties(
        {{QStringLiteral("initialRoute"), QString::fromStdString(deps.initialRoute().name)},
         {QStringLiteral("updater"), QVariant::fromValue(static_cast<QObject*>(appUpdater.service()))}});
    engine.loadFromModule("Aedst.App", "Main");
    startup.mark("QML loaded");

    const QPointer<QQuickWindow> window = qobject_cast<QQuickWindow*>(engine.rootObjects().value(0));
    if (window) {
        // The render thread emits frameSwapped; the single-shot connection is delivered on the GUI thread.
        const int exitAfterMs = options.perfExitAfterMs;
        QObject::connect(
            window.data(), &QQuickWindow::frameSwapped, &app,
            [&startup, &app, exitAfterMs]() {
                startup.mark("first frame");
                if (exitAfterMs > 0) {
                    QTimer::singleShot(exitAfterMs, &app, &QCoreApplication::quit); // perf harness only
                }
            },
            Qt::SingleShotConnection);
    }
    AppDependencies* depsPointer = &deps;
    QObject::connect(
        &instanceGuard, &platform::SingleInstanceGuard::activationRequested, &app,
        [window, depsPointer](const QStringList& arguments) { handleActivation(arguments, window, depsPointer); });
    // Deep links passed to this (first) instance on its own command line: held until the user is signed in.
    handleActivation(platform::SingleInstanceGuard::sanitizeArguments(app.arguments()), QPointer<QQuickWindow>(),
                     depsPointer);
    wireNotifications(app, deps, trayNotifications, window);

    appUpdater.start();
    deps.prewarmNetwork();
    deps.capabilities().start(); // last-known answer from SQLite, then GetCapabilities (public RPC, before sign-in)
    deps.refreshSessionIfNeeded();
    deps.resumeSession();

    const int exitCode = QApplication::exec();
    if (exitCode == EXIT_SUCCESS) {
        appUpdater.markHealthy(); // a failed or crashed run must keep counting as unhealthy for the safe-mode guard
    }
    deps.analytics().flush();
    return exitCode;
}

} // namespace aedst::app
