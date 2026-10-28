#include "Domain/auth_repository.hpp"
#include "Domain/browser_sign_in_use_case.hpp"
#include "Domain/login_use_case.hpp"
#include "Domain/logout_use_case.hpp"
#include "Presentation/login_view_model.hpp"
#include "aedst/analytics/no_op_analytics_tracker.hpp"

#include <QSignalSpy>
#include <QTest>

#include <memory>
#include <optional>
#include <utility>

namespace aedst::feature::auth {
namespace {

/// Hand-rolled fake (not gMock) so tests can hold a login open and assert on
/// the in-flight state before completing it.
class FakeAuthRepository final : public AuthRepository {
public:
    void login(const Credentials& credentials, core::Completion<Session> done) override {
        ++loginCalls;
        lastCredentials = credentials;
        pendingLogin = std::move(done);
    }

    void refreshToken(core::Completion<Session> done) override {
        done(core::fail(core::Error::unauthenticated("not used")));
    }

    void logout(core::Completion<void> done) override {
        ++logoutCalls;
        done(core::ok());
    }

    [[nodiscard]] std::optional<Session> currentSession() const override { return std::nullopt; }

    void signInWithBrowser(core::Completion<Session> done) override {
        ++browserCalls;
        pendingBrowser = std::move(done);
    }

    void cancelBrowserSignIn() override {
        ++cancelCalls;
        if (pendingBrowser) {
            auto done = std::exchange(pendingBrowser, nullptr);
            done(core::fail(core::Error::cancelled("Sign-in was cancelled")));
        }
    }

    [[nodiscard]] bool supportsBrowserSignIn() const override { return browserSupported; }

    void completeBrowser(core::Outcome<Session> result) {
        auto done = std::exchange(pendingBrowser, nullptr);
        done(std::move(result));
    }

    void completeLogin(core::Outcome<Session> result) {
        auto done = std::exchange(pendingLogin, nullptr);
        done(std::move(result));
    }

    int loginCalls{0};
    int logoutCalls{0};
    int browserCalls{0};
    int cancelCalls{0};
    bool browserSupported{true};
    core::Completion<Session> pendingBrowser;
    Credentials lastCredentials;
    core::Completion<Session> pendingLogin;
};

} // namespace

class LoginViewModelTest : public QObject {
    Q_OBJECT

private:
    std::shared_ptr<FakeAuthRepository> repository_;
    std::unique_ptr<LoginViewModel> viewModel_;

private slots:

    void init() {
        repository_ = std::make_shared<FakeAuthRepository>();
        viewModel_ = std::make_unique<LoginViewModel>(std::make_shared<LoginUseCase>(repository_),
                                                      std::make_shared<LogoutUseCase>(repository_),
                                                      std::make_shared<analytics::NoOpAnalyticsTracker>(), nullptr);
    }

    void cleanup() {
        viewModel_.reset();
        repository_.reset();
    }

    void canSubmitRequiresEmailAndPassword() {
        QVERIFY(!viewModel_->canSubmit());

        viewModel_->setEmail(QStringLiteral("user@aedst.dev"));
        QVERIFY(!viewModel_->canSubmit());

        viewModel_->setPassword(QStringLiteral("secret"));
        QVERIFY(viewModel_->canSubmit());
    }

    void loginIsIgnoredWhenFormIsIncomplete() {
        viewModel_->setEmail(QStringLiteral("user@aedst.dev"));

        viewModel_->login();

        QCOMPARE(repository_->loginCalls, 0);
    }

    void isLoadingIsTrueWhileRequestInFlight() {
        QSignalSpy loadingSpy(viewModel_.get(), &LoginViewModel::isLoadingChanged);
        viewModel_->setEmail(QStringLiteral(" user@aedst.dev "));
        viewModel_->setPassword(QStringLiteral("secret"));

        viewModel_->login();

        QVERIFY(viewModel_->isLoading());
        QVERIFY(!viewModel_->canSubmit());
        QVERIFY(repository_->lastCredentials.email == "user@aedst.dev");

        repository_->completeLogin(
            Session{.userId = "user-1", .accessToken = "a", .refreshToken = "r", .accessTokenExpiresAt = {}});

        QVERIFY(!viewModel_->isLoading());
        QCOMPARE(loadingSpy.count(), 2);
    }

