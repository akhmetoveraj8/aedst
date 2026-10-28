// QtQuickTest runner for the app shell (App/qml/Main.qml, AppToolbar.qml, PrivacyDialog.qml, UpdateBanner.qml).
//
// Main.qml is loaded from its SOURCE path (the executable target aedst-desktop cannot be linked into a test), against
// fakes of every singleton it imports. The fakes expose the same property/signal names as the production classes; they
// are registered under the module URIs Main.qml imports (the static QML plugins of the real modules are not linked
// here). The real RouteNames (Routes singleton) and ThemeController are used as they are.
#include "aedst/designsystem/theme_controller.hpp"
#include "aedst/navigation/route_names.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QQmlContext>
#include <QQmlEngine>
#include <QStringList>
#include <QUrl>
#include <QVariantMap>
#include <QtQml>
#include <QtQuickTest>

namespace {

class FakeRouter final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString currentRoute READ currentRoute NOTIFY currentRouteChanged)
    Q_PROPERTY(int depth READ depth NOTIFY currentRouteChanged)

public:
    [[nodiscard]] QString currentRoute() const { return current_; }

    [[nodiscard]] int depth() const { return depth_; }

    void setScreen(const QUrl& screen) { screen_ = screen; }

    Q_INVOKABLE bool replaceAll(const QString& route, const QVariantMap& = {}) { return go(route, true); }

    Q_INVOKABLE bool navigate(const QString& route, const QVariantMap& = {}) { return go(route, false); }

    Q_INVOKABLE bool goBack() {
        if (depth_ <= 1) {
            return false;
        }
        --depth_;
        ++backs_;
        emit popRequested();
        emit currentRouteChanged();
        return true;
    }

    /// Test helper: how many times goBack() succeeded.
    Q_INVOKABLE int backCount() const { return backs_; }

signals:
    void pushRequested(const QUrl& view, const QVariantMap& properties);
    void popRequested();
    void replaceAllRequested(const QUrl& view, const QVariantMap& properties);
    void currentRouteChanged();

private:
    bool go(const QString& route, bool replace) {
        current_ = route;
        depth_ = replace ? 1 : depth_ + 1;
        if (replace) {
            emit replaceAllRequested(screen_, {});
        } else {
            emit pushRequested(screen_, {});
        }
        emit currentRouteChanged();
        return true;
    }

    QString current_;
    QUrl screen_;
    int depth_{0};
    int backs_{0};
};

class FakeSession final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool signedIn READ signedIn CONSTANT)
    Q_PROPERTY(bool isAdmin READ isAdmin WRITE setIsAdmin NOTIFY changed)
    Q_PROPERTY(QStringList visibleFeatures READ visibleFeatures WRITE setVisibleFeatures NOTIFY changed)

public:
    [[nodiscard]] static bool signedIn() { return true; }

    [[nodiscard]] bool isAdmin() const { return isAdmin_; }

    void setIsAdmin(bool value) {
        isAdmin_ = value;
        emit changed();
    }

    [[nodiscard]] QStringList visibleFeatures() const { return features_; }

    void setVisibleFeatures(const QStringList& value) {
        features_ = value;
        emit changed();
    }

signals:
    void changed();

private:
    QStringList features_{QStringLiteral("tasks"), QStringLiteral("search"), QStringLiteral("media"),
                          QStringLiteral("notifications"), QStringLiteral("admin")};
    bool isAdmin_{true};
};

class FakeConnectivity final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool isOffline READ isOffline WRITE setIsOffline NOTIFY isOfflineChanged)

public:
    [[nodiscard]] bool isOffline() const { return offline_; }

    void setIsOffline(bool value) {
        offline_ = value;
        emit isOfflineChanged();
    }

    Q_INVOKABLE void refresh() {}

signals:
    void isOfflineChanged();

private:
    bool offline_{false};
};

class FakeLoginViewModel final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool isLoading READ isLoading CONSTANT)

public:
    [[nodiscard]] static bool isLoading() { return false; }

    Q_INVOKABLE void logout() { ++logouts_; }

    Q_INVOKABLE int logoutCount() const { return logouts_; }

private:
    int logouts_{0};
};

