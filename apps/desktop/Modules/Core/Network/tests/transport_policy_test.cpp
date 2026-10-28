#include "aedst/network/transport_policy.hpp"

#include <QByteArray>
#include <QString>
#include <QUrl>
#include <QtGlobal>

#include <gtest/gtest.h>

#include <string>

namespace aedst::network {
namespace {

struct EndpointCase {
    const char* name;
    const char* url;
    /// true = a Debug build (or the runtime opt-in); false = Release without opt-in.
    bool allowInsecureLoopback;
    bool accepted;
    /// Substring the rejection message must contain (empty when accepted).
    const char* messageContains;
};

class ValidateEndpointTest : public ::testing::TestWithParam<EndpointCase> {};

TEST_P(ValidateEndpointTest, AppliesTheTransportPolicy) {
    const auto& param = GetParam();

    const auto result = validateEndpoint(QUrl(QString::fromUtf8(param.url)), param.allowInsecureLoopback);

    ASSERT_EQ(result.has_value(), param.accepted) << param.url;
    if (!param.accepted) {
        EXPECT_EQ(result.error().kind, ApiErrorKind::InvalidArgument);
        EXPECT_FALSE(result.error().isRetryable());
        EXPECT_NE(result.error().message.find(param.messageContains), std::string::npos) << result.error().message;
    }
}

INSTANTIATE_TEST_SUITE_P(
    Policy, ValidateEndpointTest,
    ::testing::Values(
        // https is always fine, in either build mode.
        EndpointCase{"HttpsRemote", "https://api.example.com", false, true, ""},
        EndpointCase{"HttpsRemoteWithPortAndPath", "https://api.example.com:8443/rpc", true, true, ""},
        EndpointCase{"HttpsLoopback", "https://localhost:8443", false, true, ""},
        // Plain http: loopback only, and only when allowed.
        EndpointCase{"HttpLocalhostDebug", "http://localhost:8080", true, true, ""},
        EndpointCase{"HttpDotLocalhostDebug", "http://api.localhost:8080", true, true, ""},
        EndpointCase{"HttpLoopbackIpv4Debug", "http://127.0.0.1:8080", true, true, ""},
        EndpointCase{"HttpLoopbackIpv4OtherOctetsDebug", "http://127.5.6.7:8080", true, true, ""},
        EndpointCase{"HttpLoopbackIpv6Debug", "http://[::1]:8080", true, true, ""},
        EndpointCase{"HttpLocalhostUpperCaseDebug", "http://LOCALHOST:8080", true, true, ""},
        EndpointCase{"HttpRemoteRejectedEvenInDebug", "http://evil.com", true, false, "loopback"},
        EndpointCase{"HttpRemoteRejectedInRelease", "http://evil.com", false, false, "loopback"},
        EndpointCase{"HttpLocalhostLookalikeRejected", "http://localhost.evil.com", true, false, "loopback"},
        EndpointCase{"HttpNonLoopbackIpRejected", "http://192.168.1.10:8080", true, false, "loopback"},
        EndpointCase{"HttpLocalhostRejectedInReleaseWithoutOptIn", "http://localhost:8080", false, false,
                     "AEDST_ALLOW_INSECURE_LOCALHOST"},
        EndpointCase{"HttpLoopbackIpRejectedInReleaseWithoutOptIn", "http://127.0.0.1:8080", false, false,
                     "AEDST_ALLOW_INSECURE_LOCALHOST"},
        EndpointCase{"HttpLoopbackIpv6RejectedInReleaseWithoutOptIn", "http://[::1]:8080", false, false,
                     "AEDST_ALLOW_INSECURE_LOCALHOST"},
        // Everything else that is malformed or ambiguous.
        EndpointCase{"FtpScheme", "ftp://api.example.com", true, false, "https"},
        EndpointCase{"WebSocketScheme", "wss://api.example.com", true, false, "https"},
        EndpointCase{"NoScheme", "api.example.com", true, false, "https"},
        EndpointCase{"Userinfo", "https://user:secret@api.example.com", true, false, "credentials"},
        EndpointCase{"UsernameOnly", "https://user@api.example.com", true, false, "credentials"},
        EndpointCase{"EmptyHost", "https:///rpc", true, false, "host"},
        EndpointCase{"Fragment", "https://api.example.com/#frag", true, false, "fragment"},
        EndpointCase{"Query", "https://api.example.com/?a=1", true, false, "query"},
        EndpointCase{"Empty", "", true, false, "empty"},
        EndpointCase{"InvalidPort", "https://api.example.com:notaport", true, false, "malformed"}),
    [](const ::testing::TestParamInfo<EndpointCase>& info) { return std::string(info.param.name); });

TEST(ValidateEndpointMessageTest, NeverEchoesCredentialsFromTheUrl) {
    const auto result = validateEndpoint(QUrl(QStringLiteral("https://alice:hunter2@api.example.com")), true);

    ASSERT_FALSE(result.has_value());
    EXPECT_EQ(result.error().message.find("hunter2"), std::string::npos);
    EXPECT_EQ(result.error().message.find("alice"), std::string::npos);
}

TEST(IsLoopbackHostTest, RecognisesOnlyLoopbackNames) {
    EXPECT_TRUE(isLoopbackHost(QStringLiteral("localhost")));
    EXPECT_TRUE(isLoopbackHost(QStringLiteral("LocalHost.")));
    EXPECT_TRUE(isLoopbackHost(QStringLiteral("a.b.localhost")));
    EXPECT_TRUE(isLoopbackHost(QStringLiteral("127.0.0.1")));
    EXPECT_TRUE(isLoopbackHost(QStringLiteral("127.255.255.254")));
    EXPECT_TRUE(isLoopbackHost(QStringLiteral("::1")));
    EXPECT_TRUE(isLoopbackHost(QStringLiteral("[::1]")));

    EXPECT_FALSE(isLoopbackHost(QString()));
    EXPECT_FALSE(isLoopbackHost(QStringLiteral("localhost.example.com")));
    EXPECT_FALSE(isLoopbackHost(QStringLiteral("notlocalhost")));
    EXPECT_FALSE(isLoopbackHost(QStringLiteral("128.0.0.1")));
    EXPECT_FALSE(isLoopbackHost(QStringLiteral("0.0.0.0")));
    EXPECT_FALSE(isLoopbackHost(QStringLiteral("::2")));
    EXPECT_FALSE(isLoopbackHost(QStringLiteral("example.com")));
}

/// Restores AEDST_ALLOW_INSECURE_LOCALHOST when the test ends.
class ScopedEnv final {
public:
    explicit ScopedEnv(const QByteArray& value)
        : hadValue_(qEnvironmentVariableIsSet(kName)), previous_(qgetenv(kName)) {
        if (value.isNull()) {
            qunsetenv(kName);
        } else {
            qputenv(kName, value);
        }
    }

