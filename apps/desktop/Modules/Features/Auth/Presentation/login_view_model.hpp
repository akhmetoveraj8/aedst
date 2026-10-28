#pragma once

#include "aedst/core/error.hpp"
#include "aedst/core/secure_memory.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

#include <memory>

namespace aedst::analytics {
class AnalyticsTracker;
} // namespace aedst::analytics

namespace aedst::navigation {
class Router;
} // namespace aedst::navigation

namespace aedst::feature::auth {

class BrowserSignInUseCase;
class LoginUseCase;
class LogoutUseCase;

/// Unidirectional data flow, Qt-style:
///  - State is Q_PROPERTY + NOTIFY (QML re-reads on change) — the StateFlow /
///    @Published equivalent.
///  - One-shot effects are plain signals (loginSucceeded / loginFailed /
///    loggedOut), never properties, so a re-created view can't replay a
///    navigation or a toast — the same split as Android's UiState vs Effect
///    channel.
/// Navigation after login goes through the Core Router by route name; this
/// class never references Users or Profile.
class LoginViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(QString email READ email WRITE setEmail NOTIFY emailChanged)
    // Write-only from QML: READ always returns an empty string so the secret is never
    // bound back into the UI; QML observes `hasPassword` instead.
    Q_PROPERTY(QString password READ password WRITE setPassword)
    Q_PROPERTY(bool hasPassword READ hasPassword NOTIFY hasPasswordChanged)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)
    Q_PROPERTY(bool canSubmit READ canSubmit NOTIFY canSubmitChanged)
    // Single sign-on in the system browser (OpenID Connect). When available the view shows one
    // "Continue in browser" button instead of the e-mail/password form.
    Q_PROPERTY(bool browserSignInAvailable READ browserSignInAvailable NOTIFY browserSignInAvailableChanged)
    // The browser step is running: the app waits for the user to finish (or cancel) in the browser.
    Q_PROPERTY(bool waitingForBrowser READ waitingForBrowser NOTIFY waitingForBrowserChanged)
    // A stored session is being restored at startup; the view shows progress instead of the form.
    Q_PROPERTY(bool restoringSession READ restoringSession NOTIFY restoringSessionChanged)

public:
    static LoginViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<LoginViewModel>::create(engine, script);
    }

    LoginViewModel(std::shared_ptr<LoginUseCase> login, std::shared_ptr<LogoutUseCase> logout,
                   std::shared_ptr<analytics::AnalyticsTracker> analytics, navigation::Router* router,
                   QObject* parent = nullptr);

    [[nodiscard]] QString email() const;
    void setEmail(const QString& email);
    /// Always empty (write-only property, see above).
    [[nodiscard]] static QString password();
    /// Stores the secret in a wiping std::string (core::SecretString), not in a QString member.
    void setPassword(const QString& password);
    [[nodiscard]] bool hasPassword() const noexcept;
    [[nodiscard]] bool isLoading() const noexcept;
    [[nodiscard]] QString errorMessage() const;
    [[nodiscard]] bool canSubmit() const;
    [[nodiscard]] bool browserSignInAvailable() const noexcept;
    [[nodiscard]] bool waitingForBrowser() const noexcept;
    [[nodiscard]] bool restoringSession() const noexcept;

    /// Enables the browser flow (the composition root calls it when OIDC is configured).
    void setBrowserSignIn(std::shared_ptr<BrowserSignInUseCase> useCase);
    void setRestoringSession(bool restoring);
    /// Shows an error that did not come from a user action (for example a startup restore failure).
    void showError(const QString& message);

    /// The text the user sees for a failure, chosen by its error CODE and translated (qsTr catalogs). The server's own
    /// message is English-only and may carry technical detail; it is logged, never shown.
    [[nodiscard]] static QString messageFor(const core::Error& error);

    Q_INVOKABLE void login();
    /// Wipes the held password (also done on success, logout and destruction).
    Q_INVOKABLE void clearPassword();
    Q_INVOKABLE void logout();
    Q_INVOKABLE void signInWithBrowser();
    Q_INVOKABLE void cancelBrowserSignIn();

signals:
    void emailChanged();
    void hasPasswordChanged();
    void isLoadingChanged();
    void errorMessageChanged();
    void canSubmitChanged();
    void browserSignInAvailableChanged();
    void waitingForBrowserChanged();
    void restoringSessionChanged();

    void loginSucceeded(const QString& userId);
    void loginFailed(const QString& message);
    void loggedOut();

private:
    void setLoading(bool loading);
    void setErrorMessage(const QString& message);

    std::shared_ptr<LoginUseCase> login_;
    std::shared_ptr<LogoutUseCase> logout_;
    std::shared_ptr<BrowserSignInUseCase> browserSignIn_;
    std::shared_ptr<analytics::AnalyticsTracker> analytics_;
    navigation::Router* router_;

    QString email_;
    core::SecretString password_;
    QString errorMessage_;
    bool isLoading_{false};
    bool waitingForBrowser_{false};
    bool restoringSession_{false};
};

} // namespace aedst::feature::auth
