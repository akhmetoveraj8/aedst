#include "aedst/core/logger.hpp"
#include "aedst/crash/consent_store.hpp"
#include "aedst/crash/crash_handler.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/telemetry/qt_log_bridge.hpp"
#include "aedst/telemetry/sentry_reporter.hpp"
#include "app_run.hpp"
#include "startup_config.hpp"
#include "startup_trace.hpp"

#if defined(AEDST_HAS_VELOPACK)
#include "velopack_installer.hpp"
#endif

#include <QApplication>
#include <QGuiApplication>
#include <QNetworkProxyFactory>
#include <QString>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>

namespace {

using aedst::app::startup::configured;
using aedst::app::startup::crashpadHandlerPath;
using aedst::app::startup::dataDirectory;
using aedst::app::startup::logLevel;
using aedst::app::startup::selectTlsBackend;
using aedst::app::startup::wantsVersionOnly;
using aedst::core::AedstLogger;

/// Tears the telemetry down in the reverse order of the setup in main(). The CRASH HANDLER goes last of all, so a
/// crash during any earlier teardown step (or while the application objects are destroyed) is still captured.
void shutdownTelemetry() {
    aedst::telemetry::SentryReporter::shutdown();
    aedst::telemetry::uninstallQtLogBridge();
    // aedst-allow: composition root owns the sink lifecycle (ADR-0024)
    AedstLogger::shutdown();
    aedst::crash::CrashHandler::uninstall();
}

} // namespace

int main(int argc, char* argv[]) {
    if (wantsVersionOnly(argc, argv)) {
        std::puts(AEDST_VERSION);
        return EXIT_SUCCESS;
    }

#if defined(AEDST_HAS_VELOPACK)
    // Velopack install/update/uninstall hooks run before anything else and may end the process.
    aedst::updater::velopackStartup();
#endif

    const aedst::app::StartupTrace startup;
    const int perfExitAfterMs = aedst::app::startup::perfExitAfterMs(argc, argv);
    // QApplication (not QGuiApplication): QSystemTrayIcon - native desktop
    // notifications on Windows - lives in Qt Widgets and requires it. The UI
    // stays 100% Qt Quick; see docs/adr/0022-telemetry-media-notifications.md.
    QApplication app(argc, argv);
    // Honour the OS proxy configuration (corporate/PAC proxies) for all Qt Network traffic.
    QNetworkProxyFactory::setUseSystemConfiguration(true);
    QGuiApplication::setOrganizationName(QStringLiteral("AEDST"));
    QGuiApplication::setOrganizationDomain(QStringLiteral("aedst.com"));
    QGuiApplication::setApplicationName(QStringLiteral("AEDST"));
    QGuiApplication::setApplicationVersion(QStringLiteral(AEDST_VERSION));

    // AEDST_DATA_DIR relocates the whole profile (perf harness, tests); otherwise the OS application-data location.
    const std::filesystem::path profileDirectory = dataDirectory();

    // AEDST's own log (spdlog; secrets redacted by default). Qt/QML warnings are
    // copied into it by the Qt log bridge (both loggers stay; the bridge only makes
    // the support log complete) - see aedst/telemetry/qt_log_bridge.hpp.
    aedst::core::LoggerConfig logConfig;
#ifdef NDEBUG
    logConfig.level = logLevel(aedst::core::LogLevel::Info);
    // A Release GUI build has no console to read; the rotating file is the log. AEDST_LOG_CONSOLE=1 turns it on.
    logConfig.console = qEnvironmentVariableIntValue("AEDST_LOG_CONSOLE") != 0;
#else
    logConfig.level = logLevel(aedst::core::LogLevel::Debug);
#endif
    if (qEnvironmentVariable("AEDST_LOG_FORMAT").compare(QLatin1String("json"), Qt::CaseInsensitive) == 0) {
        logConfig.format = aedst::core::LogFormat::Json; // JSON Lines for log shippers / support tooling
    }
    logConfig.logFile = profileDirectory / "logs" / "aedst.log";
    // aedst-allow: composition root owns the sink lifecycle (ADR-0024)
    AedstLogger::init(logConfig);
    aedst::logging::applyLogRules();
    aedst::telemetry::installQtLogBridge();
    qCInfo(lcApp, "AEDST desktop %s starting", AEDST_VERSION);
    startup.mark("logger ready");
    selectTlsBackend();

    // Crash reporting. With a Sentry DSN: sentry-native + crashpad (out-of-process
    // minidumps, uploaded only after the user consented). Without one: the local
    // CrashHandler (minidump / signal report under <data>/crashes, never uploaded
    // without consent). Never both: they would fight over the same OS hooks.
    const QString sentryDsn = configured("AEDST_SENTRY_DSN", AEDST_SENTRY_DSN_DEFAULT);
    const aedst::crash::FileConsentStore crashConsent(profileDirectory / "crash_consent");
    const bool sentryActive = aedst::telemetry::SentryReporter::start(
        aedst::telemetry::SentryConfig{
            .dsn = sentryDsn.toStdString(),
            .release = std::string("aedst-desktop@") + AEDST_VERSION,
            .environment = configured("AEDST_SENTRY_ENVIRONMENT", AEDST_SENTRY_ENVIRONMENT_DEFAULT).toStdString(),
            .databasePath = profileDirectory / "sentry",
            .handlerPath = crashpadHandlerPath(),
            .debug = false,
        },
        crashConsent.state() == aedst::crash::ConsentState::Granted);
    if (!sentryActive) {
        if (auto installed = aedst::crash::CrashHandler::install(profileDirectory, AEDST_VERSION); !installed) {
            qCWarning(lcApp, "Crash handler unavailable: %s", installed.error().message.c_str());
        }
    }

    // Every application object (dependencies, engine, view models, the database thread) lives inside this call and
    // is destroyed when it returns - BEFORE the telemetry below is shut down, so teardown crashes are still reported.
    const int exitCode = aedst::app::runApplication(app, startup,
                                                    aedst::app::RunOptions{.dataDirectory = profileDirectory,
                                                                           .crashReportingConfigured = sentryActive,
                                                                           .perfExitAfterMs = perfExitAfterMs});

    qCInfo(lcApp, "AEDST desktop exited with code %d", exitCode);
    shutdownTelemetry();
    return exitCode;
}
