#pragma once

#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QStringList>
#include <QtQml/qqmlregistration.h>

#include <utility>

namespace aedst::app {

/// App-level view of "who is signed in" for the shell (Main.qml): whether a
/// session exists and whether its access token carries the admin role. Lives in
/// App/ because it combines Auth's session with the Admin feature's entry point -
/// no feature may know both. Registered as the `Session` singleton of `Aedst.App`.
class SessionInfo final : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Session)
    QML_SINGLETON
    Q_PROPERTY(bool signedIn READ signedIn NOTIFY changed)
    Q_PROPERTY(bool isAdmin READ isAdmin NOTIFY changed)
    /// Server-enabled features of this build ("tasks", "media.uploads", ...), from capability negotiation. QML shows a
    /// section only when its id is listed (Main.qml); the defaults apply until the server has answered.
    Q_PROPERTY(QStringList visibleFeatures READ visibleFeatures NOTIFY visibleFeaturesChanged)

public:
    static SessionInfo* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<SessionInfo>::create(engine, script);
    }

    explicit SessionInfo(QObject* parent = nullptr) : QObject(parent) {}

    [[nodiscard]] bool signedIn() const noexcept { return signedIn_; }

    [[nodiscard]] bool isAdmin() const noexcept { return isAdmin_; }

    void set(bool signedIn, bool isAdmin) {
        if (signedIn == signedIn_ && isAdmin == isAdmin_) {
            return;
        }
        signedIn_ = signedIn;
        isAdmin_ = signedIn && isAdmin;
        emit changed();
    }

    [[nodiscard]] const QStringList& visibleFeatures() const noexcept { return visibleFeatures_; }

    void setVisibleFeatures(QStringList features) {
        if (features == visibleFeatures_) {
            return;
        }
        visibleFeatures_ = std::move(features);
        emit visibleFeaturesChanged();
    }

signals:
    void changed();
    void visibleFeaturesChanged();

private:
    QStringList visibleFeatures_;
    bool signedIn_{false};
    bool isAdmin_{false};
};

} // namespace aedst::app
