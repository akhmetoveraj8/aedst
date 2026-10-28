#include "aedst/telemetry/qt_log_bridge.hpp"

#include "aedst/core/redaction.hpp"
#include "aedst/telemetry/sentry_reporter.hpp"

#include <QMessageLogContext>
#include <QString>
#include <QtGlobal>

#include <atomic>
#include <cstring>
#include <string>

namespace aedst::telemetry {
namespace {

// The handler is a plain function pointer: state lives in globals by necessity.
// NOLINTBEGIN(cppcoreguidelines-avoid-non-const-global-variables)
std::atomic<QtMessageHandler> gPrevious{nullptr};
std::atomic<bool> gInstalled{false};
QtLogBridgeOptions gOptions{};
thread_local bool tInHandler = false;
// NOLINTEND(cppcoreguidelines-avoid-non-const-global-variables)

[[nodiscard]] core::LogLevel toLevel(QtMsgType type) noexcept {
    switch (type) {
    case QtDebugMsg:
        return core::LogLevel::Debug;
    case QtInfoMsg:
        return core::LogLevel::Info;
    case QtWarningMsg:
        return core::LogLevel::Warn;
    case QtCriticalMsg:
        return core::LogLevel::Error;
    case QtFatalMsg:
        return core::LogLevel::Critical;
    }
    return core::LogLevel::Info;
}

[[nodiscard]] spdlog::level::level_enum toSpdlog(core::LogLevel level) noexcept {
    switch (level) {
    case core::LogLevel::Trace:
        return spdlog::level::trace;
    case core::LogLevel::Debug:
        return spdlog::level::debug;
    case core::LogLevel::Info:
        return spdlog::level::info;
    case core::LogLevel::Warn:
        return spdlog::level::warn;
    case core::LogLevel::Error:
        return spdlog::level::err;
    case core::LogLevel::Critical:
        return spdlog::level::critical;
    case core::LogLevel::Off:
        break;
    }
    return spdlog::level::off;
}

/// First-party categories (aedst.network, ...) are our own product log: every level goes to
/// spdlog, which applies its configured level. Everything else (qt.*, qml, default) keeps the
/// quieter QtLogBridgeOptions::forwardFrom threshold.
[[nodiscard]] bool isAedstCategory(const char* category) noexcept {
    return category != nullptr && std::strncmp(category, "aedst.", 6) == 0;
}

void callPrevious(QtMsgType type, const QMessageLogContext& context, const QString& message) {
    if (const QtMessageHandler previous = gPrevious.load(); previous != nullptr) {
        previous(type, context, message);
    }
}

void bridgeHandler(QtMsgType type, const QMessageLogContext& context, const QString& message) {
    if (!tInHandler) {
        tInHandler = true;
        const core::LogLevel level = toLevel(type);
        const char* category = context.category != nullptr ? context.category : "default";
        const bool ours = isAedstCategory(category);
        if (ours || static_cast<int>(level) >= static_cast<int>(gOptions.forwardFrom)) {
            const std::string text = message.toStdString();
            // Through AedstLogger so redaction (tokens, e-mails) applies to Qt text too.
            if (ours) {
                // aedst-allow: this file IS the Qt-to-spdlog bridge (ADR-0024)
                core::AedstLogger::get()->log(toSpdlog(level), "[{}] {}", category, text);
            } else {
                // aedst-allow: this file IS the Qt-to-spdlog bridge (ADR-0024)
                core::AedstLogger::get()->log(toSpdlog(level), "[qt:{}] {}", category, text);
            }
            if (gOptions.breadcrumbs && (level >= core::LogLevel::Warn || (ours && level == core::LogLevel::Info))) {
                const auto sink =
                    gOptions.breadcrumbSink != nullptr ? gOptions.breadcrumbSink : &SentryReporter::addBreadcrumb;
                sink(category, core::scrubPii(text),
                     level >= core::LogLevel::Error  ? BreadcrumbLevel::Error
                     : level >= core::LogLevel::Warn ? BreadcrumbLevel::Warning
                                                     : BreadcrumbLevel::Info);
            }
            if (type == QtFatalMsg) {
                // aedst-allow: this file IS the Qt-to-spdlog bridge (ADR-0024)
                core::AedstLogger::flush(); // Qt aborts right after the handlers return.
            }
        }
        tInHandler = false;
    }
    callPrevious(type, context, message);
}

} // namespace

void installQtLogBridge(const QtLogBridgeOptions& options) {
    if (gInstalled.exchange(true)) {
        return;
    }
    gOptions = options;
    gPrevious.store(qInstallMessageHandler(&bridgeHandler));
}

void uninstallQtLogBridge() {
    if (!gInstalled.exchange(false)) {
        return;
    }
    qInstallMessageHandler(gPrevious.exchange(nullptr));
}

} // namespace aedst::telemetry
