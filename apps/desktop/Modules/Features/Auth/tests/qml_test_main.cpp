// QtQuickTest runner for LoginView. LoginView.qml is loaded from its real qrc path;
// the two singletons it imports (`Aedst.Feature.Auth`'s LoginViewModel and
// `Aedst.Connectivity`'s Connectivity) are replaced by the fakes below, which expose
// the same property/slot names as the production classes.
#include "aedst/designsystem/theme_controller.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QQmlEngine>
#include <QString>
#include <QtQml>
#include <QtQuickTest>

namespace {

class FakeLoginViewModel final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString email READ email WRITE setEmail NOTIFY emailChanged)
    // Write-only, like the real LoginViewModel: READ never returns the secret.
    Q_PROPERTY(QString password READ password WRITE setPassword)
    Q_PROPERTY(bool hasPassword READ hasPassword NOTIFY hasPasswordChanged)
    Q_PROPERTY(bool isLoading READ isLoading WRITE setIsLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage WRITE setErrorMessage NOTIFY errorMessageChanged)
    Q_PROPERTY(bool canSubmit READ canSubmit NOTIFY canSubmitChanged)
    Q_PROPERTY(bool browserSignInAvailable READ browserSignInAvailable WRITE setBrowserSignInAvailable NOTIFY
                   browserSignInAvailableChanged)
    Q_PROPERTY(bool waitingForBrowser READ waitingForBrowser WRITE setWaitingForBrowser NOTIFY waitingForBrowserChanged)
    Q_PROPERTY(bool restoringSession READ restoringSession WRITE setRestoringSession NOTIFY restoringSessionChanged)
    Q_PROPERTY(int browserCalls READ browserCalls NOTIFY loginCallsChanged)
    Q_PROPERTY(int cancelCalls READ cancelCalls NOTIFY loginCallsChanged)
    // Test-only observability.
    Q_PROPERTY(int loginCalls READ loginCalls NOTIFY loginCallsChanged)
    Q_PROPERTY(QString lastPassword READ lastPassword NOTIFY loginCallsChanged)

public:
    [[nodiscard]] QString email() const { return email_; }

    void setEmail(const QString& value) {
        if (value == email_) {
            return;
        }
        email_ = value;
        emit emailChanged();
        emit canSubmitChanged();
    }

    [[nodiscard]] static QString password() { return {}; }

    void setPassword(const QString& value) {
        const bool had = !password_.isEmpty();
        password_ = value;
        if (had != !password_.isEmpty()) {
            emit hasPasswordChanged();
        }
        emit canSubmitChanged();
    }

    [[nodiscard]] bool hasPassword() const { return !password_.isEmpty(); }

    [[nodiscard]] bool isLoading() const { return isLoading_; }

    void setIsLoading(bool value) {
        if (value == isLoading_) {
            return;
        }
        isLoading_ = value;
        emit isLoadingChanged();
        emit canSubmitChanged();
    }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    void setErrorMessage(const QString& value) {
        if (value == errorMessage_) {
            return;
        }
        errorMessage_ = value;
        emit errorMessageChanged();
    }

    [[nodiscard]] bool canSubmit() const { return !isLoading_ && !email_.trimmed().isEmpty() && !password_.isEmpty(); }

    [[nodiscard]] bool browserSignInAvailable() const { return browserSignInAvailable_; }

    void setBrowserSignInAvailable(bool value) {
        if (value == browserSignInAvailable_) {
            return;
        }
        browserSignInAvailable_ = value;
        emit browserSignInAvailableChanged();
    }

    [[nodiscard]] bool waitingForBrowser() const { return waitingForBrowser_; }

    void setWaitingForBrowser(bool value) {
        if (value == waitingForBrowser_) {
            return;
        }
        waitingForBrowser_ = value;
        emit waitingForBrowserChanged();
    }

    [[nodiscard]] bool restoringSession() const { return restoringSession_; }

    void setRestoringSession(bool value) {
        if (value == restoringSession_) {
            return;
        }
        restoringSession_ = value;
        emit restoringSessionChanged();
    }

    [[nodiscard]] int browserCalls() const { return browserCalls_; }

    [[nodiscard]] int cancelCalls() const { return cancelCalls_; }

    [[nodiscard]] int loginCalls() const { return loginCalls_; }

    [[nodiscard]] QString lastPassword() const { return lastPassword_; }

    Q_INVOKABLE void login() {
        if (!canSubmit()) {
            return;
        }
        ++loginCalls_;
        lastPassword_ = password_;
        emit loginCallsChanged();
    }

    Q_INVOKABLE void logout() { emit loggedOut(); }

    Q_INVOKABLE void signInWithBrowser() {
        ++browserCalls_;
        setWaitingForBrowser(true);
        emit loginCallsChanged();
    }

    Q_INVOKABLE void cancelBrowserSignIn() {
        ++cancelCalls_;
        setWaitingForBrowser(false);
        emit loginCallsChanged();
    }

    Q_INVOKABLE void clearPassword() { setPassword({}); }

    Q_INVOKABLE void emitLoginSucceeded() { emit loginSucceeded(QStringLiteral("user-1")); }

    Q_INVOKABLE void emitLoginFailed() { emit loginFailed(errorMessage_); }

    Q_INVOKABLE void reset() {
        setEmail({});
        setPassword({});
        setIsLoading(false);
        setErrorMessage({});
        setBrowserSignInAvailable(false);
        setWaitingForBrowser(false);
        setRestoringSession(false);
        browserCalls_ = 0;
        cancelCalls_ = 0;
        loginCalls_ = 0;
        lastPassword_.clear();
        emit loginCallsChanged();
    }

