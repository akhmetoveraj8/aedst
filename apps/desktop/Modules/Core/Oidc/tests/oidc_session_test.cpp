#include "aedst/oidc/oidc_session.hpp"
#include "oidc_test_support.hpp"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QSignalSpy>
#include <QUrlQuery>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <optional>
#include <vector>

namespace aedst::oidc {
namespace {

using aedst::testing::waitUntil;
using testing::MockOidcProvider;

constexpr auto kLong = std::chrono::seconds{15};

/// Plays the user's browser: follows the authorization redirect chain that ends at the loopback
/// callback of the session under test.
class FakeBrowser {
public:
    bool open(const QUrl& url) {
        opened.push_back(url);
        if (!followRedirects) {
            return result;
        }
        QNetworkRequest request(url);
        request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
        QNetworkReply* reply = network.get(request);
        QObject::connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
        return result;
    }

    QNetworkAccessManager network;
    std::vector<QUrl> opened;
    bool followRedirects{true};
    bool result{true};
};

class OidcSessionTest : public ::testing::Test {
protected:
    void SetUp() override {
        ASSERT_TRUE(provider.isListening());
        store = std::make_shared<InMemoryRefreshTokenStore>();
        rebuild();
    }

    /// Creates the session under test (also used to simulate an application restart).
    void rebuild() {
        session.reset();
        OidcSession::Dependencies deps;
        deps.network = &network;
        deps.store = store;
        deps.openBrowser = [this](const QUrl& url) { return browser.open(url); };
        session = std::make_unique<OidcSession>(provider.config(), std::move(deps));
    }

    core::Outcome<OidcUser> signIn() {
        std::optional<core::Outcome<OidcUser>> result;
        session->signIn([&](core::Outcome<OidcUser> r) { result = std::move(r); });
        EXPECT_TRUE(waitUntil([&] { return result.has_value(); }, kLong));
        return result ? std::move(*result) : core::fail(core::Error::unknown("sign-in did not complete"));
    }

    core::Outcome<std::string> ensureFresh() {
        std::optional<core::Outcome<std::string>> result;
        session->ensureFreshAccessToken([&](core::Outcome<std::string> r) { result = std::move(r); });
        EXPECT_TRUE(waitUntil([&] { return result.has_value(); }, kLong));
        return result ? std::move(*result) : core::fail(core::Error::unknown("refresh did not complete"));
    }

    MockOidcProvider provider;
    QNetworkAccessManager network;
    FakeBrowser browser;
    std::shared_ptr<InMemoryRefreshTokenStore> store;
    std::unique_ptr<OidcSession> session;
};

TEST_F(OidcSessionTest, SignInUsesPkceS256AndStoresOnlyTheRefreshToken) {
    const auto user = signIn();
    ASSERT_TRUE(user.has_value()) << user.error().message;
    EXPECT_EQ(user->subject, "user-1");

    EXPECT_EQ(provider.lastChallengeMethod, QStringLiteral("S256"));
    EXPECT_TRUE(provider.pkceVerified) << "the token request must carry the verifier matching the challenge";
    for (const char* scope :
         {"openid", "profile", "email", "offline_access", "urn:zitadel:iam:org:project:id:proj-9:aud"}) {
        EXPECT_TRUE(provider.lastScope.contains(QString::fromLatin1(scope))) << scope;
    }

    EXPECT_TRUE(session->isSignedIn());
    EXPECT_EQ(session->accessToken().value_or(""), "access-1");
    EXPECT_TRUE(session->hasValidAccessToken());
    EXPECT_TRUE(store->hasIdentity());
    ASSERT_EQ(browser.opened.size(), 1U);
    const QString redirectUri = QUrlQuery(browser.opened.front()).queryItemValue("redirect_uri", QUrl::FullyDecoded);
    EXPECT_TRUE(redirectUri.startsWith(QStringLiteral("http://127.0.0.1:"))) << qPrintable(redirectUri);
    EXPECT_TRUE(redirectUri.endsWith(QStringLiteral("/callback"))) << qPrintable(redirectUri);
}

TEST_F(OidcSessionTest, RefreshTokenSurvivesARestartAndIsExchangedOnRestore) {
    ASSERT_TRUE(signIn().has_value());
    rebuild(); // new process: memory is gone, the keychain entry stays

    std::optional<core::Outcome<std::optional<OidcUser>>> restored;
    session->restore([&](core::Outcome<std::optional<OidcUser>> r) { restored = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return restored.has_value(); }, kLong));
    ASSERT_TRUE(restored->has_value()) << restored->error().message;
    ASSERT_TRUE((*restored)->has_value());
    EXPECT_EQ((**restored)->subject, "user-1");
    EXPECT_EQ(provider.refreshRequests, 1);
    EXPECT_TRUE(session->hasValidAccessToken());
    EXPECT_EQ(session->accessToken().value_or(""), "access-2");
}

TEST_F(OidcSessionTest, RestoreWithNothingStoredReportsSignedOut) {
    std::optional<core::Outcome<std::optional<OidcUser>>> restored;
    session->restore([&](core::Outcome<std::optional<OidcUser>> r) { restored = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return restored.has_value(); }));
    ASSERT_TRUE(restored->has_value());
    EXPECT_FALSE((*restored)->has_value());
    EXPECT_FALSE(session->isSignedIn());
    EXPECT_EQ(provider.tokenRequests, 0);
}

