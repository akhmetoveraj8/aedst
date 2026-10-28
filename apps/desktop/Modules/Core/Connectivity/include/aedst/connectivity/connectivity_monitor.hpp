#pragma once

#include "aedst/connectivity/reachability_source.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QtQml/qqmlregistration.h>

#include <memory>

namespace aedst::connectivity {

/// Network reachability as QML state. Registered by App as the `Connectivity`
/// singleton of `Aedst.Connectivity`:
///   import Aedst.Connectivity
///   Button { enabled: !Connectivity.isOffline }
/// Advisory only: `Unknown` (no backend, or Qt reports only local reachability)
/// is treated as online, so a missing OS backend never blocks the user.
class ConnectivityMonitor final : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Connectivity)
    QML_SINGLETON
    Q_PROPERTY(State state READ state NOTIFY stateChanged)
    Q_PROPERTY(bool isOffline READ isOffline NOTIFY isOfflineChanged)

public:
    static ConnectivityMonitor* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<ConnectivityMonitor>::create(engine, script);
    }
    enum class State {
        Unknown,
        Online,
        Offline
    };
    Q_ENUM(State)

    /// Takes ownership of `source`; a null source yields a permanently `Unknown` monitor.
    explicit ConnectivityMonitor(std::unique_ptr<ReachabilitySource> source, QObject* parent = nullptr);
    /// Production factory: monitor backed by QtNetworkInformationSource.
    [[nodiscard]] static std::unique_ptr<ConnectivityMonitor> createDefault(QObject* parent = nullptr);

    [[nodiscard]] State state() const noexcept;
    [[nodiscard]] bool isOffline() const noexcept;

    /// Re-reads the source (for a "Retry" button); no-op if nothing changed.
    Q_INVOKABLE void refresh();

signals:
    void stateChanged();
    void isOfflineChanged();

private:
    void update();

    std::unique_ptr<ReachabilitySource> source_;
    State state_{State::Unknown};
};

} // namespace aedst::connectivity
