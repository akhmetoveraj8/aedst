#include "aedst/oidc/oidc_config.hpp"

#include <QProcessEnvironment>
#include <QSettings>
#include <QTemporaryDir>

#include <gtest/gtest.h>

namespace aedst::oidc {
namespace {

OidcConfig validConfig() {
    OidcConfig config;
    config.issuer = QUrl(QStringLiteral("https://id.example.com"));
    config.clientId = QStringLiteral("client-1");
    return config;
}

TEST(OidcConfigTest, ScopesIncludeOpenIdProfileEmailAndOfflineAccess) {
    const auto scopes = validConfig().scopeTokens();
    EXPECT_TRUE(scopes.contains("openid"));
    EXPECT_TRUE(scopes.contains("profile"));
    EXPECT_TRUE(scopes.contains("email"));
    EXPECT_TRUE(scopes.contains("offline_access"));
    EXPECT_EQ(scopes.size(), 4);
}

TEST(OidcConfigTest, ProjectIdAddsAudienceAndRolesScopes) {
    OidcConfig config = validConfig();
    config.projectId = QStringLiteral("1234567890");
    auto scopes = config.scopeTokens();
    EXPECT_TRUE(scopes.contains("urn:zitadel:iam:org:project:id:1234567890:aud"));
    EXPECT_TRUE(scopes.contains("urn:zitadel:iam:org:projects:roles"));

    config.requestRolesScope = false;
    scopes = config.scopeTokens();
    EXPECT_TRUE(scopes.contains("urn:zitadel:iam:org:project:id:1234567890:aud"));
    EXPECT_FALSE(scopes.contains("urn:zitadel:iam:org:projects:roles"));
}

TEST(OidcConfigTest, ExtraScopesAreTrimmedAndEmptyOnesDropped) {
    OidcConfig config = validConfig();
    config.extraScopes = {QStringLiteral(" groups "), QString(), QStringLiteral("  ")};
    const auto scopes = config.scopeTokens();
    EXPECT_TRUE(scopes.contains("groups"));
    EXPECT_EQ(scopes.size(), 5);
}

TEST(OidcConfigTest, ValidationRequiresHttpsIssuerAndClientId) {
    EXPECT_TRUE(validateOidcConfig(validConfig()).has_value());

    OidcConfig noClient = validConfig();
    noClient.clientId.clear();
    EXPECT_FALSE(validateOidcConfig(noClient).has_value());

    OidcConfig http = validConfig();
    http.issuer = QUrl(QStringLiteral("http://id.example.com"));
    EXPECT_FALSE(validateOidcConfig(http).has_value());

    OidcConfig withQuery = validConfig();
    withQuery.issuer = QUrl(QStringLiteral("https://id.example.com/?x=1"));
    EXPECT_FALSE(validateOidcConfig(withQuery).has_value());

    OidcConfig withCredentials = validConfig();
    withCredentials.issuer = QUrl(QStringLiteral("https://user:pw@id.example.com"));
    EXPECT_FALSE(validateOidcConfig(withCredentials).has_value());
}

TEST(OidcConfigTest, LoopbackHttpNeedsTheExplicitSwitchAndALoopbackHost) {
    OidcConfig local = validConfig();
    local.issuer = QUrl(QStringLiteral("http://127.0.0.1:8080"));
    EXPECT_FALSE(validateOidcConfig(local).has_value());

    local.allowInsecureLoopbackIssuer = true;
    EXPECT_TRUE(validateOidcConfig(local).has_value());

    local.issuer = QUrl(QStringLiteral("http://id.example.com"));
    EXPECT_FALSE(validateOidcConfig(local).has_value()); // the switch never allows a remote http host
}

TEST(OidcConfigTest, NormalizedIssuerIgnoresTrailingSlash) {
    EXPECT_EQ(normalizedIssuer(QUrl(QStringLiteral("https://a.example/"))),
              normalizedIssuer(QUrl(QStringLiteral("https://a.example"))));
}

TEST(OidcConfigTest, EnvironmentOverridesSettings) {
    QTemporaryDir dir;
    ASSERT_TRUE(dir.isValid());
    QSettings settings(dir.filePath("s.ini"), QSettings::IniFormat);
    settings.setValue("oidc/issuer", "https://from-settings.example");
    settings.setValue("oidc/clientId", "settings-client");
    settings.setValue("oidc/projectId", "settings-project");

    QProcessEnvironment environment;
    environment.insert("AEDST_OIDC_ISSUER", "https://from-env.example");
    environment.insert("AEDST_OIDC_LOOPBACK_PORT", "53682");
    environment.insert("AEDST_OIDC_EXTRA_SCOPES", "groups  custom");
    environment.insert("AEDST_OIDC_ROLES_SCOPE", "0");
    environment.insert("AEDST_OIDC_END_SESSION", "false");

    const OidcConfig config = loadOidcConfig(settings, environment);
    EXPECT_EQ(config.issuer.toString(), QStringLiteral("https://from-env.example"));
    EXPECT_EQ(config.clientId, QStringLiteral("settings-client"));
    EXPECT_EQ(config.projectId, QStringLiteral("settings-project"));
    EXPECT_EQ(config.loopbackPort, 53682);
    EXPECT_EQ(config.extraScopes, (QStringList{QStringLiteral("groups"), QStringLiteral("custom")}));
    EXPECT_FALSE(config.requestRolesScope);
    EXPECT_FALSE(config.endSessionInBrowser);
    EXPECT_FALSE(config.allowInsecureLoopbackIssuer);
    EXPECT_TRUE(config.isConfigured());
}

TEST(OidcConfigTest, NothingConfiguredMeansNotConfigured) {
    QTemporaryDir dir;
    QSettings settings(dir.filePath("empty.ini"), QSettings::IniFormat);
    const OidcConfig config = loadOidcConfig(settings, QProcessEnvironment());
    EXPECT_FALSE(config.isConfigured());
    EXPECT_EQ(config.loopbackPort, 0);
}

TEST(OidcConfigTest, InvalidPortIsIgnored) {
    QTemporaryDir dir;
    QSettings settings(dir.filePath("p.ini"), QSettings::IniFormat);
    QProcessEnvironment environment;
    environment.insert("AEDST_OIDC_LOOPBACK_PORT", "99999");
    EXPECT_EQ(loadOidcConfig(settings, environment).loopbackPort, 0);
    environment.insert("AEDST_OIDC_LOOPBACK_PORT", "abc");
    EXPECT_EQ(loadOidcConfig(settings, environment).loopbackPort, 0);
}

} // namespace
} // namespace aedst::oidc