class FakeNotificationsViewModel final : public QObject {
    Q_OBJECT
    Q_PROPERTY(int unreadCount READ unreadCount CONSTANT)

public:
    [[nodiscard]] static int unreadCount() { return 3; }
};

class FakeTelemetry final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool crashReportsAvailable READ yes CONSTANT)
    Q_PROPERTY(bool analyticsAvailable READ yes CONSTANT)
    Q_PROPERTY(bool needsDecision READ no CONSTANT)
    Q_PROPERTY(bool crashReportsEnabled READ no WRITE ignore NOTIFY unused)
    Q_PROPERTY(bool analyticsEnabled READ no WRITE ignore NOTIFY unused)

public:
    [[nodiscard]] static bool yes() { return true; }

    [[nodiscard]] static bool no() { return false; }

    void ignore(bool) {}

    Q_INVOKABLE void decideAll(bool) {}

signals:
    void unused();
};

class FakeErrors final : public QObject {
    Q_OBJECT

public:
    /// Test helper: raise a failure the way ErrorCenter does.
    Q_INVOKABLE void raise(const QString& kind, const QString& message, bool blocking) {
        emit errorRaised(kind, message, false, blocking);
    }

signals:
    void errorRaised(const QString& kind, const QString& message, bool retryable, bool blocking);
};

class FakeNotifications final : public QObject {
    Q_OBJECT

signals:
    void notificationRaised(const QString& title, const QString& body, int severity);
};

class Setup final : public QObject {
    Q_OBJECT

public slots:

    void qmlEngineAvailable(QQmlEngine* engine) {
        aedst::qmlsupport::SingletonSlot<aedst::designsystem::ThemeController>::provide(&theme_);
        router_.setScreen(QUrl::fromLocalFile(QStringLiteral(AEDST_APP_TEST_QML_DIR "/FakeScreen.qml")));
        qmlRegisterSingletonInstance("Aedst.Navigation", 1, 0, "AppRouter", &router_);
        qmlRegisterSingletonType<aedst::navigation::RouteNames>(
            "Aedst.Navigation", 1, 0, "Routes",
            [](QQmlEngine*, QJSEngine*) { return new aedst::navigation::RouteNames; });
        qmlRegisterSingletonInstance("Aedst.Connectivity", 1, 0, "Connectivity", &connectivity_);
        qmlRegisterSingletonInstance("Aedst.Feature.Auth", 1, 0, "LoginViewModel", &login_);
        qmlRegisterSingletonInstance("Aedst.Feature.Notifications", 1, 0, "NotificationsViewModel", &notificationsVm_);
        qmlRegisterSingletonInstance("Aedst.Platform", 1, 0, "Notifications", &notifications_);
        // `Session` belongs to the app module itself in production (Main.qml needs no import for it); here it is
        // provided by a module Main.qml does import.
        qmlRegisterSingletonInstance("Aedst.Platform", 1, 0, "Session", &session_);
        qmlRegisterSingletonInstance("Aedst.Telemetry", 1, 0, "Telemetry", &telemetry_);
        qmlRegisterSingletonInstance("Aedst.Telemetry", 1, 0, "Errors", &errors_);
        engine->rootContext()->setContextProperty(QStringLiteral("appQmlDir"),
                                                  QUrl::fromLocalFile(QStringLiteral(AEDST_APP_QML_DIR)));
        engine->rootContext()->setContextProperty(QStringLiteral("fakeRouter"), &router_);
        engine->rootContext()->setContextProperty(QStringLiteral("fakeSession"), &session_);
        engine->rootContext()->setContextProperty(QStringLiteral("fakeConnectivity"), &connectivity_);
        engine->rootContext()->setContextProperty(QStringLiteral("fakeLogin"), &login_);
        engine->rootContext()->setContextProperty(QStringLiteral("fakeErrors"), &errors_);
    }

private:
    aedst::designsystem::ThemeController theme_;
    FakeRouter router_;
    FakeSession session_;
    FakeConnectivity connectivity_;
    FakeLoginViewModel login_;
    FakeNotificationsViewModel notificationsVm_;
    FakeNotifications notifications_;
    FakeTelemetry telemetry_;
    FakeErrors errors_;
};

} // namespace

QUICK_TEST_MAIN_WITH_SETUP(tst_main_shell, Setup)

#include "app_qml_test_main.moc"
