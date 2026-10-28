#pragma once

#include "aedst/analytics/analytics_tracker.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QByteArray>
#include <QDateTime>
#include <QHash>
#include <QJsonObject>
#include <QList>
#include <QNetworkAccessManager>
#include <QObject>
#include <QString>
#include <QTimer>
#include <QUrl>
#include <QVariant>
#include <QtQml/qqmlregistration.h>

#include <map>
#include <string>
#include <string_view>

namespace aedst::telemetry {

struct PostHogConfig {
    /// Project API key (phc_...). Empty = analytics and feature flags disabled.
    QString apiKey;
    /// Ingestion host, https only (validated with the same transport policy as the API).
    QUrl host{QStringLiteral("https://us.i.posthog.com")};
    /// Per-install random id used until identify(); never derived from hardware.
    QString anonymousId;
    QString appVersion;
    int flushIntervalMs{30'000};
    int maxBatchSize{20};
    /// Events kept while offline/unconsented-pending; oldest dropped beyond this.
    int maxQueuedEvents{500};
};

/// One captured event, already reduced to what is sent.
struct PostHogEvent {
    QString event;
    QString distinctId;
    QJsonObject properties;
    QDateTime timestamp;
};

/// `POST <host>/batch/` body: {"api_key", "batch": [{"event","distinct_id","properties","timestamp"}]}.
/// Pure, for tests.
[[nodiscard]] QByteArray buildBatchPayload(const QString& apiKey, const QList<PostHogEvent>& events);

/// What an event property value may carry: secrets, e-mails and account names in paths are masked
/// (core::scrubPii) and the text is cut to 200 characters. Event vocabularies are small and static, so this is a
/// guard against a feature passing something user-typed by mistake, not a feature. Pure, for tests.
[[nodiscard]] QString sanitizePropertyValue(const QString& value);

/// Parses a `POST <host>/flags?v=2` response ({"flags": {"<key>": {"enabled", "variant"}}})
/// and, for older deployments, the legacy /decide shape ({"featureFlags": {"<key>": true|"variant"}}).
/// Value: false (off), true (on, no variant) or the variant string. Pure, for tests.
[[nodiscard]] QHash<QString, QVariant> parseFeatureFlags(const QByteArray& body);

/// AnalyticsTracker over PostHog's public HTTP API, sent with Qt Network.
///
/// Why PostHog over no analytics: a template that ships without product
/// analytics and feature flags gets them bolted on later per product, usually
/// without a consent gate. PostHog covers both (events + flags + experiments)
/// over one documented HTTP API, is open source and self-hostable (EU/US cloud
/// or own instance), so no vendor SDK is needed on desktop: two endpoints over the
/// QNetworkAccessManager-based policy the app already has. It stays fully OFF
/// unless a key is configured AND the user opted in.
///
/// Privacy defaults: opt-in consent (setConsent), anonymous per-install id until
/// identify(userId), only the opaque user id is ever sent as identity, event
/// properties are the feature's own small vocabulary (analytics::events), `$ip`
/// is not added by the client (also enable "Discard client IP data" in the
/// PostHog project). reset() on logout returns to the anonymous id.
///
/// Delivery: batched (maxBatchSize or flushIntervalMs, and on flush()/destruction),
/// failed batches are re-queued up to maxQueuedEvents; nothing is persisted to
/// disk, so events captured right before a crash are lost by design.
class PostHogAnalyticsTracker final : public QObject, public analytics::AnalyticsTracker {
    Q_OBJECT
    QML_NAMED_ELEMENT(FeatureFlags)
    QML_SINGLETON
    Q_PROPERTY(bool enabled READ isEnabled NOTIFY enabledChanged)

public:
    static PostHogAnalyticsTracker* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<PostHogAnalyticsTracker>::create(engine, script);
    }

    explicit PostHogAnalyticsTracker(PostHogConfig config, QObject* parent = nullptr);
    PostHogAnalyticsTracker(const PostHogAnalyticsTracker&) = delete;
    PostHogAnalyticsTracker& operator=(const PostHogAnalyticsTracker&) = delete;
    PostHogAnalyticsTracker(PostHogAnalyticsTracker&&) = delete;
    PostHogAnalyticsTracker& operator=(PostHogAnalyticsTracker&&) = delete;
    ~PostHogAnalyticsTracker() override;

    /// Configured (key + valid https host) - independent of consent.
    [[nodiscard]] bool isConfigured() const noexcept { return configured_; }

    /// Configured and the user consented.
    [[nodiscard]] bool isEnabled() const noexcept { return configured_ && consent_; }

    /// Revoking drops every queued event and the cached flags.
    void setConsent(bool granted);

    void track(std::string_view event, const analytics::AnalyticsProperties& properties) override;
    void identify(std::string_view userId) override;
    void reset() override;

    void flush();

    /// Feature flags for the current distinct id. Unknown flags are `fallback`.
    Q_INVOKABLE bool isFeatureEnabled(const QString& key, bool fallback = false) const;
    Q_INVOKABLE QString featureVariant(const QString& key) const;
    /// Re-fetches flags (also done after identify/reset and when consent is granted).
    Q_INVOKABLE void reloadFeatureFlags();

    [[nodiscard]] int queuedEventCount() const noexcept { return static_cast<int>(queue_.size()); }

    /// Whether the batch timer is running (it runs only while events are waiting). Diagnostics and tests.
    [[nodiscard]] bool flushTimerActive() const noexcept { return flushTimer_.isActive(); }

signals:
    void enabledChanged();
    void featureFlagsChanged();

private:
    [[nodiscard]] QString distinctId() const;
    [[nodiscard]] QJsonObject baseProperties() const;
    void enqueue(PostHogEvent event);
    /// Starts the flush timer when events are waiting and none is running.
    void armFlushTimer();
    [[nodiscard]] QUrl endpoint(const QString& path) const;

    PostHogConfig config_;
    bool configured_{false};
    bool consent_{false};
    QString userId_;
    QList<PostHogEvent> queue_;
    QHash<QString, QVariant> flags_;
    QNetworkAccessManager network_;
    QTimer flushTimer_;
    bool flushInFlight_{false};
};

} // namespace aedst::telemetry
