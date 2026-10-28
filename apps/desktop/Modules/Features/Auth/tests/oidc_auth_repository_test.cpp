#include "Data/oidc_auth_repository.hpp"
#include "Domain/browser_sign_in_use_case.hpp"
#include "aedst/oidc/oidc_session.hpp"
#include "aedst/testing/test_main.hpp"
#include "oidc_test_support.hpp" // scripted OpenID provider shared with the Aedst::Oidc tests

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>

#include <gtest/gtest.h>

#include <memory>
#include <optional>

namespace aedst::feature::auth {
namespace {

using aedst::testing::waitUntil;

class OidcAuthRepositoryTest : public ::testing::Test {
protected:
    void SetUp() override {
        ASSERT_TRUE(provider.isListening());
        store = std::make_shared<oidc::InMemoryRefreshTokenStore>();
        oidc::OidcSession::Dependencies deps;
        deps.network = &network;
        deps.store = store;
        // The "browser" follows the authorization redirect straight back to the loopback callback.
        deps.openBrowser = [this](const QUrl& url) {
            QNetworkRequest request(url);
            request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
            QNetworkReply* reply = browser.get(request);
            QObject::connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
            return true;
        };
        session = std::make_shared<oidc::OidcSession>(provider.config(), std::move(deps));
        repository = std::make_shared<OidcAuthRepository>(session);
    }

    core::Outcome<Session> signIn() {
        std::optional<core::Outcome<Session>> result;
        repository->signInWithBrowser([&](core::Outcome<Session> r) { result = std::move(r); });
        EXPECT_TRUE(waitUntil([&] { return result.has_value(); }, std::chrono::seconds{15}));
        return result ? std::move(*result) : core::fail(core::Error::unknown("sign-in did not complete"));
    }

    oidc::testing::MockOidcProvider provider;
    QNetworkAccessManager network;
    QNetworkAccessManager browser;
    std::shared_ptr<oidc::InMemoryRefreshTokenStore> store;
    std::shared_ptr<oidc::OidcSession> session;
    std::shared_ptr<OidcAuthRepository> repository;
};

TEST_F(OidcAuthRepositoryTest, SignedOutByDefault) {
    EXPECT_FALSE(repository->currentSession().has_value());
    EXPECT_TRUE(repository->supportsBrowserSignIn());
}

TEST_F(OidcAuthRepositoryTest, PasswordLoginIsRefused) {
    std::optional<core::Outcome<Session>> result;
    repository->login(Credentials{.email = "a@b.c", .password = core::SecretString("pw")},
                      [&](core::Outcome<Session> r) { result = std::move(r); });
    ASSERT_TRUE(result.has_value());
    ASSERT_FALSE(result->has_value());
    EXPECT_EQ(result->error().code, core::ErrorCode::InvalidInput);
}

TEST_F(OidcAuthRepositoryTest, BrowserSignInYieldsASessionWithoutExposingTheRefreshToken) {
    const auto signedIn = signIn();
    ASSERT_TRUE(signedIn.has_value()) << signedIn.error().message;
    EXPECT_EQ(signedIn->userId, "user-1");
    EXPECT_EQ(signedIn->accessToken.reveal(), "access-1");
    EXPECT_TRUE(signedIn->refreshToken.empty());
    EXPECT_FALSE(signedIn->isAccessTokenExpired(std::chrono::system_clock::now()));

    const auto current = repository->currentSession();
    ASSERT_TRUE(current.has_value());
    EXPECT_EQ(current->userId, "user-1");
}

TEST_F(OidcAuthRepositoryTest, RefreshReturnsTheCurrentSession) {
    provider.expiresIn = 1;
    ASSERT_TRUE(signIn().has_value());
    ASSERT_TRUE(
        repository->currentSession()->isAccessTokenExpired(std::chrono::system_clock::now() + std::chrono::seconds{2}));

    std::optional<core::Outcome<Session>> refreshed;
    repository->refreshToken([&](core::Outcome<Session> r) { refreshed = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return refreshed.has_value(); }, std::chrono::seconds{15}));
    ASSERT_TRUE(refreshed->has_value()) << refreshed->error().message;
    EXPECT_EQ((*refreshed)->accessToken.reveal(), "access-2");
}

TEST_F(OidcAuthRepositoryTest, LogoutEndsTheSession) {
    ASSERT_TRUE(signIn().has_value());
    std::optional<core::VoidOutcome> done;
    repository->logout([&](core::VoidOutcome r) { done = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return done.has_value(); }));
    ASSERT_TRUE(done->has_value());
    EXPECT_FALSE(repository->currentSession().has_value());
    EXPECT_FALSE(store->hasIdentity());
}

TEST_F(OidcAuthRepositoryTest, BrowserSignInUseCaseDelegatesToTheRepository) {
    BrowserSignInUseCase useCase(repository);
    EXPECT_TRUE(useCase.isAvailable());

    std::optional<core::Outcome<Session>> result;
    useCase.execute(core::NoInput{}, [&](core::Outcome<Session> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }, std::chrono::seconds{15}));
    ASSERT_TRUE(result->has_value()) << result->error().message;
    EXPECT_EQ((*result)->userId, "user-1");
}

TEST(BrowserSignInUseCaseTest, FailsWhenTheRepositoryHasNoBrowserSupport) {
    class PasswordOnlyRepository final : public AuthRepository {
    public:
        void login(const Credentials&, core::Completion<Session> done) override {
            done(core::fail(core::Error::unknown("unused")));
        }

        void refreshToken(core::Completion<Session> done) override { done(core::fail(core::Error::unknown("unused"))); }

        void logout(core::Completion<void> done) override { done(core::ok()); }

        [[nodiscard]] std::optional<Session> currentSession() const override { return std::nullopt; }
    };

    BrowserSignInUseCase useCase(std::make_shared<PasswordOnlyRepository>());
    EXPECT_FALSE(useCase.isAvailable());
    std::optional<core::Outcome<Session>> result;
    useCase.execute(core::NoInput{}, [&](core::Outcome<Session> r) { result = std::move(r); });
    ASSERT_TRUE(result.has_value());
    ASSERT_FALSE(result->has_value());
    EXPECT_EQ(result->error().code, core::ErrorCode::InvalidInput);
}

} // namespace
} // namespace aedst::feature::auth

AEDST_GTEST_MAIN_WITH_QCOREAPPLICATION()