    void successfulLoginEmitsLoginSucceededAndClearsPassword() {
        QSignalSpy succeeded(viewModel_.get(), &LoginViewModel::loginSucceeded);
        QSignalSpy failed(viewModel_.get(), &LoginViewModel::loginFailed);
        viewModel_->setEmail(QStringLiteral("user@aedst.dev"));
        viewModel_->setPassword(QStringLiteral("secret"));

        viewModel_->login();
        repository_->completeLogin(
            Session{.userId = "user-1", .accessToken = "a", .refreshToken = "r", .accessTokenExpiresAt = {}});

        QCOMPARE(succeeded.count(), 1);
        QCOMPARE(succeeded.takeFirst().at(0).toString(), QStringLiteral("user-1"));
        QCOMPARE(failed.count(), 0);
        QVERIFY(!viewModel_->hasPassword());
        QVERIFY(viewModel_->errorMessage().isEmpty());
    }

    void failedLoginExposesErrorMessageAndEmitsLoginFailed() {
        QSignalSpy failed(viewModel_.get(), &LoginViewModel::loginFailed);
        viewModel_->setEmail(QStringLiteral("user@aedst.dev"));
        viewModel_->setPassword(QStringLiteral("wrong"));

        viewModel_->login();
        repository_->completeLogin(core::fail(core::Error::unauthenticated("invalid credentials")));

        QCOMPARE(failed.count(), 1);
        QCOMPARE(viewModel_->errorMessage(),
                 QStringLiteral("Wrong e-mail or password.")); // by code, not the server text
        // Kept so the user can retry without retyping.
        QVERIFY(viewModel_->hasPassword());
        QVERIFY(!viewModel_->isLoading());

        viewModel_->login();
        QCOMPARE(repository_->loginCalls, 2);
        QVERIFY(repository_->lastCredentials.password.reveal() == "wrong");
    }

    void passwordPropertyIsWriteOnly() {
        QSignalSpy hasPasswordSpy(viewModel_.get(), &LoginViewModel::hasPasswordChanged);

        viewModel_->setPassword(QStringLiteral("secret"));

        QVERIFY(viewModel_->hasPassword());
        QVERIFY(LoginViewModel::password().isEmpty());
        QVERIFY(viewModel_->property("password").toString().isEmpty());
        QCOMPARE(hasPasswordSpy.count(), 1);

        viewModel_->setPassword(QStringLiteral("secret2")); // still has a password: no flip
        QCOMPARE(hasPasswordSpy.count(), 1);

        viewModel_->setPassword(QString());
        QVERIFY(!viewModel_->hasPassword());
        QCOMPARE(hasPasswordSpy.count(), 2);
    }

    void logoutClearsPassword() {
        viewModel_->setEmail(QStringLiteral("user@aedst.dev"));
        viewModel_->setPassword(QStringLiteral("secret"));
        QVERIFY(viewModel_->canSubmit());

        viewModel_->logout();

        QVERIFY(!viewModel_->hasPassword());
        QVERIFY(!viewModel_->canSubmit());
    }

    void clearPasswordIsIdempotent() {
        QSignalSpy hasPasswordSpy(viewModel_.get(), &LoginViewModel::hasPasswordChanged);
        viewModel_->clearPassword();
        QCOMPARE(hasPasswordSpy.count(), 0);

        viewModel_->setPassword(QStringLiteral("secret"));
        viewModel_->clearPassword();
        QVERIFY(!viewModel_->hasPassword());
        QCOMPARE(hasPasswordSpy.count(), 2);
    }

    void browserSignInIsUnavailableUntilAUseCaseIsInstalled() {
        QVERIFY(!viewModel_->browserSignInAvailable());
        viewModel_->signInWithBrowser();
        QCOMPARE(repository_->browserCalls, 0);

        QSignalSpy availability(viewModel_.get(), &LoginViewModel::browserSignInAvailableChanged);
        viewModel_->setBrowserSignIn(std::make_shared<BrowserSignInUseCase>(repository_));
        QVERIFY(viewModel_->browserSignInAvailable());
        QCOMPARE(availability.count(), 1);

        repository_->browserSupported = false; // e.g. first-party password mode
        QVERIFY(!viewModel_->browserSignInAvailable());
    }

