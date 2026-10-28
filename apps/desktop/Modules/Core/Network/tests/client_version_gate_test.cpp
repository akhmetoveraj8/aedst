#include "aedst/testing/behavior_fixture.hpp"
#include "connect_client_test_support.hpp"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>

#include <gtest/gtest.h>

#include <memory>
#include <optional>
#include <string>

// Replays docs/contract/behavior/client-version-gate.json against the real ConnectClient: the header value of
// each case goes through ClientConfig::clientIdentifier onto the wire, the loopback server plays the Go gate
// (apps/server/internal/platform/httpserver/clientversion.go) as the fixture's rules describe it, and the client
// must turn the rejection into the typed upgrade-required error and its signal ("ui": "upgrade_screen").

namespace aedst::network {
namespace {

using namespace testsupport;

struct Version {
    int parts[3]{};
};

/// "x.y.z" only; anything else (including "garbage" and prerelease suffixes) is unparsable, hence allowed.
std::optional<Version> parseVersion(const QString& text) {
    const QStringList pieces = text.split(QLatin1Char('.'));
    if (pieces.size() != 3) {
        return std::nullopt;
    }
    Version version;
    for (int i = 0; i < 3; ++i) {
        bool ok = false;
        const int value = pieces.at(i).toInt(&ok);
        if (!ok || value < 0 || pieces.at(i).startsWith(QLatin1Char('+'))) {
            return std::nullopt;
        }
        version.parts[i] = value;
    }
    return version;
}

bool lessThan(const Version& a, const Version& b) {
    for (int i = 0; i < 3; ++i) {
        if (a.parts[i] != b.parts[i]) {
            return a.parts[i] < b.parts[i];
        }
    }
    return false;
}

/// The gate as the fixture states it: health endpoints are never gated; a missing or unparsable header, an
/// unknown platform or a platform without a minimum are allowed; otherwise numeric version < minimum is rejected.
bool gateAllows(const QJsonObject& minVersions, const QByteArray& header, const QByteArray& target) {
    if (target == "/livez" || target == "/readyz") {
        return true;
    }
    const QString text = QString::fromLatin1(header);
    const qsizetype slash = text.indexOf(QLatin1Char('/'));
    if (slash <= 0) {
        return true;
    }
    const QString platform = text.left(slash);
    const auto have = parseVersion(text.mid(slash + 1));
    const auto minimum = parseVersion(minVersions.value(platform).toString());
    return !have || !minimum || !lessThan(*have, *minimum);
}

/// What connect-go sends for the gate's error: HTTP 400, JSON body with a google.rpc.ErrorInfo detail.
FakeResponse upgradeRequiredResponse(bool withDebug) {
    const QByteArray reason = "CLIENT_UPGRADE_REQUIRED";
    QByteArray proto;
    proto.append('\x0a').append(static_cast<char>(reason.size())).append(reason);
    proto.append('\x12').append('\x05').append("aedst");
    QJsonObject detail{
        {"type", "google.rpc.ErrorInfo"},
        {"value", QString::fromLatin1(proto.toBase64(QByteArray::Base64Encoding | QByteArray::OmitTrailingEquals))}};
    if (withDebug) {
        detail.insert("debug", QJsonObject{{"reason", QString::fromLatin1(reason)}, {"domain", "aedst"}});
    }
    const QJsonObject body{{"code", "failed_precondition"},
                           {"message", "this version of the app is no longer supported"},
                           {"details", QJsonArray{detail}}};
    FakeResponse response;
    response.status = 400;
    response.contentType = "application/json";
    response.body = QJsonDocument(body).toJson(QJsonDocument::Compact);
    return response;
}

class ClientVersionGateTest : public ::testing::Test {
protected:
    void SetUp() override { ASSERT_TRUE(server_.isListening()); }