signals:
    void emailChanged();
    void hasPasswordChanged();
    void isLoadingChanged();
    void errorMessageChanged();
    void canSubmitChanged();
    void browserSignInAvailableChanged();
    void waitingForBrowserChanged();
    void restoringSessionChanged();
    void loginCallsChanged();
    void loginSucceeded(const QString& userId);
    void loginFailed(const QString& message);
    void loggedOut();

private:
    QString email_;
    QString password_;
    QString errorMessage_;
    QString lastPassword_;
    int loginCalls_{0};
    int browserCalls_{0};
    int cancelCalls_{0};
    bool isLoading_{false};
    bool browserSignInAvailable_{false};
    bool waitingForBrowser_{false};
    bool restoringSession_{false};
};

class FakeConnectivity final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool isOffline READ isOffline WRITE setIsOffline NOTIFY isOfflineChanged)
    Q_PROPERTY(int refreshCalls READ refreshCalls NOTIFY refreshCallsChanged)

public:
    [[nodiscard]] bool isOffline() const { return isOffline_; }

    void setIsOffline(bool value) {
        if (value == isOffline_) {
            return;
        }
        isOffline_ = value;
        emit isOfflineChanged();
    }

    [[nodiscard]] int refreshCalls() const { return refreshCalls_; }

    Q_INVOKABLE void refresh() {
        ++refreshCalls_;
        emit refreshCallsChanged();
    }

    Q_INVOKABLE void reset() {
        setIsOffline(false);
        refreshCalls_ = 0;
        emit refreshCallsChanged();
    }

signals:
    void isOfflineChanged();
    void refreshCallsChanged();

private:
    int refreshCalls_{0};
    bool isOffline_{false};
};

class Setup final : public QObject {
    Q_OBJECT

public slots:

    void qmlEngineAvailable(QQmlEngine* /*engine*/) {
        // ThemeController is a declarative QML_SINGLETON of the AedstDesignSystem module (real class, no fake).
        aedst::qmlsupport::SingletonSlot<aedst::designsystem::ThemeController>::provide(&theme_);
        qmlRegisterSingletonInstance("Aedst.Feature.Auth", 1, 0, "LoginViewModel", &viewModel_);
        qmlRegisterSingletonInstance("Aedst.Connectivity", 1, 0, "Connectivity", &connectivity_);
    }

private:
    aedst::designsystem::ThemeController theme_;
    FakeLoginViewModel viewModel_;
    FakeConnectivity connectivity_;
};

} // namespace

QUICK_TEST_MAIN_WITH_SETUP(tst_login_view, Setup)

#include "qml_test_main.moc"
