#include "aedst/telemetry/posthog_analytics_tracker.hpp"

#include "aedst/core/redaction.hpp"
#include "aedst/logging/log_categories.hpp"
#include "aedst/network/transport_policy.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <QSslConfiguration>
#include <QSysInfo>
#include <QUrlQuery>

#include <utility>

namespace aedst::telemetry {

QByteArray buildBatchPayload(const QString& apiKey, const QList<PostHogEvent>& events) {
    QJsonArray batch;
    for (const PostHogEvent& event : events) {
        batch.append(QJsonObject{
            {QStringLiteral("event"), event.event},
            {QStringLiteral("distinct_id"), event.distinctId},
            {QStringLiteral("properties"), event.properties},
            {QStringLiteral("timestamp"), event.timestamp.toUTC().toString(Qt::ISODateWithMs)},
        });
    }
    const QJsonObject body{{QStringLiteral("api_key"), apiKey}, {QStringLiteral("batch"), batch}};
    return QJsonDocument(body).toJson(QJsonDocument::Compact);
}

QString sanitizePropertyValue(const QString& value) {
    constexpr qsizetype kMaxLength = 200;
    QString cleaned = QString::fromStdString(core::scrubPii(value.toStdString()));
    if (cleaned.size() > kMaxLength) {
        cleaned.truncate(kMaxLength);
    }
    return cleaned;
}

QHash<QString, QVariant> parseFeatureFlags(const QByteArray& body) {
    QHash<QString, QVariant> flags;
    const QJsonDocument document = QJsonDocument::fromJson(body);
    if (!document.isObject()) {
        return flags;
    }
    const QJsonObject root = document.object();
    // v2 (/flags?v=2): {"flags": {"key": {"enabled": bool, "variant": string|null}}}
    const QJsonObject v2 = root.value(QStringLiteral("flags")).toObject();
    for (auto it = v2.begin(); it != v2.end(); ++it) {
        const QJsonObject detail = it.value().toObject();
        const QJsonValue variant = detail.value(QStringLiteral("variant"));
        if (variant.isString() && !variant.toString().isEmpty()) {
            flags.insert(it.key(), variant.toString());
        } else {
            flags.insert(it.key(), detail.value(QStringLiteral("enabled")).toBool());
        }
    }
    // legacy /decide: {"featureFlags": {"key": true|false|"variant"}}
    const QJsonObject legacy = root.value(QStringLiteral("featureFlags")).toObject();
    for (auto it = legacy.begin(); it != legacy.end(); ++it) {
        if (flags.contains(it.key())) {
            continue;
        }
        flags.insert(it.key(), it.value().isString() ? QVariant(it.value().toString()) : QVariant(it.value().toBool()));
    }
    return flags;
}

PostHogAnalyticsTracker::PostHogAnalyticsTracker(PostHogConfig config, QObject* parent)
    : QObject(parent), config_(std::move(config)) {
    if (!config_.apiKey.isEmpty()) {
        // Same transport rule as the API (https, no userinfo/query); never plain http.
        if (auto valid = network::validateEndpoint(config_.host, /*allowInsecureLoopback=*/false); valid) {
            configured_ = true;
        } else {
            qCWarning(lcTelemetry, "PostHog disabled: invalid host (%s)", valid.error().message.c_str());
        }
    }
    // The flush timer only runs while events are waiting: it starts with the first enqueued event and stops once the
    // queue is empty, so an idle (or consent-less) app wakes the CPU for nothing. A 30 s tick needs no precision.
    flushTimer_.setInterval(config_.flushIntervalMs);
    flushTimer_.setTimerType(Qt::VeryCoarseTimer);
    connect(&flushTimer_, &QTimer::timeout, this, &PostHogAnalyticsTracker::flush);
}

void PostHogAnalyticsTracker::armFlushTimer() {
    if (isEnabled() && !queue_.isEmpty() && !flushTimer_.isActive()) {
        flushTimer_.start();
    }
}

PostHogAnalyticsTracker::~PostHogAnalyticsTracker() {
    // Best effort: the reply may not complete once the event loop is gone.
    flush();
}

void PostHogAnalyticsTracker::setConsent(bool granted) {
    if (granted == consent_) {
        return;
    }
    const bool wasEnabled = isEnabled();
    consent_ = granted;
    if (!consent_) {
        queue_.clear();
        flushTimer_.stop();
        if (!flags_.isEmpty()) {
            flags_.clear();
            emit featureFlagsChanged();
        }
    } else {
        reloadFeatureFlags();
    }
    if (wasEnabled != isEnabled()) {
        emit enabledChanged();
    }
}

void PostHogAnalyticsTracker::track(std::string_view event, const analytics::AnalyticsProperties& properties) {
    if (!isEnabled()) {
        return;
    }
    QJsonObject props = baseProperties();
    for (const auto& [key, value] : properties) {
        props.insert(QString::fromStdString(key), sanitizePropertyValue(QString::fromStdString(value)));
    }
    enqueue(PostHogEvent{.event = QString::fromUtf8(event.data(), static_cast<qsizetype>(event.size())),
                         .distinctId = distinctId(),
                         .properties = props,
                         .timestamp = QDateTime::currentDateTimeUtc()});
}

void PostHogAnalyticsTracker::identify(std::string_view userId) {
    const QString next = QString::fromUtf8(userId.data(), static_cast<qsizetype>(userId.size()));
    if (next.isEmpty() || next == userId_) {
        return;
    }
    if (isEnabled()) {
        // Links the anonymous pre-login events to the user (PostHog's $identify contract).
        QJsonObject props = baseProperties();
        props.insert(QStringLiteral("$anon_distinct_id"), config_.anonymousId);
        enqueue(PostHogEvent{.event = QStringLiteral("$identify"),
                             .distinctId = next,
                             .properties = props,
                             .timestamp = QDateTime::currentDateTimeUtc()});
    }
    userId_ = next;
    reloadFeatureFlags();
}

void PostHogAnalyticsTracker::reset() {
    flush();
    userId_.clear();
    reloadFeatureFlags();
}

void PostHogAnalyticsTracker::flush() {
    if (!isEnabled() || queue_.isEmpty()) {
        flushTimer_.stop(); // nothing waiting: no timer
        return;
    }
    if (flushInFlight_) {
        return;
    }
    const QList<PostHogEvent> batch = queue_.mid(0, config_.maxBatchSize);
    queue_.remove(0, batch.size());
    if (queue_.isEmpty()) {
        flushTimer_.stop();
    }

    QNetworkRequest request(endpoint(QStringLiteral("/batch/")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setTransferTimeout(15'000);
    flushInFlight_ = true;
    QNetworkReply* reply = network_.post(request, buildBatchPayload(config_.apiKey, batch));
    QPointer<PostHogAnalyticsTracker> guard(this);
    connect(reply, &QNetworkReply::finished, this, [guard, reply, batch]() {
        reply->deleteLater();
        if (!guard) {
            return;
        }
        guard->flushInFlight_ = false;
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (reply->error() == QNetworkReply::NoError && status >= 200 && status < 300) {
            if (!guard->queue_.isEmpty() && guard->queue_.size() >= guard->config_.maxBatchSize) {
                guard->flush();
            }
            guard->armFlushTimer(); // events enqueued while the batch was in flight
            return;
        }
        // 4xx other than 429 means the payload/key is wrong: retrying cannot help.
        if (status >= 400 && status < 500 && status != 429) {
            qCWarning(lcTelemetry, "PostHog rejected a batch (HTTP %d); dropping %lld events", status,
                      static_cast<long long>(batch.size()));
            return;
        }
        qCDebug(lcTelemetry, "PostHog batch failed (%s); re-queued", qPrintable(reply->errorString()));
        if (guard->isEnabled()) {
            guard->queue_ = batch + guard->queue_;
            while (guard->queue_.size() > guard->config_.maxQueuedEvents) {
                guard->queue_.removeFirst();
            }
            guard->armFlushTimer(); // retry on the next tick
        }
    });
}

bool PostHogAnalyticsTracker::isFeatureEnabled(const QString& key, bool fallback) const {
    const auto it = flags_.constFind(key);
    if (it == flags_.cend()) {
        return fallback;
    }
    return it->typeId() == QMetaType::QString ? !it->toString().isEmpty() : it->toBool();
}

QString PostHogAnalyticsTracker::featureVariant(const QString& key) const {
    const auto it = flags_.constFind(key);
    return (it != flags_.cend() && it->typeId() == QMetaType::QString) ? it->toString() : QString();
}

void PostHogAnalyticsTracker::reloadFeatureFlags() {
    if (!isEnabled()) {
        return;
    }
    QUrl url = endpoint(QStringLiteral("/flags"));
    url.setQuery(QUrlQuery{{QStringLiteral("v"), QStringLiteral("2")}});
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    request.setTransferTimeout(10'000);
    const QJsonObject body{{QStringLiteral("api_key"), config_.apiKey}, {QStringLiteral("distinct_id"), distinctId()}};
    QNetworkReply* reply = network_.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact));
    QPointer<PostHogAnalyticsTracker> guard(this);
    connect(reply, &QNetworkReply::finished, this, [guard, reply]() {
        reply->deleteLater();
        if (!guard || !guard->isEnabled() || reply->error() != QNetworkReply::NoError) {
            return;
        }
        auto flags = parseFeatureFlags(reply->readAll());
        if (flags != guard->flags_) {
            guard->flags_ = std::move(flags);
            emit guard->featureFlagsChanged();
        }
    });
}

QString PostHogAnalyticsTracker::distinctId() const {
    return userId_.isEmpty() ? config_.anonymousId : userId_;
}

QJsonObject PostHogAnalyticsTracker::baseProperties() const {
    return QJsonObject{
        {QStringLiteral("$lib"), QStringLiteral("aedst-desktop")},
        {QStringLiteral("$lib_version"), config_.appVersion},
        {QStringLiteral("$os"), QSysInfo::productType()},
        {QStringLiteral("$os_version"), QSysInfo::productVersion()},
        {QStringLiteral("app_version"), config_.appVersion},
    };
}

void PostHogAnalyticsTracker::enqueue(PostHogEvent event) {
    queue_.append(std::move(event));
    while (queue_.size() > config_.maxQueuedEvents) {
        queue_.removeFirst();
    }
    if (queue_.size() >= config_.maxBatchSize) {
        flush();
    }
    armFlushTimer();
}

QUrl PostHogAnalyticsTracker::endpoint(const QString& path) const {
    QUrl url = config_.host;
    QString base = url.path();
    while (base.endsWith(QLatin1Char('/'))) {
        base.chop(1);
    }
    url.setPath(base + path);
    return url;
}

} // namespace aedst::telemetry