    ~ScopedEnv() {
        if (hadValue_) {
            qputenv(kName, previous_);
        } else {
            qunsetenv(kName);
        }
    }

    ScopedEnv(const ScopedEnv&) = delete;
    ScopedEnv& operator=(const ScopedEnv&) = delete;

private:
    static constexpr const char* kName = "AEDST_ALLOW_INSECURE_LOCALHOST";
    bool hadValue_;
    QByteArray previous_;
};

TEST(InsecureLoopbackDefaultTest, EnvironmentOptInIsHonouredInEveryBuild) {
    for (const char* truthy : {"1", "true", "TRUE", "yes", "On"}) {
        const ScopedEnv env{QByteArray(truthy)};
        EXPECT_TRUE(insecureLoopbackAllowedByDefault()) << truthy;
    }
}

TEST(InsecureLoopbackDefaultTest, WithoutOptInOnlyDebugBuildsAllowIt) {
#ifdef NDEBUG
    constexpr bool kDebugBuild = false;
#else
    constexpr bool kDebugBuild = true;
#endif
    {
        const ScopedEnv env{QByteArray()};
        EXPECT_EQ(insecureLoopbackAllowedByDefault(), kDebugBuild);
    }
    for (const char* falsy : {"0", "false", "no", "off", "", "2", "enabled"}) {
        const ScopedEnv env{QByteArray(falsy)};
        EXPECT_EQ(insecureLoopbackAllowedByDefault(), kDebugBuild) << falsy;
    }
}

} // namespace
} // namespace aedst::network
