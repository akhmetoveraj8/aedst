#include "aedst/oidc/id_token_claims.hpp"
#include "oidc_test_support.hpp"

#include <gtest/gtest.h>

namespace aedst::oidc {
namespace {

using testing::makeJwt;
using testing::nowSeconds;
using testing::validIdTokenClaims;

OidcConfig config() {
    OidcConfig value;
    value.issuer = QUrl(QStringLiteral("https://id.example.com"));
    value.clientId = QStringLiteral("client-1");
    return value;
}

std::chrono::system_clock::time_point now() {
    return std::chrono::system_clock::now();
}

TEST(IdTokenClaimsTest, AcceptsAWellFormedToken) {
    const auto user = validateIdToken(makeJwt(validIdTokenClaims(config())), config(), now());
    ASSERT_TRUE(user.has_value()) << user.error().message;
    EXPECT_EQ(user->subject, "user-1");
    EXPECT_EQ(user->email, "ada@example.com");
    EXPECT_EQ(user->name, "Ada Lovelace");
}

TEST(IdTokenClaimsTest, FallsBackToPreferredUsernameForTheName) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.remove("name");
    claims.insert("preferred_username", "ada");
    const auto user = validateIdToken(makeJwt(claims), config(), now());
    ASSERT_TRUE(user.has_value());
    EXPECT_EQ(user->name, "ada");
}

TEST(IdTokenClaimsTest, RejectsWrongIssuer) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.insert("iss", "https://evil.example.com");
    const auto user = validateIdToken(makeJwt(claims), config(), now());
    ASSERT_FALSE(user.has_value());
    EXPECT_EQ(user.error().code, core::ErrorCode::Unauthenticated);
}

TEST(IdTokenClaimsTest, AcceptsIssuerWithTrailingSlash) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.insert("iss", "https://id.example.com/");
    EXPECT_TRUE(validateIdToken(makeJwt(claims), config(), now()).has_value());
}

TEST(IdTokenClaimsTest, ANonceMustBeEchoedWhenOneWasSent) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.insert("nonce", "n-1");
    const auto jwt = makeJwt(claims);

    EXPECT_TRUE(validateIdToken(jwt, config(), now(), std::chrono::seconds{60}, "n-1").has_value());
    EXPECT_FALSE(validateIdToken(jwt, config(), now(), std::chrono::seconds{60}, "n-2").has_value());
    EXPECT_FALSE(
        validateIdToken(makeJwt(validIdTokenClaims(config())), config(), now(), std::chrono::seconds{60}, "n-1")
            .has_value());
    EXPECT_TRUE(validateIdToken(jwt, config(), now()).has_value()) << "no nonce expected (refresh): not checked";
}

TEST(IdTokenClaimsTest, RejectsWrongAudience) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.insert("aud", "someone-else");
    EXPECT_FALSE(validateIdToken(makeJwt(claims), config(), now()).has_value());
}

TEST(IdTokenClaimsTest, AudienceArrayNeedsAzpWhenSeveralEntries) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.insert("aud", QJsonArray{"client-1", "api"});
    EXPECT_FALSE(validateIdToken(makeJwt(claims), config(), now()).has_value());
    claims.insert("azp", "client-1");
    EXPECT_TRUE(validateIdToken(makeJwt(claims), config(), now()).has_value());
    claims.insert("azp", "other");
    EXPECT_FALSE(validateIdToken(makeJwt(claims), config(), now()).has_value());
}

TEST(IdTokenClaimsTest, RejectsExpiredButToleratesSmallClockSkew) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.insert("exp", static_cast<double>(nowSeconds() - 30));
    EXPECT_TRUE(validateIdToken(makeJwt(claims), config(), now()).has_value()); // within 60 s leeway
    claims.insert("exp", static_cast<double>(nowSeconds() - 600));
    EXPECT_FALSE(validateIdToken(makeJwt(claims), config(), now()).has_value());
}

TEST(IdTokenClaimsTest, RejectsTokensIssuedFarInTheFuture) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.insert("iat", static_cast<double>(nowSeconds() + 3600));
    EXPECT_FALSE(validateIdToken(makeJwt(claims), config(), now()).has_value());
}

TEST(IdTokenClaimsTest, RejectsMissingSubjectAndExp) {
    QJsonObject claims = validIdTokenClaims(config());
    claims.remove("sub");
    EXPECT_FALSE(validateIdToken(makeJwt(claims), config(), now()).has_value());
    claims = validIdTokenClaims(config());
    claims.remove("exp");
    EXPECT_FALSE(validateIdToken(makeJwt(claims), config(), now()).has_value());
}

TEST(IdTokenClaimsTest, RejectsMalformedTokens) {
    for (const char* bad : {"", "abc", "a.b", "a.b.c.d", "a.!!!.c", "a.e30.c"}) {
        EXPECT_FALSE(validateIdToken(bad, config(), now()).has_value()) << bad;
    }
    EXPECT_FALSE(validateIdToken(std::string(40000, 'a'), config(), now()).has_value());
}

TEST(IdTokenClaimsTest, Base64UrlDecodingHandlesUnpaddedInput) {
    EXPECT_EQ(decodeBase64Url("aGVsbG8"), "hello");
    EXPECT_EQ(decodeBase64Url("_-8"), std::string("\xff\xef"));
}

} // namespace
} // namespace aedst::oidc
