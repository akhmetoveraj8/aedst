#include "aedst/telemetry/telemetry_settings.hpp"

#include "aedst/core/logger.hpp"
#include "aedst/crash/consent_store.hpp"
#include "aedst/telemetry/posthog_analytics_tracker.hpp"
#include "aedst/telemetry/sentry_reporter.hpp"

namespace aedst::telemetry {

using core::AedstLogger;
using crash::ConsentState;

namespace {

void store(crash::ConsentStore& consent, bool enabled, const char* what) {
    if (auto saved = consent.setState(enabled ? ConsentState::Granted : ConsentState::Denied); !saved) {
        AedstLogger::warn("Cannot persist {} consent: {}", what, saved.error().message);
    }
}

} // namespace

TelemetrySettings::TelemetrySettings(crash::ConsentStore& crashConsent, crash::ConsentStore& analyticsConsent,
                                     PostHogAnalyticsTracker& analytics, bool crashReportsAvailable, QObject* parent)
    : QObject(parent),
      crashConsent_(crashConsent),
      analyticsConsent_(analyticsConsent),
      analytics_(analytics),
      crashReportsAvailable_(crashReportsAvailable) {}

bool TelemetrySettings::analyticsAvailable() const {
    return analytics_.isConfigured();
}

bool TelemetrySettings::crashReportsEnabled() const {
    return crashConsent_.state() == ConsentState::Granted;
}

bool TelemetrySettings::analyticsEnabled() const {
    return analyticsConsent_.state() == ConsentState::Granted;
}

bool TelemetrySettings::needsDecision() const {
    return (crashReportsAvailable_ && crashConsent_.state() == ConsentState::Unknown) ||
           (analyticsAvailable() && analyticsConsent_.state() == ConsentState::Unknown);
}

void TelemetrySettings::setCrashReportsEnabled(bool enabled) {
    store(crashConsent_, enabled, "crash-report");
    SentryReporter::setConsent(enabled);
    emit changed();
}

void TelemetrySettings::setAnalyticsEnabled(bool enabled) {
    store(analyticsConsent_, enabled, "analytics");
    analytics_.setConsent(enabled);
    emit changed();
}

void TelemetrySettings::decideAll(bool enabled) {
    if (crashReportsAvailable_) {
        store(crashConsent_, enabled, "crash-report");
        SentryReporter::setConsent(enabled);
    }
    if (analyticsAvailable()) {
        store(analyticsConsent_, enabled, "analytics");
        analytics_.setConsent(enabled);
    }
    emit changed();
}

void TelemetrySettings::applyStoredDecisions() {
    SentryReporter::setConsent(crashReportsEnabled());
    analytics_.setConsent(analyticsEnabled());
}

} // namespace aedst::telemetry
