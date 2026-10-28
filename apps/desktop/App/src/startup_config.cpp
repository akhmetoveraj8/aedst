#include "startup_config.hpp"

#include "aedst/logging/log_categories.hpp"

#include <QCoreApplication>
#include <QDir>
#include <QSettings>
#include <QSslSocket>
#include <QStandardPaths>
#include <QUuid>

#include <cstring>

namespace aedst::app::startup {

/// `--version` is answered before any Qt object exists: no display, no data
/// directory, no lock. The installer verification scripts rely on this.
bool wantsVersionOnly(int argc, char* argv[]) {
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--version") == 0 || std::strcmp(argv[i], "-v") == 0) {
            return true;
        }
    }
    return false;
}

/// Stable per-install id sent as LoginRequest.device_id, so the server can
/// scope sessions per device.
QString deviceId() {
    QSettings settings;
    QString id = settings.value(QStringLiteral("deviceId")).toString();
    if (id.isEmpty()) {
        id = QUuid::createUuid().toString(QUuid::WithoutBraces);
        settings.setValue(QStringLiteral("deviceId"), id);
    }
    return id;
}

/// The API endpoint. Debug builds default to the local dev server; a Release
/// build has no default, so a missing/insecure AEDST_API_BASE_URL fails fast in
/// validateClientConfig() instead of silently talking plain http.
QUrl apiBaseUrl() {
#ifdef NDEBUG
    return QUrl(qEnvironmentVariable("AEDST_API_BASE_URL"));
#else
    return QUrl(qEnvironmentVariable("AEDST_API_BASE_URL", QStringLiteral("http://localhost:8080")));
#endif
}

/// Runtime environment wins over the value baked in at build time (CMake cache
/// variables AEDST_SENTRY_DSN / AEDST_POSTHOG_KEY / AEDST_POSTHOG_HOST).
QString configured(const char* variable, const char* buildDefault) {
    const QString value = qEnvironmentVariable(variable).trimmed();
    return value.isEmpty() ? QString::fromUtf8(buildDefault) : value;
}

/// Random per-install id for anonymous analytics (never derived from hardware).
QString analyticsAnonymousId() {
    QSettings settings;
    QString id = settings.value(QStringLiteral("analyticsAnonymousId")).toString();
    if (id.isEmpty()) {
        id = QUuid::createUuid().toString(QUuid::WithoutBraces);
        settings.setValue(QStringLiteral("analyticsAnonymousId"), id);
    }
    return id;
}

/// crashpad_handler is deployed next to the executable (App/CMakeLists.txt).
std::filesystem::path crashpadHandlerPath() {
#ifdef _WIN32
    const QString name = QStringLiteral("crashpad_handler.exe");
#else
    const QString name = QStringLiteral("crashpad_handler");
#endif
    return std::filesystem::path(QDir(QCoreApplication::applicationDirPath()).filePath(name).toStdU16String());
}

/// TLS backend (ADR-0024): Schannel on Windows (OS trust store and TLS stack, no OpenSSL
/// libraries to ship), the system OpenSSL on Linux (the KDE runtime's when sandboxed in
/// Flatpak). Must run before the first network access. A missing backend is not fatal here:
/// ConnectClient refuses https when QSslSocket::supportsSsl() is false.
void selectTlsBackend() {
#if defined(_WIN32)
    const QString wanted = QStringLiteral("schannel");
#else
    const QString wanted = QStringLiteral("openssl");
#endif
    if (!QSslSocket::availableBackends().contains(wanted)) {
        qCWarning(lcNetwork, "TLS backend '%s' is not available; keeping Qt's default (%s)", qUtf8Printable(wanted),
                  qUtf8Printable(QSslSocket::activeBackend()));
        return;
    }
    if (QSslSocket::activeBackend() != wanted && !QSslSocket::setActiveBackend(wanted)) {
        qCWarning(lcNetwork, "Could not activate the '%s' TLS backend; keeping %s", qUtf8Printable(wanted),
                  qUtf8Printable(QSslSocket::activeBackend()));
        return;
    }
    qCInfo(lcNetwork, "TLS backend: %s", qUtf8Printable(QSslSocket::activeBackend()));
}

namespace {

QString dataDirectoryOverride() {
    return qEnvironmentVariable("AEDST_DATA_DIR").trimmed();
}

} // namespace

std::filesystem::path dataDirectory() {
    const QString override = dataDirectoryOverride();
    if (override.isEmpty()) {
        return std::filesystem::path(
            QStandardPaths::writableLocation(QStandardPaths::AppDataLocation).toStdU16String());
    }
    // Isolate QSettings too (deviceId, analytics id, OIDC config): Windows' native format is the registry.
    QSettings::setDefaultFormat(QSettings::IniFormat);
    QSettings::setPath(QSettings::IniFormat, QSettings::UserScope, QDir(override).filePath(QStringLiteral("config")));
    return std::filesystem::path(QDir(override).filePath(QStringLiteral("data")).toStdU16String());
}

QString cacheRoot() {
    const QString override = dataDirectoryOverride();
    return override.isEmpty() ? QStandardPaths::writableLocation(QStandardPaths::CacheLocation)
                              : QDir(override).filePath(QStringLiteral("cache"));
}

aedst::core::LogLevel logLevel(aedst::core::LogLevel fallback) {
    using aedst::core::LogLevel;
    const QString value = qEnvironmentVariable("AEDST_LOG_LEVEL").trimmed().toLower();
    if (value == QLatin1String("trace")) {
        return LogLevel::Trace;
    }
    if (value == QLatin1String("debug")) {
        return LogLevel::Debug;
    }
    if (value == QLatin1String("info")) {
        return LogLevel::Info;
    }
    if (value == QLatin1String("warn") || value == QLatin1String("warning")) {
        return LogLevel::Warn;
    }
    if (value == QLatin1String("error")) {
        return LogLevel::Error;
    }
    if (value == QLatin1String("critical")) {
        return LogLevel::Critical;
    }
    if (value == QLatin1String("off")) {
        return LogLevel::Off;
    }
    return fallback;
}

int perfExitAfterMs(int argc, char* argv[]) {
    constexpr const char* kFlag = "--perf-exit-after-ms=";
    for (int i = 1; i < argc; ++i) {
        if (std::strncmp(argv[i], kFlag, std::strlen(kFlag)) == 0) {
            bool ok = false;
            const int value = QString::fromUtf8(argv[i] + std::strlen(kFlag)).toInt(&ok);
            return ok && value > 0 ? value : 0;
        }
    }
    return 0;
}

} // namespace aedst::app::startup
