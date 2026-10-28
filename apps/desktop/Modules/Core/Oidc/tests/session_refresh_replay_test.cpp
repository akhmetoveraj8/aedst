#include "aedst/contract/methods.hpp"
#include "aedst/network/auth_interceptor.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/oidc/oidc_session.hpp"
#include "aedst/oidc/refresh_token_store.hpp"
#include "aedst/testing/behavior_fixture.hpp"
#include "oidc_test_support.hpp"

#include <QJsonArray>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

// Replays docs/contract/behavior/session-refresh.json against the real stack: OidcSession (single-flight refresh,
// invalid_grant handling) behind AuthInterceptor, inside ConnectClient, talking to a scripted loopback identity
// provider and a scripted loopback API. Only the two servers are scripted; the 401 -> refresh -> replay logic is
// production code.

namespace aedst::oidc {
namespace {

using aedst::testing::FakeHttpServer;
using aedst::testing::FakeResponse;
using aedst::testing::waitUntil;
using testing::MockOidcProvider;
namespace tasksv1 = ::aedst::tasks::v1;

constexpr auto kLong = std::chrono::seconds{15};

/// Plays the user's browser: follows the authorization redirect chain back to the session's loopback callback.
struct Browser {
    bool open(const QUrl& url) {
        QNetworkRequest request(url);
        request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
        QNetworkReply* reply = network.get(request);
        QObject::connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
        return true;
    }

    QNetworkAccessManager network;
};

/// The id of a request travels in the (otherwise unused) title of a CreateTask message; the scripted API answers
/// the n-th hit of an id with the n-th status the fixture lists for it.
class ScriptedApi {
public:
    void script(const std::string& id, std::vector<int> statuses) { statuses_[id] = std::move(statuses); }

    FakeResponse answer(const aedst::testing::RecordedRequest& request) {
        tasksv1::CreateTaskRequest message;
        if (!message.ParseFromArray(request.body.constData(), static_cast<int>(request.body.size()))) {
            return FakeResponse::connectError(400, "invalid_argument", "unparsable request");
        }
        const std::string id = message.title();
        const int hit = hits_[id]++;
        const auto& statuses = statuses_[id];
        const int status = hit < static_cast<int>(statuses.size()) ? statuses[static_cast<std::size_t>(hit)] : 500;
        if (status == 401) {
            return FakeResponse::connectError(401, "unauthenticated", "token expired");
        }
        if (status == 200) {
            return FakeResponse::proto({});
        }
        return FakeResponse::connectError(500, "internal", "unscripted status");
    }