    void browserSignInShowsWaitingStateAndSucceeds() {
        viewModel_->setBrowserSignIn(std::make_shared<BrowserSignInUseCase>(repository_));
        QSignalSpy succeeded(viewModel_.get(), &LoginViewModel::loginSucceeded);
        QSignalSpy waiting(viewModel_.get(), &LoginViewModel::waitingForBrowserChanged);

        viewModel_->signInWithBrowser();

        QCOMPARE(repository_->browserCalls, 1);
        QVERIFY(viewModel_->waitingForBrowser());
        QVERIFY(viewModel_->isLoading());

        repository_->completeBrowser(
            Session{.userId = "user-9", .accessToken = "a", .refreshToken = {}, .accessTokenExpiresAt = {}});

        QVERIFY(!viewModel_->waitingForBrowser());
        QVERIFY(!viewModel_->isLoading());
        QCOMPARE(waiting.count(), 2);
        QCOMPARE(succeeded.count(), 1);
        QCOMPARE(succeeded.takeFirst().at(0).toString(), QStringLiteral("user-9"));
        QVERIFY(viewModel_->errorMessage().isEmpty());
    }

    void secondBrowserSignInWhileOneRunsIsIgnored() {
        viewModel_->setBrowserSignIn(std::make_shared<BrowserSignInUseCase>(repository_));
        viewModel_->signInWithBrowser();
        viewModel_->signInWithBrowser();
        QCOMPARE(repository_->browserCalls, 1);
    }

    void cancellingTheBrowserStepIsSilent() {
        viewModel_->setBrowserSignIn(std::make_shared<BrowserSignInUseCase>(repository_));
        QSignalSpy failed(viewModel_.get(), &LoginViewModel::loginFailed);
        viewModel_->signInWithBrowser();

        viewModel_->cancelBrowserSignIn();

        QCOMPARE(repository_->cancelCalls, 1);
        QVERIFY(!viewModel_->waitingForBrowser());
        QVERIFY(!viewModel_->isLoading());
        QVERIFY(viewModel_->errorMessage().isEmpty());
        QCOMPARE(failed.count(), 0);
    }

    void cancelIsANoOpWhenNothingIsWaiting() {
        viewModel_->setBrowserSignIn(std::make_shared<BrowserSignInUseCase>(repository_));
        viewModel_->cancelBrowserSignIn();
        QCOMPARE(repository_->cancelCalls, 0);
    }

    void browserSignInFailureIsShown() {
        viewModel_->setBrowserSignIn(std::make_shared<BrowserSignInUseCase>(repository_));
        QSignalSpy failed(viewModel_.get(), &LoginViewModel::loginFailed);
        viewModel_->signInWithBrowser();

        repository_->completeBrowser(core::fail(core::Error::storage("Secure credential storage is unavailable")));

        QCOMPARE(failed.count(), 1);
        QCOMPARE(viewModel_->errorMessage(),
                 QStringLiteral("Your session could not be stored securely on this device."));
        QVERIFY(!viewModel_->isLoading());
        viewModel_->signInWithBrowser(); // the user can retry
        QCOMPARE(repository_->browserCalls, 2);
    }

    void restoringSessionFlagNotifiesOnlyOnChange() {
        QSignalSpy restoring(viewModel_.get(), &LoginViewModel::restoringSessionChanged);
        viewModel_->setRestoringSession(true);
        viewModel_->setRestoringSession(true);
        QVERIFY(viewModel_->restoringSession());
        viewModel_->setRestoringSession(false);
        QCOMPARE(restoring.count(), 2);
    }

    void logoutEmitsLoggedOut() {
        QSignalSpy loggedOut(viewModel_.get(), &LoginViewModel::loggedOut);

        viewModel_->logout();

        QCOMPARE(repository_->logoutCalls, 1);
        QCOMPARE(loggedOut.count(), 1);
    }
};

} // namespace aedst::feature::auth

QTEST_GUILESS_MAIN(aedst::feature::auth::LoginViewModelTest)
#include "login_view_model_test.moc"
