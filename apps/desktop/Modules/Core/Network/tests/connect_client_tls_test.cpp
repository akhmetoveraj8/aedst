#include "aedst/contract/methods.hpp"
#include "aedst/network/connect_client.hpp"
#include "aedst/testing/fake_http_server.hpp"
#include "aedst/testing/test_tls_material.hpp"

#include <QByteArray>
#include <QCryptographicHash>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QSslKey>
#include <QSslSocket>

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <vector>

// TLS policy of ConnectClient against a REAL TLS handshake: FakeHttpServer's HTTPS mode (QSslServer) presents a leaf
// issued by a private test CA. Proves: an untrusted server is refused and NOT retried, a CA added through
// extraCaCertificatesPem extends trust, SPKI pins accept the right key and reject any other. main() lives in
// connect_client_test.cpp (same binary). All tests skip when this Qt build has no TLS backend.

namespace aedst::network {
namespace {

using namespace std::chrono_literals;
using ::aedst::testing::FakeHttpServer;
using ::aedst::testing::FakeResponse;
using ::aedst::testing::waitUntil;
namespace authv1 = ::aedst::auth::v1;

QSslConfiguration serverTls() {
    QSslConfiguration configuration = QSslConfiguration::defaultConfiguration();
    configuration.setLocalCertificate(QSslCertificate(QByteArray(testing::kTestLeafPem), QSsl::Pem));
    configuration.setPrivateKey(QSslKey(QByteArray(testing::kTestLeafKeyPem), QSsl::Ec, QSsl::Pem));
    configuration.setPeerVerifyMode(QSslSocket::VerifyNone);
    return configuration;
}

QByteArray userBytes() {
    authv1::GetCurrentUserResponse response;
    response.mutable_user()->set_id("u1");
    return QByteArray::fromStdString(response.SerializeAsString());
}

class ClientTlsTest : public ::testing::Test {
protected:
    void SetUp() override {
        if (!QSslSocket::supportsSsl()) {
            GTEST_SKIP() << "no TLS backend in this Qt build";
        }
        server_ = std::make_unique<FakeHttpServer>(serverTls());
        ASSERT_TRUE(server_->isListening());
    }

    /// A client for the HTTPS fake; `retry` is generous so a wrongly retried TLS failure would show up as a 2nd
    /// handshake.
    std::unique_ptr<ConnectClient> client(QByteArray extraCa = {}, std::vector<std::string> pins = {}) const {
        return std::make_unique<ConnectClient>(
            ClientConfig{.baseUrl = server_->baseUrl(),
                         .defaultTimeout = 3s,
                         .retry = RetryPolicy{.maxAttempts = 3, .initialBackoff = 1ms, .maxBackoff = 2ms},
                         .extraCaCertificatesPem = std::move(extraCa),
                         .pinnedSpkiSha256 = std::move(pins)},
            nullptr);
    }

    std::optional<ApiResult<authv1::GetCurrentUserResponse>> run(ConnectClient& c) {
        std::optional<ApiResult<authv1::GetCurrentUserResponse>> out;
        c.unary(contract::kAuthGetCurrentUser, authv1::GetCurrentUserRequest{},
                [&out](ApiResult<authv1::GetCurrentUserResponse> result) { out = std::move(result); });
        waitUntil([&] { return out.has_value(); }, 8s);
        return out;
    }

    std::unique_ptr<FakeHttpServer> server_;
};

TEST_F(ClientTlsTest, AnUntrustedServerIsRefusedAndTheFailureIsNotRetried) {
    server_->enqueue(FakeResponse::proto(userBytes()));
    auto c = client();

    const auto out = run(*c);

    ASSERT_TRUE(out.has_value());
    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Transport);
    EXPECT_TRUE(server_->requests().empty()) << "no application data may reach an unverified peer";
    EXPECT_EQ(server_->tlsHandshakeAttempts(), 1) << "a certificate verdict is final: retrying cannot change it";
}

TEST_F(ClientTlsTest, AnExtraCaExtendsTrustSoTheSameServerIsAccepted) {
    server_->enqueue(FakeResponse::proto(userBytes()));
    auto c = client(QByteArray(testing::kTestCaPem));

    const auto out = run(*c);

    ASSERT_TRUE(out.has_value());
    ASSERT_TRUE(out->has_value()) << out->error().message;
    EXPECT_EQ((*out)->user().id(), "u1");
    EXPECT_EQ(server_->requests().size(), 1U);
}

TEST_F(ClientTlsTest, AMatchingSpkiPinIsAccepted) {
    server_->enqueue(FakeResponse::proto(userBytes()));
    auto c = client(QByteArray(testing::kTestCaPem), {testing::kTestLeafSpkiSha256Base64});

    const auto out = run(*c);

    ASSERT_TRUE(out.has_value());
    EXPECT_TRUE(out->has_value()) << (out->has_value() ? "" : out->error().message);
}

TEST_F(ClientTlsTest, APinThatMatchesNoKeyOfTheChainIsRefusedAndNotRetried) {
    server_->enqueue(FakeResponse::proto(userBytes()));
    const std::string wrongPin = QByteArray(32, 'x').toBase64().toStdString(); // a valid digest of some other key
    auto c = client(QByteArray(testing::kTestCaPem), {wrongPin});

    const auto out = run(*c);

    ASSERT_TRUE(out.has_value());
    ASSERT_FALSE(out->has_value());
    EXPECT_EQ(out->error().kind, ApiErrorKind::Transport);
    EXPECT_NE(out->error().message.find("pinning"), std::string::npos) << out->error().message;
    EXPECT_EQ(server_->tlsHandshakeAttempts(), 1) << "a pin violation is a verdict on the peer, never retried";
}

TEST_F(ClientTlsTest, ThePinnedKeyIsTheOneInTheTestMaterial) {
    // Guards the constant against a regenerated certificate: the pin must equal the real SPKI digest.
    const QSslCertificate leaf(QByteArray(testing::kTestLeafPem), QSsl::Pem);
    ASSERT_FALSE(leaf.isNull());
    const QByteArray digest = QCryptographicHash::hash(leaf.publicKey().toDer(), QCryptographicHash::Sha256);
    EXPECT_EQ(digest.toBase64().toStdString(), std::string(testing::kTestLeafSpkiSha256Base64));
}

} // namespace
} // namespace aedst::network