    [[nodiscard]] int hits(const std::string& id) { return hits_[id]; }

private:
    std::map<std::string, std::vector<int>> statuses_;
    std::map<std::string, int> hits_;
};

std::string describe(const std::optional<network::ApiResult<tasksv1::CreateTaskResponse>>& result) {
    if (!result->has_value()) {
        const network::ApiError& error = result->error();
        if (error.kind == network::ApiErrorKind::Unauthenticated) {
            return "unauthenticated";
        }
        return error.isRetryable() ? "retryable_error" : "other_error:" + error.connectCode;
    }
    return "ok";
}

TEST(SessionRefreshFixtureTest, ReplaysEveryCase) {
    const QJsonObject fixture = aedst::testing::loadBehaviorFixture("session-refresh");
    const QJsonArray cases = fixture.value("cases").toArray();
    ASSERT_FALSE(cases.isEmpty());

    for (const QJsonValue& entry : cases) {
        const QJsonObject c = entry.toObject();
        SCOPED_TRACE(c.value("id").toString().toStdString());

        // Identity provider + a signed-in session (the access token stays valid: no pre-flight refresh).
        MockOidcProvider provider;
        ASSERT_TRUE(provider.isListening());
        QNetworkAccessManager network;
        Browser browser;
        OidcSession::Dependencies deps;
        deps.network = &network;
        deps.store = std::make_shared<InMemoryRefreshTokenStore>();
        deps.openBrowser = [&browser](const QUrl& url) { return browser.open(url); };
        auto session = std::make_shared<OidcSession>(provider.config(), std::move(deps));
        std::optional<core::Outcome<OidcUser>> signedIn;
        session->signIn([&](core::Outcome<OidcUser> r) { signedIn = std::move(r); });
        ASSERT_TRUE(waitUntil([&] { return signedIn.has_value(); }, kLong));
        ASSERT_TRUE(signedIn->has_value()) << signedIn->error().message;
        ASSERT_EQ(provider.refreshRequests, 0);

        // What the identity provider answers when the session asks for a new access token.
        const QJsonArray refresh = c.value("refresh").toArray();
        if (!refresh.isEmpty()) {
            const QString outcome = refresh.first().toString();
            if (outcome == QLatin1String("invalid_grant")) {
                provider.refreshError = QStringLiteral("invalid_grant");
            } else if (outcome == QLatin1String("transient")) {
                provider.refreshError = QStringLiteral("temporarily_unavailable");
            } else {
                ASSERT_EQ(outcome, QStringLiteral("ok"));
            }
        }

        // The API, scripted per request id.
        ScriptedApi api;
        FakeHttpServer apiServer;
        ASSERT_TRUE(apiServer.isListening());
        apiServer.setHandler([&api](const aedst::testing::RecordedRequest& request) { return api.answer(request); });
        const QJsonArray requests = c.value("requests").toArray();
        for (const QJsonValue& requestValue : requests) {
            const QJsonObject request = requestValue.toObject();
            std::vector<int> statuses;
            for (const QJsonValue& status : request.value("server").toArray()) {
                statuses.push_back(status.toInt());
            }
            api.script(request.value("id").toString().toStdString(), std::move(statuses));
        }

        network::ConnectClient client(network::ClientConfig{.baseUrl = apiServer.baseUrl(),
                                                            .defaultTimeout = std::chrono::seconds{10},
                                                            .allowInsecureLoopback = true},
                                      std::make_shared<network::AuthInterceptor>(session, session));

        // All requests start together, so concurrent 401s really overlap.
        std::map<std::string, std::optional<network::ApiResult<tasksv1::CreateTaskResponse>>> results;
        for (const QJsonValue& requestValue : requests) {
            const std::string id = requestValue.toObject().value("id").toString().toStdString();
            tasksv1::CreateTaskRequest message;
            message.set_title(id);
            results[id] = std::nullopt;
            client.unary(
                contract::kTasksCreateTask, message,
                [&results, id](network::ApiResult<tasksv1::CreateTaskResponse> r) { results[id] = std::move(r); });
        }
        ASSERT_TRUE(waitUntil(
            [&] {
                for (const auto& [id, result] : results) {
                    if (!result.has_value()) {
                        return false;
                    }
                }
                return true;
            },
            kLong));

        const QJsonObject expect = c.value("expect").toObject();
        EXPECT_EQ(provider.refreshRequests, expect.value("refreshCalls").toInt());
        EXPECT_EQ(std::string(session->isSignedIn() ? "signed_in" : "signed_out"),
                  expect.value("session").toString().toStdString());
        const QJsonObject expectedResults = expect.value("results").toObject();
        const QJsonObject expectedReplays = expect.value("replays").toObject();
        for (const QJsonValue& requestValue : requests) {
            const std::string id = requestValue.toObject().value("id").toString().toStdString();
            const QString key = QString::fromStdString(id);
            EXPECT_EQ(describe(results[id]), expectedResults.value(key).toString().toStdString()) << id;
            // A replay is any hit beyond the first.
            EXPECT_EQ(std::max(api.hits(id) - 1, 0), expectedReplays.value(key).toInt()) << id;
        }
    }
}

} // namespace
} // namespace aedst::oidc
