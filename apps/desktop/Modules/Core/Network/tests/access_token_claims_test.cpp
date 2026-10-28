#include "aedst/network/access_token_claims.hpp"

#include <QByteArray>

#include <gtest/gtest.h>

#include <string>

namespace aedst::network {
namespace {

std::string tokenWithPayload(const QByteArray& json) {
    const QByteArray payload = json.toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals);
    return "eyJhbGciOiJFZERTQSJ9." + payload.toStdString() + ".c2ln";
}

TEST(AccessTokenClaimsTest, ReadsSubjectAndTopLevelRoles) {
    const auto claims = parseAccessTokenClaims(tokenWithPayload(R"({"sub":"u-1","roles":["user","admin"]})"));
    ASSERT_TRUE(claims.has_value());
    EXPECT_EQ(claims->subject, "u-1");
    EXPECT_TRUE(claims->hasRole("admin"));
    EXPECT_FALSE(claims->hasRole("support"));
}

TEST(AccessTokenClaimsTest, FollowsADottedPathLikeKeycloak) {
    const auto claims = parseAccessTokenClaims(tokenWithPayload(R"({"sub":"u","realm_access":{"roles":["admin"]}})"),
                                               "realm_access.roles");
    ASSERT_TRUE(claims.has_value());
    EXPECT_TRUE(claims->hasRole("admin"));
}

TEST(AccessTokenClaimsTest, AcceptsObjectKeyedRolesAndSpaceSeparatedStrings) {
    EXPECT_TRUE(parseAccessTokenClaims(tokenWithPayload(R"({"r":{"admin":{}}})"), "r")->hasRole("admin"));
    EXPECT_TRUE(parseAccessTokenClaims(tokenWithPayload(R"({"r":"user admin"})"), "r")->hasRole("admin"));
}

TEST(AccessTokenClaimsTest, MissingRolesMeansNoRoles) {
    const auto claims = parseAccessTokenClaims(tokenWithPayload(R"({"sub":"u"})"));
    ASSERT_TRUE(claims.has_value());
    EXPECT_TRUE(claims->roles.empty());
}

TEST(AccessTokenClaimsTest, RejectsMalformedTokens) {
    EXPECT_FALSE(parseAccessTokenClaims("").has_value());
    EXPECT_FALSE(parseAccessTokenClaims("opaque-refresh-token").has_value());
    EXPECT_FALSE(parseAccessTokenClaims("a.!!!.c").has_value());
    EXPECT_FALSE(parseAccessTokenClaims(tokenWithPayload("[1,2]")).has_value());
}

} // namespace
} // namespace aedst::network