TEST_F(OidcSessionTest, ConcurrentCallersShareOneRefreshRequest) {
    provider.expiresIn = 1; // shorter than the refresh skew: every token is "expired" at once
    ASSERT_TRUE(signIn().has_value());
    ASSERT_FALSE(session->hasValidAccessToken());
    provider.expiresIn = 3600;

    constexpr int kCallers = 6;
    std::vector<std::optional<core::Outcome<std::string>>> results(kCallers);
    for (int i = 0; i < kCallers; ++i) {
        session->ensureFreshAccessToken(
            [&results, i](core::Outcome<std::string> r) { results[static_cast<std::size_t>(i)] = std::move(r); });
    }
    ASSERT_TRUE(waitUntil(
        [&] {
            for (const auto& r : results) {
                if (!r.has_value()) {
                    return false;
                }
            }
            return true;
        },
        kLong));

    EXPECT_EQ(provider.refreshRequests, 1) << "single flight: one network refresh for all callers";
    for (const auto& r : results) {
        ASSERT_TRUE(r->has_value());
        EXPECT_EQ(**r, "access-2");
    }
}

TEST_F(OidcSessionTest, RejectedStaleTokenIsReplacedOnlyOnce) {
    ASSERT_TRUE(signIn().has_value());
    const std::string stale = *session->accessToken();

    std::optional<core::Outcome<std::string>> first;
    std::optional<core::Outcome<std::string>> second;
    session->refreshAfterRejection(stale, [&](core::Outcome<std::string> r) { first = std::move(r); });
    session->refreshAfterRejection(stale, [&](core::Outcome<std::string> r) { second = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return first.has_value() && second.has_value(); }, kLong));
    EXPECT_EQ(provider.refreshRequests, 1);
    EXPECT_EQ(**first, "access-2");
    EXPECT_EQ(**second, "access-2");

    // A caller that still holds the old token after the refresh got its answer gets the new token
    // immediately, without another request.
    std::optional<core::Outcome<std::string>> third;
    session->refreshAfterRejection(stale, [&](core::Outcome<std::string> r) { third = std::move(r); });
    ASSERT_TRUE(third.has_value());
    EXPECT_EQ(**third, "access-2");
    EXPECT_EQ(provider.refreshRequests, 1);
}

TEST_F(OidcSessionTest, FreshTokenIsReturnedWithoutNetwork) {
    ASSERT_TRUE(signIn().has_value());
    const auto token = ensureFresh();
    ASSERT_TRUE(token.has_value());
    EXPECT_EQ(*token, "access-1");
    EXPECT_EQ(provider.refreshRequests, 0);
}

TEST_F(OidcSessionTest, RevokedRefreshTokenEndsTheSession) {
    provider.expiresIn = 1;
    ASSERT_TRUE(signIn().has_value());
    provider.refreshError = QStringLiteral("invalid_grant");

    QSignalSpy expired(session.get(), &OidcSession::sessionExpired);
    const auto token = ensureFresh();
    ASSERT_FALSE(token.has_value());
    EXPECT_EQ(token.error().code, core::ErrorCode::Unauthenticated);
    EXPECT_EQ(expired.count(), 1);
    EXPECT_FALSE(session->isSignedIn());
    EXPECT_FALSE(session->accessToken().has_value());
    ASSERT_TRUE(waitUntil([&] { return !store->hasIdentity(); }));
}

TEST_F(OidcSessionTest, NetworkFailureKeepsTheSessionForALaterRetry) {
    provider.expiresIn = 1;
    ASSERT_TRUE(signIn().has_value());
    provider.dropRefresh = true;

    QSignalSpy expired(session.get(), &OidcSession::sessionExpired);
    const auto token = ensureFresh();
    ASSERT_FALSE(token.has_value());
    EXPECT_EQ(token.error().code, core::ErrorCode::Unavailable);
    EXPECT_EQ(expired.count(), 0);
    EXPECT_TRUE(session->isSignedIn());
    EXPECT_TRUE(store->hasIdentity());

    provider.dropRefresh = false; // connectivity is back
    const auto retry = ensureFresh();
    ASSERT_TRUE(retry.has_value()) << retry.error().message;
}

