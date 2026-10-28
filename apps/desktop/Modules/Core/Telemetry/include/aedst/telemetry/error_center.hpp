#pragma once

#include "aedst/core/error_sink.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QElapsedTimer>
#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

#include <string>

namespace aedst::telemetry {

/// The app's single typed-error -> UI path (the desktop analogue of a global
/// toast/error boundary). Features report core::Error through the core::ErrorSink
/// port; this class
///  1. logs it (AedstLogger) and records a crash-reporter breadcrumb,
///  2. maps the code to a stable UI kind string that QML turns into a localized
///     title (App/qml/Main.qml's toast host / banner): the shared kind
///     name (core::toString, error-kinds.json): "unavailable", "offline", "unauthenticated", "forbidden", ...,
///  3. emits errorRaised() unless the visibility is Silent, collapsing identical
///     errors within kDedupWindowMs so a failing poll cannot stack toasts,
///  4. emits sessionExpired() for Unauthenticated so App/ can route to login once.
/// Cancelled errors are dropped (user intent, not a failure). Reportable errors
/// (core::isReportable: unknown, storage - a bug, a contract gap or a disk fault) are additionally captured as a
/// Sentry event. isRetryable follows core::isRetryable, the same flags as the outbox and the other clients.
/// GUI thread only (it is a QObject used from QML).
class ErrorCenter final : public QObject, public core::ErrorSink {
    Q_OBJECT
    QML_NAMED_ELEMENT(Errors)
    QML_SINGLETON

public:
    static ErrorCenter* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<ErrorCenter>::create(engine, script);
    }

    static constexpr qint64 kDedupWindowMs = 3000;

    explicit ErrorCenter(QObject* parent = nullptr);

    void report(const core::Error& error, std::string_view context,
                core::ErrorVisibility visibility = core::ErrorVisibility::Transient) override;

    /// Stable kind string for a code (exposed for QML tests and the mapping test).
    [[nodiscard]] static QString kindFor(core::ErrorCode code);
    [[nodiscard]] static bool isRetryable(core::ErrorCode code) noexcept;

signals:
    /// `blocking` = show a persistent banner instead of an auto-dismissing toast.
    void errorRaised(const QString& kind, const QString& message, bool retryable, bool blocking);
    void sessionExpired();

private:
    std::string lastKey_;
    QElapsedTimer lastAt_;
};

} // namespace aedst::telemetry
