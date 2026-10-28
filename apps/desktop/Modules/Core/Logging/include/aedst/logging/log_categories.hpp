#pragma once

#include <QLoggingCategory>

// Logging categories for Qt-aware AEDST code. Use qCDebug/qCInfo/qCWarning/qCCritical
// with one of these instead of qDebug()/AedstLogger:
//
//     qCWarning(lcNetwork, "%s failed: http=%d", path.c_str(), status);
//
// Every record reaches the support log through the Qt message handler installed by
// aedst::telemetry::installQtLogBridge() (redaction, rotation and the JSON format
// are AedstLogger's). Qt-free code (Domain, Data, Persistence, Update, tests that run
// without a QCoreApplication) keeps using AedstLogger directly.
//
// Runtime control is stock Qt: QT_LOGGING_RULES="aedst.network.debug=true" or a
// .qtlogging.ini; AEDST_LOG_RULES (see applyLogRules) is the same syntax for support.

namespace aedst::logging {

/// Applies QLoggingCategory filter rules from the AEDST_LOG_RULES environment variable
/// (same syntax as QT_LOGGING_RULES, e.g. "aedst.media.debug=true;aedst.network.info=false").
/// Call once, early in main(). No-op when the variable is unset.
void applyLogRules();

} // namespace aedst::logging

Q_DECLARE_LOGGING_CATEGORY(lcApp)           // aedst.app       startup, shutdown, composition root
Q_DECLARE_LOGGING_CATEGORY(lcNetwork)       // aedst.network   ConnectClient, TLS, retries
Q_DECLARE_LOGGING_CATEGORY(lcPlatform)      // aedst.platform  single instance, autostart, notifications
Q_DECLARE_LOGGING_CATEGORY(lcMedia)         // aedst.media     uploads, image cache, video
Q_DECLARE_LOGGING_CATEGORY(lcNavigation)    // aedst.navigation router
Q_DECLARE_LOGGING_CATEGORY(lcTelemetry)     // aedst.telemetry Sentry, PostHog, consent
Q_DECLARE_LOGGING_CATEGORY(lcUpdater)       // aedst.updater   update checks, feed binding, install
Q_DECLARE_LOGGING_CATEGORY(lcNotifications) // aedst.notifications stream, polling, native notifications
Q_DECLARE_LOGGING_CATEGORY(lcAuth)          // aedst.auth      OIDC sign-in, refresh, keychain (never tokens)
Q_DECLARE_LOGGING_CATEGORY(lcOutbox)        // aedst.outbox    offline write queue, retries
