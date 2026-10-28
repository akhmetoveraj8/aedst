#include "aedst/connectivity/connectivity_monitor.hpp"

#include <QSignalSpy>
#include <QTest>

#include <memory>
#include <utility>

namespace aedst::connectivity {
namespace {

class FakeReachabilitySource final : public ReachabilitySource {
public:
    explicit FakeReachabilitySource(Reachability initial) : value_(initial) {}

    [[nodiscard]] Reachability reachability() const override { return value_; }

    void set(Reachability value) {
        value_ = value;
        emit reachabilityChanged();
    }

    /// Changes the value without telling anyone, to exercise refresh().
    void setSilently(Reachability value) { value_ = value; }

private:
    Reachability value_;
};

} // namespace

class ConnectivityMonitorTest : public QObject {
    Q_OBJECT

private slots:

    void nullSourceIsUnknownAndNotOffline() {
        ConnectivityMonitor monitor(nullptr);
        QCOMPARE(monitor.state(), ConnectivityMonitor::State::Unknown);
        QVERIFY(!monitor.isOffline());
        monitor.refresh(); // must not crash
        QVERIFY(!monitor.isOffline());
    }

    void initialStateComesFromSource() {
        ConnectivityMonitor online(std::make_unique<FakeReachabilitySource>(Reachability::Online));
        QCOMPARE(online.state(), ConnectivityMonitor::State::Online);
        QVERIFY(!online.isOffline());

        ConnectivityMonitor offline(std::make_unique<FakeReachabilitySource>(Reachability::Offline));
        QCOMPARE(offline.state(), ConnectivityMonitor::State::Offline);
        QVERIFY(offline.isOffline());
    }

    void unknownIsTreatedAsOnline() {
        ConnectivityMonitor monitor(std::make_unique<FakeReachabilitySource>(Reachability::Unknown));
        QCOMPARE(monitor.state(), ConnectivityMonitor::State::Unknown);
        QVERIFY(!monitor.isOffline());
    }

    void transitionsEmitSignalsOnce() {
        auto source = std::make_unique<FakeReachabilitySource>(Reachability::Online);
        auto* fake = source.get();
        ConnectivityMonitor monitor(std::move(source));
        QSignalSpy stateSpy(&monitor, &ConnectivityMonitor::stateChanged);
        QSignalSpy offlineSpy(&monitor, &ConnectivityMonitor::isOfflineChanged);

        fake->set(Reachability::Offline);
        QCOMPARE(stateSpy.count(), 1);
        QCOMPARE(offlineSpy.count(), 1);
        QVERIFY(monitor.isOffline());

        fake->set(Reachability::Offline); // no change -> no signal
        QCOMPARE(stateSpy.count(), 1);
        QCOMPARE(offlineSpy.count(), 1);

        fake->set(Reachability::Online);
        QCOMPARE(stateSpy.count(), 2);
        QCOMPARE(offlineSpy.count(), 2);
        QVERIFY(!monitor.isOffline());
    }

    void offlineToUnknownEmitsIsOfflineChanged() {
        auto source = std::make_unique<FakeReachabilitySource>(Reachability::Offline);
        auto* fake = source.get();
        ConnectivityMonitor monitor(std::move(source));
        QSignalSpy offlineSpy(&monitor, &ConnectivityMonitor::isOfflineChanged);

        fake->set(Reachability::Unknown);

        QCOMPARE(offlineSpy.count(), 1);
        QVERIFY(!monitor.isOffline());
    }

    void onlineToUnknownDoesNotEmitIsOfflineChanged() {
        auto source = std::make_unique<FakeReachabilitySource>(Reachability::Online);
        auto* fake = source.get();
        ConnectivityMonitor monitor(std::move(source));
        QSignalSpy stateSpy(&monitor, &ConnectivityMonitor::stateChanged);
        QSignalSpy offlineSpy(&monitor, &ConnectivityMonitor::isOfflineChanged);

        fake->set(Reachability::Unknown);

        QCOMPARE(stateSpy.count(), 1);
        QCOMPARE(offlineSpy.count(), 0);
    }

    void refreshRereadsTheSource() {
        auto source = std::make_unique<FakeReachabilitySource>(Reachability::Online);
        auto* fake = source.get();
        ConnectivityMonitor monitor(std::move(source));

        fake->setSilently(Reachability::Offline);
        QVERIFY(!monitor.isOffline());
        monitor.refresh();
        QVERIFY(monitor.isOffline());
    }

    void defaultFactoryConstructsWithoutBackend() {
        // Whatever backends exist on the CI machine, the monitor must construct
        // and expose a coherent state.
        auto monitor = ConnectivityMonitor::createDefault();
        QVERIFY(monitor != nullptr);
        QCOMPARE(monitor->isOffline(), monitor->state() == ConnectivityMonitor::State::Offline);
    }
};

} // namespace aedst::connectivity

QTEST_GUILESS_MAIN(aedst::connectivity::ConnectivityMonitorTest)
#include "connectivity_monitor_test.moc"
