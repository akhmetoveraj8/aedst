#pragma once

#include <QObject>

namespace aedst::connectivity {

/// What a platform backend can tell us about the network. `Unknown` means "no
/// backend / cannot tell" and must be treated as "assume online".
enum class Reachability {
    Unknown,
    Online,
    Offline
};

/// Seam between ConnectivityMonitor and the OS. Production code uses
/// QtNetworkInformationSource (QNetworkInformation); tests inject a fake.
class ReachabilitySource : public QObject {
    Q_OBJECT

public:
    explicit ReachabilitySource(QObject* parent = nullptr) : QObject(parent) {}

    /// Current reachability, read on demand; `reachabilityChanged` only says "look again".
    [[nodiscard]] virtual Reachability reachability() const = 0;

signals:
    void reachabilityChanged();
};

/// Wraps QNetworkInformation (Qt's own cross-platform reachability API).
/// Degrades to `Reachability::Unknown` when no backend plugin can be loaded.
class QtNetworkInformationSource final : public ReachabilitySource {
    Q_OBJECT

public:
    explicit QtNetworkInformationSource(QObject* parent = nullptr);

    [[nodiscard]] Reachability reachability() const override;
    /// True when a backend was loaded and supports the Reachability feature.
    [[nodiscard]] bool isAvailable() const noexcept;
};

} // namespace aedst::connectivity