TEST_F(OidcSessionTest, TemporaryServerErrorIsNotTreatedAsRevocation) {
    provider.expiresIn = 1;
    ASSERT_TRUE(signIn().has_value());
    provider.refreshError = QStringLiteral("temporarily_unavailable");
    const auto token = ensureFresh();
    ASSERT_FALSE(token.has_value());
    EXPECT_EQ(token.error().code, core::ErrorCode::Unavailable);
    EXPECT_TRUE(session->isSignedIn());
}

TEST_F(OidcSessionTest, RestoreOfflineKeepsTheStoredIdentity) {
    ASSERT_TRUE(signIn().has_value());
    rebuild();
    provider.dropRefresh = true;

    std::optional<core::Outcome<std::optional<OidcUser>>> restored;
    session->restore([&](core::Outcome<std::optional<OidcUser>> r) { restored = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return restored.has_value(); }, kLong));
    ASSERT_FALSE(restored->has_value());
    EXPECT_EQ(restored->error().code, core::ErrorCode::Unavailable);
    EXPECT_TRUE(session->isSignedIn()); // still "signed in"; requests will retry the refresh
    EXPECT_TRUE(store->hasIdentity());
}

TEST_F(OidcSessionTest, SignOutRevokesClearsTheKeychainAndEndsTheBrowserSession) {
    ASSERT_TRUE(signIn().has_value());
    browser.opened.clear();

    std::optional<core::VoidOutcome> done;
    session->signOut([&](core::VoidOutcome r) { done = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return done.has_value(); }));
    ASSERT_TRUE(done->has_value());

    EXPECT_FALSE(session->isSignedIn());
    EXPECT_FALSE(session->accessToken().has_value());
    EXPECT_FALSE(store->hasIdentity());

    ASSERT_TRUE(waitUntil([&] { return !provider.revocationBodies.empty() && !browser.opened.empty(); }));
    const QByteArray body = provider.revocationBodies.front();
    EXPECT_TRUE(body.contains("token=refresh-1"));
    EXPECT_TRUE(body.contains("token_type_hint=refresh_token"));
    EXPECT_TRUE(body.contains("client_id=client-1"));
    const QString endSession = browser.opened.front().toString();
    EXPECT_TRUE(endSession.contains(QStringLiteral("/oidc/v1/end_session")));
    EXPECT_TRUE(endSession.contains(QStringLiteral("id_token_hint=")));
    EXPECT_TRUE(endSession.contains(QStringLiteral("client_id=client-1")));
}

TEST_F(OidcSessionTest, SignOutCanSkipTheBrowserEndSession) {
    OidcConfig config = provider.config();
    config.endSessionInBrowser = false;
    OidcSession::Dependencies deps;
    deps.network = &network;
    deps.store = store;
    deps.openBrowser = [this](const QUrl& url) { return browser.open(url); };
    session = std::make_unique<OidcSession>(config, std::move(deps));

    ASSERT_TRUE(signIn().has_value());
    browser.opened.clear();
    std::optional<core::VoidOutcome> done;
    session->signOut([&](core::VoidOutcome r) { done = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return done.has_value() && !provider.revocationBodies.empty(); }));
    EXPECT_TRUE(browser.opened.empty());
}

TEST_F(OidcSessionTest, SignInFailsExplicitlyWhenTheKeychainIsUnavailableAndRevokesTheGrant) {
    store->setUnavailable(true);
    const auto user = signIn();
    ASSERT_FALSE(user.has_value());
    EXPECT_EQ(user.error().code, core::ErrorCode::Storage);
    EXPECT_FALSE(session->isSignedIn());
    EXPECT_FALSE(session->accessToken().has_value());
    ASSERT_TRUE(waitUntil([&] { return !provider.revocationBodies.empty(); }));
}

TEST_F(OidcSessionTest, SignInFailsWhenNoRefreshTokenIsIssued) {
    provider.omitRefreshToken = true;
    const auto user = signIn();
    ASSERT_FALSE(user.has_value());
    EXPECT_NE(user.error().message.find("refresh"), std::string::npos);
    EXPECT_FALSE(store->hasIdentity());
}

TEST_F(OidcSessionTest, SignInRejectsAnIdTokenFromAnotherIssuer) {
    provider.idTokenIssuer = QStringLiteral("https://evil.example.com");
    const auto user = signIn();
    ASSERT_FALSE(user.has_value());
    EXPECT_EQ(user.error().code, core::ErrorCode::Unauthenticated);
    EXPECT_FALSE(session->isSignedIn());
    EXPECT_FALSE(store->hasIdentity());
}

