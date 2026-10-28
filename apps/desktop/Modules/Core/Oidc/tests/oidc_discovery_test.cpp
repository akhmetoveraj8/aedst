#include "aedst/oidc/oidc_discovery.hpp"
#include "aedst/testing/fake_http_server.hpp"

#include <QNetworkAccessManager>

#include <gtest/gtest.h>

#include <optional>

namespace aedst::oidc {
namespace {

using aedst::testing::FakeHttpServer;
using aedst::testing::FakeResponse;
using aedst::testing::waitUntil;

OidcConfig config() {
    OidcConfig value;
    value.issuer = QUrl(QStringLiteral("https://id.example.com"));
    value.clientId = QStringLiteral("client-1");
    return value;
}

QByteArray document(const QString& issuer = QStringLiteral("https://id.example.com")) {
    return QByteArray(R"({
      "issuer": ")" + issuer.toUtf8() +
                      R"(",
      "authorization_endpoint": "https://id.example.com/oauth/v2/authorize",
      "token_endpoint": "https://id.example.com/oauth/v2/token",
      "revocation_endpoint": "https://id.example.com/oauth/v2/revoke",
      "end_session_endpoint": "https://id.example.com/oidc/v1/end_session",
      "code_challenge_methods_supported": ["plain", "S256"]
    })");
}

TEST(OidcDiscoveryTest, DiscoveryUrlAppendsWellKnownPath) {
    EXPECT_EQ(discoveryUrl(QUrl(QStringLiteral("https://id.example.com"))).toString(),
              QStringLiteral("https://id.example.com/.well-known/openid-configuration"));
    EXPECT_EQ(discoveryUrl(QUrl(QStringLiteral("https://id.example.com/tenant/"))).toString(),
              QStringLiteral("https://id.example.com/tenant/.well-known/openid-configuration"));
}

TEST(OidcDiscoveryTest, ParsesAllEndpoints) {
    const auto endpoints = parseDiscoveryDocument(document(), config());
    ASSERT_TRUE(endpoints.has_value()) << endpoints.error().message;
    EXPECT_EQ(endpoints->authorization.toString(), QStringLiteral("https://id.example.com/oauth/v2/authorize"));
    EXPECT_EQ(endpoints->token.toString(), QStringLiteral("https://id.example.com/oauth/v2/token"));
    EXPECT_EQ(endpoints->revocation.toString(), QStringLiteral("https://id.example.com/oauth/v2/revoke"));
    EXPECT_EQ(endpoints->endSession.toString(), QStringLiteral("https://id.example.com/oidc/v1/end_session"));
}

TEST(OidcDiscoveryTest, IssuerWithTrailingSlashStillMatches) {
    EXPECT_TRUE(parseDiscoveryDocument(document(QStringLiteral("https://id.example.com/")), config()).has_value());
}

TEST(OidcDiscoveryTest, IssuerMismatchIsRejected) {
    const auto endpoints = parseDiscoveryDocument(document(QStringLiteral("https://evil.example.com")), config());
    ASSERT_FALSE(endpoints.has_value());
    EXPECT_EQ(endpoints.error().code, core::ErrorCode::InvalidInput);
}

TEST(OidcDiscoveryTest, MissingRequiredEndpointIsRejected) {
    EXPECT_FALSE(parseDiscoveryDocument(
                     R"({"issuer":"https://id.example.com","token_endpoint":"https://id.example.com/t"})", config())
                     .has_value());
    EXPECT_FALSE(
        parseDiscoveryDocument(
            R"({"issuer":"https://id.example.com","authorization_endpoint":"https://id.example.com/a"})", config())
            .has_value());
}

TEST(OidcDiscoveryTest, OptionalEndpointsMayBeAbsent) {
    const auto endpoints = parseDiscoveryDocument(
        R"({"issuer":"https://id.example.com","authorization_endpoint":"https://id.example.com/a","token_endpoint":"https://id.example.com/t"})",
        config());
    ASSERT_TRUE(endpoints.has_value());
    EXPECT_TRUE(endpoints->revocation.isEmpty());
    EXPECT_TRUE(endpoints->endSession.isEmpty());
}

TEST(OidcDiscoveryTest, PlainHttpEndpointsAreRejected) {
    const auto endpoints = parseDiscoveryDocument(
        R"({"issuer":"https://id.example.com","authorization_endpoint":"http://id.example.com/a","token_endpoint":"https://id.example.com/t"})",
        config());
    EXPECT_FALSE(endpoints.has_value());
}

TEST(OidcDiscoveryTest, ProviderWithoutS256IsRejectedWhenItListsMethods) {
    const auto endpoints = parseDiscoveryDocument(
        R"({"issuer":"https://id.example.com","authorization_endpoint":"https://id.example.com/a","token_endpoint":"https://id.example.com/t","code_challenge_methods_supported":["plain"]})",
        config());
    ASSERT_FALSE(endpoints.has_value());
    EXPECT_NE(endpoints.error().message.find("S256"), std::string::npos);
}

TEST(OidcDiscoveryTest, GarbageIsRejected) {
    EXPECT_FALSE(parseDiscoveryDocument("not json", config()).has_value());
    EXPECT_FALSE(parseDiscoveryDocument("[1,2]", config()).has_value());
}

TEST(OidcDiscoveryTest, FetchesFromALoopbackProvider) {
    FakeHttpServer server;
    ASSERT_TRUE(server.isListening());
    OidcConfig local = config();
    local.issuer = server.baseUrl();
    local.allowInsecureLoopbackIssuer = true;
    const QString base = server.baseUrl().toString();
    server.enqueue(FakeResponse::json(("{\"issuer\":\"" + base + "\",\"authorization_endpoint\":\"" + base +
                                       "/a\",\"token_endpoint\":\"" + base + "/t\"}")
                                          .toUtf8()));

    QNetworkAccessManager network;
    std::optional<core::Outcome<OidcEndpoints>> result;
    fetchDiscovery(network, local, [&](core::Outcome<OidcEndpoints> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));
    ASSERT_TRUE(result->has_value()) << result->error().message;
    ASSERT_EQ(server.requests().size(), 1U);
    EXPECT_EQ(server.requests().front().target, QByteArray("/.well-known/openid-configuration"));
}

TEST(OidcDiscoveryTest, FetchReportsHttpFailureAsNetworkError) {
    FakeHttpServer server;
    OidcConfig local = config();
    local.issuer = server.baseUrl();
    local.allowInsecureLoopbackIssuer = true;
    server.enqueue(FakeResponse::json("{}", 503));

    QNetworkAccessManager network;
    std::optional<core::Outcome<OidcEndpoints>> result;
    fetchDiscovery(network, local, [&](core::Outcome<OidcEndpoints> r) { result = std::move(r); });
    ASSERT_TRUE(waitUntil([&] { return result.has_value(); }));
    ASSERT_FALSE(result->has_value());
    EXPECT_EQ(result->error().code, core::ErrorCode::Unavailable);
}

TEST(OidcDiscoveryTest, FetchRejectsAnInvalidConfigBeforeTouchingTheNetwork) {
    QNetworkAccessManager network;
    OidcConfig invalid = config();
    invalid.clientId.clear();
    std::optional<core::Outcome<OidcEndpoints>> result;
    fetchDiscovery(network, invalid, [&](core::Outcome<OidcEndpoints> r) { result = std::move(r); });
    ASSERT_TRUE(result.has_value()); // synchronous: no request was made
    EXPECT_FALSE(result->has_value());
}

} // namespace
} // namespace aedst::oidc
