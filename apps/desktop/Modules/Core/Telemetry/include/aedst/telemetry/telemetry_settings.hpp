#pragma once

#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QtQml/qqmlregistration.h>

namespace aedst::crash {
class ConsentStore;
} // namespace aedst::crash

namespace aedst::telemetry {

class PostHogAnalyticsTracker;

/// QML-facing consent switches (declared QML_SINGLETON, supplied by App as the `Telemetry` singleton of
/// `Aedst.Telemetry`). Two independent opt-ins, both default OFF (Unknown):
///  - crash reports: Sentry (consent forwarded to sentry-native) and the local
///    ConsentGatedCrashUploader share the same stored decision;
///  - product analytics + feature flags: PostHog.
/// `needsDecision` is true while either available integration was never answered,
/// so the shell can show a one-time privacy prompt. An integration that is not
/// configured (no DSN / no key) reports `...Available == false` and is hidden.
class TelemetrySettings final : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Telemetry)
    QML_SINGLETON
    Q_PROPERTY(bool crashReportsAvailable READ crashReportsAvailable CONSTANT)
    Q_PROPERTY(bool analyticsAvailable READ analyticsAvailable CONSTANT)
    Q_PROPERTY(bool crashReportsEnabled READ crashReportsEnabled WRITE setCrashReportsEnabled NOTIFY changed)
    Q_PROPERTY(bool analyticsEnabled READ analyticsEnabled WRITE setAnalyticsEnabled NOTIFY changed)
    Q_PROPERTY(bool needsDecision READ needsDecision NOTIFY changed)

public:
    static TelemetrySettings* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<TelemetrySettings>::create(engine, script);
    }

    /// All references must outlive this object. `analytics` may be unconfigured.
    TelemetrySettings(crash::ConsentStore& crashConsent, crash::ConsentStore& analyticsConsent,
                      PostHogAnalyticsTracker& analytics, bool crashReportsAvailable, QObject* parent = nullptr);

    [[nodiscard]] bool crashReportsAvailable() const noexcept { return crashReportsAvailable_; }

    [[nodiscard]] bool analyticsAvailable() const;
    [[nodiscard]] bool crashReportsEnabled() const;
    [[nodiscard]] bool analyticsEnabled() const;
    [[nodiscard]] bool needsDecision() const;

    void setCrashReportsEnabled(bool enabled);
    void setAnalyticsEnabled(bool enabled);
    /// Answers both questions at once (the first-run prompt's two buttons).
    Q_INVOKABLE void decideAll(bool enabled);

    /// Pushes the stored decisions into Sentry and PostHog (call once at startup).
    void applyStoredDecisions();

signals:
    void changed();

private:
    crash::ConsentStore& crashConsent_;
    crash::ConsentStore& analyticsConsent_;
    PostHogAnalyticsTracker& analytics_;
    bool crashReportsAvailable_;
};

} // namespace aedst::telemetry