    FakeHttpServer server_;
};

TEST_F(ClientVersionGateTest, ReplaysEveryFixtureCase) {
    const QJsonObject fixture = aedst::testing::loadBehaviorFixture("client-version-gate");
    const QJsonObject minVersions = fixture.value("minVersions").toObject();
    const QJsonArray cases = fixture.value("cases").toArray();
    ASSERT_FALSE(cases.isEmpty());

    // Both renderings of the detail must be understood: with connect-go's `debug` object and with only `value`.
    for (const bool withDebug : {true, false}) {
        server_.setHandler([&](const aedst::testing::RecordedRequest& request) {
            return gateAllows(minVersions, request.headers.value("x-aedst-client"), request.target)
                       ? FakeResponse::proto({})
                       : upgradeRequiredResponse(withDebug);
        });

        for (const QJsonValue& entry : cases) {
            const QJsonObject c = entry.toObject();
            const QString id = c.value("id").toString();
            SCOPED_TRACE(id.toStdString() + (withDebug ? " (debug)" : " (value only)"));
            const QJsonValue header = c.value("header");
            const std::string path = c.value("path").toString().toStdString();
            const QJsonObject expect = c.value("expect").toObject();

            ConnectClient client(
                ClientConfig{.baseUrl = server_.baseUrl(),
                             .defaultTimeout = 2s,
                             .allowInsecureLoopback = true,
                             .clientIdentifier = header.isString() ? header.toString().toStdString() : std::string{}},
                nullptr);
            QSignalSpy upgradeSignal(&client, &ConnectClient::clientUpgradeRequired);
            const std::size_t before = server_.requests().size();
            std::optional<RawResult> result;
            client.unaryRaw(MethodInfo{.path = path, .auth = AuthRequirement::Public}, QByteArray{}, CallOptions{},
                            [&result](RawResult r) { result = std::move(r); });
            ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));

            // The client put exactly the configured header on the wire (or none for `null`).
            ASSERT_EQ(server_.requests().size(), before + 1);
            const auto& sent = server_.requests().back();
            if (header.isString()) {
                EXPECT_EQ(sent.headers.value("x-aedst-client"), header.toString().toLatin1());
            } else {
                EXPECT_FALSE(sent.headers.contains("x-aedst-client"));
            }

            if (expect.value("allowed").toBool()) {
                EXPECT_TRUE(result->has_value());
                EXPECT_EQ(upgradeSignal.count(), 0);
                continue;
            }
            ASSERT_FALSE(result->has_value());
            const ApiError& error = result->error();
            EXPECT_EQ(error.connectCode, expect.value("code").toString().toStdString());
            EXPECT_EQ(error.reason, expect.value("reason").toString().toStdString());
            EXPECT_TRUE(error.isUpgradeRequired());
            EXPECT_EQ(upgradeSignal.count(), 1);
            // "ui": "upgrade_screen" <=> the typed error the app routes on.
            ASSERT_EQ(expect.value("ui").toString(), QStringLiteral("upgrade_screen"));
            EXPECT_EQ(error.toCoreError().code, core::ErrorCode::UpgradeRequired);
        }
    }
}

TEST_F(ClientVersionGateTest, AnOrdinaryFailedPreconditionIsNotAnUpgradeRequest) {
    server_.enqueue(FakeResponse::connectError(400, "failed_precondition", "task is already done"));
    ConnectClient client(
        ClientConfig{.baseUrl = server_.baseUrl(), .defaultTimeout = 2s, .allowInsecureLoopback = true}, nullptr);
    QSignalSpy upgradeSignal(&client, &ConnectClient::clientUpgradeRequired);
    std::optional<RawResult> result;

    client.unaryRaw(MethodInfo{.path = "/aedst.tasks.v1.TasksService/CompleteTask", .auth = AuthRequirement::Public},
                    QByteArray{}, CallOptions{}, [&result](RawResult r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));

    ASSERT_FALSE(result->has_value());
    EXPECT_FALSE(result->error().isUpgradeRequired());
    EXPECT_EQ(result->error().toCoreError().code, core::ErrorCode::InvalidInput);
    EXPECT_EQ(upgradeSignal.count(), 0);
}

} // namespace
} // namespace aedst::network