TEST_F(OidcSessionTest, SignInSendsANonceAndAcceptsTheEchoedOne) {
    const auto user = signIn();
    ASSERT_TRUE(user.has_value()) << user.error().message;
    EXPECT_GE(provider.lastNonce.size(), 32) << "a high-entropy nonce goes out with the authorization request";
}

TEST_F(OidcSessionTest, SignInRejectsAnIdTokenWithAnotherNonce) {
    provider.nonceOverride = QStringLiteral("replayed-nonce");
    const auto user = signIn();
    ASSERT_FALSE(user.has_value());
    EXPECT_EQ(user.error().code, core::ErrorCode::Unauthenticated);
    EXPECT_NE(user.error().message.find("nonce"), std::string::npos);
    EXPECT_FALSE(session->isSignedIn());
    EXPECT_FALSE(store->hasIdentity());
}

TEST_F(OidcSessionTest, SignInRejectsAnIdTokenWithoutTheNonceClaim) {
    provider.echoNonce = false;
    const auto user = signIn();
    ASSERT_FALSE(user.has_value());
    EXPECT_EQ(user.error().code, core::ErrorCode::Unauthenticated);
    EXPECT_FALSE(session->isSignedIn());
}

TEST_F(OidcSessionTest, SignInFailsWhenTheBrowserCannotBeOpened) {
    browser.followRedirects = false;
    browser.result = false;
    const auto user = signIn();
    ASSERT_FALSE(user.has_value());
    EXPECT_NE(user.error().message.find("browser"), std::string::npos);
    EXPECT_FALSE(session->signInInProgress());
}

TEST_F(OidcSessionTest, CancelSignInWhileWaitingForTheBrowser) {
    browser.followRedirects = false; // the user never finishes
    std::optional<core::Outcome<OidcUser>> result;
    session->signIn([&](core::Outcome<OidcUser> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return !browser.opened.empty(); }));
    EXPECT_TRUE(session->signInInProgress());

    session->cancelSignIn();
    ASSERT_TRUE(result.has_value());
    ASSERT_FALSE(result->has_value());
    EXPECT_EQ(result->error().code, core::ErrorCode::Cancelled);
    EXPECT_FALSE(session->signInInProgress());
    EXPECT_FALSE(session->isSignedIn());
}

TEST_F(OidcSessionTest, SecondSignInWhileOneIsRunningIsRefused) {
    browser.followRedirects = false;
    session->signIn([](core::Outcome<OidcUser>) {});
    std::optional<core::Outcome<OidcUser>> second;
    session->signIn([&](core::Outcome<OidcUser> r) { second = std::move(r); });
    ASSERT_TRUE(second.has_value());
    EXPECT_FALSE(second->has_value());
    session->cancelSignIn();
}

TEST_F(OidcSessionTest, UnreachableProviderIsANetworkError) {
    OidcConfig config = provider.config();
    config.issuer = QUrl(QStringLiteral("http://127.0.0.1:1")); // nothing listens on port 1
    OidcSession::Dependencies deps;
    deps.network = &network;
    deps.store = store;
    deps.openBrowser = [this](const QUrl& url) { return browser.open(url); };
    session = std::make_unique<OidcSession>(config, std::move(deps));

    const auto user = signIn();
    ASSERT_FALSE(user.has_value());
    EXPECT_EQ(user.error().code, core::ErrorCode::Unavailable);
}

TEST_F(OidcSessionTest, SignOutDuringARefreshDoesNotResurrectTheSession) {
    provider.expiresIn = 1;
    ASSERT_TRUE(signIn().has_value());

    std::optional<core::Outcome<std::string>> pending;
    session->ensureFreshAccessToken([&](core::Outcome<std::string> r) { pending = std::move(r); });
    std::optional<core::VoidOutcome> done;
    session->signOut([&](core::VoidOutcome r) { done = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return done.has_value() && pending.has_value(); }, kLong));
    ASSERT_FALSE(pending->has_value());
    EXPECT_EQ(pending->error().code, core::ErrorCode::Unauthenticated);

    // Give a late token response every chance to arrive; the session must stay signed out.
    waitUntil([] { return false; }, std::chrono::milliseconds{300});
    EXPECT_FALSE(session->isSignedIn());
    EXPECT_FALSE(session->accessToken().has_value());
}

TEST_F(OidcSessionTest, EnsureFreshWhenSignedOutIsUnauthenticated) {
    const auto token = ensureFresh();
    ASSERT_FALSE(token.has_value());
    EXPECT_EQ(token.error().code, core::ErrorCode::Unauthenticated);
}

} // namespace
} // namespace aedst::oidc
