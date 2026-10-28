#include "Presentation/login_view_model.hpp"

#include "Domain/browser_sign_in_use_case.hpp"
#include "Domain/login_use_case.hpp"
#include "Domain/logout_use_case.hpp"
#include "Navigation/auth_route.hpp"
#include "aedst/analytics/analytics_tracker.hpp"
#include "aedst/navigation/router.hpp"

#include <QPointer>

#include <string>
#include <utility>

namespace aedst::feature::auth {

LoginViewModel::LoginViewModel(std::shared_ptr<LoginUseCase> login, std::shared_ptr<LogoutUseCase> logout,
                               std::shared_ptr<analytics::AnalyticsTracker> analytics, navigation::Router* router,
                               QObject* parent)
    : QObject(parent),
      login_(std::move(login)),
      logout_(std::move(logout)),
      analytics_(std::move(analytics)),
      router_(router) {}

QString LoginViewModel::email() const {
    return email_;
}

void LoginViewModel::setEmail(const QString& email) {
    if (email == email_) {
        return;
    }
    email_ = email;
    emit emailChanged();
    emit canSubmitChanged();
}

QString LoginViewModel::password() {
    return {};
}

void LoginViewModel::setPassword(const QString& password) {
    // toStdString() makes the only long-lived copy, inside a SecretString that
    // wipes itself; QString/JS copies made by QML are transient and cannot be wiped.
    std::string next = password.toStdString();
    if (next == password_.reveal()) {
        core::secureWipe(next);
        return;
    }
    const bool hadPassword = !password_.empty();
    password_ = core::SecretString(std::move(next));
    if (hadPassword != !password_.empty()) {
        emit hasPasswordChanged();
    }
    emit canSubmitChanged();
}

bool LoginViewModel::hasPassword() const noexcept {
    return !password_.empty();
}

void LoginViewModel::clearPassword() {
    if (password_.empty()) {
        return;
    }
    password_.clear();
    emit hasPasswordChanged();
    emit canSubmitChanged();
}

bool LoginViewModel::isLoading() const noexcept {
    return isLoading_;
}

QString LoginViewModel::errorMessage() const {
    return errorMessage_;
}

bool LoginViewModel::canSubmit() const {
    return !isLoading_ && !email_.trimmed().isEmpty() && !password_.empty();
}

QString LoginViewModel::messageFor(const core::Error& error) {
    switch (error.code) {
    case core::ErrorCode::Unauthenticated:
        return tr("Wrong e-mail or password.");
    case core::ErrorCode::InvalidInput:
        return tr("Check your e-mail and password and try again.");
    case core::ErrorCode::Forbidden:
        return tr("This account is not allowed to sign in.");
    case core::ErrorCode::RateLimited:
        return tr("Too many attempts. Wait a moment and try again.");
    case core::ErrorCode::Unavailable:
        return tr("The service cannot be reached right now. Try again later.");
    case core::ErrorCode::Offline:
        return tr("You are offline. Check your connection and try again.");
    case core::ErrorCode::Timeout:
        return tr("The request took too long. Try again.");
    case core::ErrorCode::Storage:
        return tr("Your session could not be stored securely on this device.");
    case core::ErrorCode::UpgradeRequired:
        return tr("This version of AEDST is no longer supported. Please update.");
    case core::ErrorCode::Conflict:
    case core::ErrorCode::NotFound:
    case core::ErrorCode::Cancelled:
    case core::ErrorCode::Unknown:
        break;
    }
    return tr("Sign-in failed. Try again.");
}

void LoginViewModel::login() {
    if (!canSubmit()) {
        return;
    }
    setErrorMessage({});
    setLoading(true);

    // Completions run later on the event loop; the guard makes a destroyed
    // ViewModel (window closed mid-request) a no-op instead of a dangling `this`.
    QPointer<LoginViewModel> guard(this);
    login_->execute(
        Credentials{.email = email_.trimmed().toStdString(), .password = password_},
        [guard](core::Outcome<Session> result) {
            if (!guard) {
                return;
            }
            guard->setLoading(false);

            if (!result) {
                const QString message = messageFor(result.error());
                guard->setErrorMessage(message);
                if (guard->analytics_) {
                    guard->analytics_->track(
                        analytics::events::kLoginFailed,
                        {{"method", "password"}, {"reason", std::string(core::toString(result.error().code))}});
                }
                emit guard->loginFailed(message);
                return;
            }

            guard->clearPassword();
            if (guard->analytics_) {
                guard->analytics_->identify(result->userId);
                guard->analytics_->track(analytics::events::kLoginSucceeded, {{"method", "password"}});
            }
            // Auth never names another feature's screen: App/
            // (AppDependencies::onSignedIn) routes to the signed-in
            // home (Tasks) and starts per-user background work.
            emit guard->loginSucceeded(QString::fromStdString(result->userId));
        });
}

bool LoginViewModel::browserSignInAvailable() const noexcept {
    return browserSignIn_ != nullptr && browserSignIn_->isAvailable();
}

bool LoginViewModel::waitingForBrowser() const noexcept {
    return waitingForBrowser_;
}

bool LoginViewModel::restoringSession() const noexcept {
    return restoringSession_;
}

void LoginViewModel::setBrowserSignIn(std::shared_ptr<BrowserSignInUseCase> useCase) {
    browserSignIn_ = std::move(useCase);
    emit browserSignInAvailableChanged();
}

void LoginViewModel::setRestoringSession(bool restoring) {
    if (restoring == restoringSession_) {
        return;
    }
    restoringSession_ = restoring;
    emit restoringSessionChanged();
}

void LoginViewModel::showError(const QString& message) {
    setErrorMessage(message);
}

void LoginViewModel::signInWithBrowser() {
    if (!browserSignInAvailable() || isLoading_) {
        return;
    }
    setErrorMessage({});
    setLoading(true);
    waitingForBrowser_ = true;
    emit waitingForBrowserChanged();

    QPointer<LoginViewModel> guard(this);
    browserSignIn_->execute(core::NoInput{}, [guard](core::Outcome<Session> result) {
        if (!guard) {
            return;
        }
        guard->waitingForBrowser_ = false;
        emit guard->waitingForBrowserChanged();
        guard->setLoading(false);

        if (!result) {
            // Cancelling or closing the browser step is a choice of the user, not an error to display.
            if (result.error().code != core::ErrorCode::Cancelled) {
                const QString message = messageFor(result.error());
                guard->setErrorMessage(message);
                if (guard->analytics_) {
                    guard->analytics_->track(
                        analytics::events::kLoginFailed,
                        {{"method", "browser"}, {"reason", std::string(core::toString(result.error().code))}});
                }
                emit guard->loginFailed(message);
            }
            return;
        }
        if (guard->analytics_) {
            guard->analytics_->identify(result->userId);
            guard->analytics_->track(analytics::events::kLoginSucceeded, {{"method", "browser"}});
        }
        emit guard->loginSucceeded(QString::fromStdString(result->userId));
    });
}

void LoginViewModel::cancelBrowserSignIn() {
    if (browserSignIn_ && waitingForBrowser_) {
        browserSignIn_->cancel(); // completes the pending execute() with Cancelled
    }
}

void LoginViewModel::logout() {
    clearPassword();
    setLoading(true);
    QPointer<LoginViewModel> guard(this);
    logout_->execute(core::NoInput{}, [guard](core::VoidOutcome result) {
        if (!guard) {
            return;
        }
        guard->setLoading(false);
        if (!result) {
            guard->setErrorMessage(QString::fromStdString(result.error().message));
        }
        if (guard->analytics_) {
            guard->analytics_->track(analytics::events::kLogout, {});
            guard->analytics_->reset();
        }
        emit guard->loggedOut();
        if (guard->router_ != nullptr) {
            guard->router_->resetTo(loginRoute());
        }
    });
}

void LoginViewModel::setLoading(bool loading) {
    if (loading == isLoading_) {
        return;
    }
    isLoading_ = loading;
    emit isLoadingChanged();
    emit canSubmitChanged();
}

void LoginViewModel::setErrorMessage(const QString& message) {
    if (message == errorMessage_) {
        return;
    }
    errorMessage_ = message;
    emit errorMessageChanged();
}

} // namespace aedst::feature::auth
