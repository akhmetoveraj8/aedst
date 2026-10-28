#include "aedst/update/manifest_verifier.hpp"
#include "test_support.hpp"

#include <gtest/gtest.h>

#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace aedst::update {
namespace {

using test_support::base64;
using test_support::generateKeyPair;
using test_support::makeEnvelope;
using test_support::manifestJson;
using test_support::sign;
using test_support::signedEnvelope;
using test_support::TestKeyPair;
using test_support::toHex;

TrustedKey trusted(const std::string& keyId, const TestKeyPair& pair) {
    TrustedKey key;
    key.keyId = keyId;
    key.publicKey = pair.publicKey;
    return key;
}

class ManifestVerifierTest : public ::testing::Test {
protected:
    TestKeyPair primary_ = generateKeyPair();
    TestKeyPair other_ = generateKeyPair();
};

TEST_F(ManifestVerifierTest, KeyGenerationWorks) {
    ASSERT_TRUE(primary_.privateKey != nullptr);
    ASSERT_TRUE(other_.privateKey != nullptr);
    EXPECT_NE(primary_.publicKey, other_.publicKey);
}

TEST_F(ManifestVerifierTest, AcceptsAValidSignature) {
    const ManifestVerifier verifier{{trusted("k1", primary_)}};
    const auto manifest = verifier.verify(signedEnvelope(primary_, "k1", manifestJson()));
    ASSERT_TRUE(manifest.has_value()) << manifest.error().message;
    EXPECT_EQ(manifest->version, "2.0.0");
}

TEST_F(ManifestVerifierTest, RejectsATamperedPayload) {
    const ManifestVerifier verifier{{trusted("k1", primary_)}};
    const std::string signedPayload = manifestJson("2.0.0");
    const auto signature = base64(sign(primary_, signedPayload));
    // Attacker swaps in a different manifest (new version, same signature).
    const std::string envelope = makeEnvelope(manifestJson("9.9.9"), {{"k1", signature}});
    const auto manifest = verifier.verify(envelope);
    ASSERT_FALSE(manifest.has_value());
    EXPECT_EQ(manifest.error().code, core::ErrorCode::Unauthenticated);
}

TEST_F(ManifestVerifierTest, RejectsASingleFlippedBit) {
    const ManifestVerifier verifier{{trusted("k1", primary_)}};
    std::string payload = manifestJson();
    const auto signature = base64(sign(primary_, payload));
    payload[payload.size() / 2] = static_cast<char>(payload[payload.size() / 2] ^ 0x01);
    EXPECT_FALSE(verifier.verify(makeEnvelope(payload, {{"k1", signature}})).has_value());
}

TEST_F(ManifestVerifierTest, RejectsAWrongKey) {
    const ManifestVerifier verifier{{trusted("k1", primary_)}};
    // Signed by a key the client does not trust, but claiming the trusted keyId.
    const auto manifest = verifier.verify(signedEnvelope(other_, "k1", manifestJson()));
    ASSERT_FALSE(manifest.has_value());
    EXPECT_EQ(manifest.error().code, core::ErrorCode::Unauthenticated);
}

TEST_F(ManifestVerifierTest, IgnoresSignaturesFromUnknownKeyIds) {
    const ManifestVerifier verifier{{trusted("k1", primary_)}};
    EXPECT_FALSE(verifier.verify(signedEnvelope(primary_, "not-trusted", manifestJson())).has_value());
}

TEST_F(ManifestVerifierTest, SupportsKeyRotation) {
    const std::string payload = manifestJson();
    const auto oldSignature = base64(sign(primary_, payload));
    const auto newSignature = base64(sign(other_, payload));

    // A client that already trusts both keys accepts either one.
    const ManifestVerifier both{{trusted("old", primary_), trusted("new", other_)}};
    EXPECT_TRUE(both.verify(makeEnvelope(payload, {{"new", newSignature}})).has_value());
    EXPECT_TRUE(both.verify(makeEnvelope(payload, {{"old", oldSignature}})).has_value());
    // Dual-signed envelope with one bad entry still verifies through the good one.
    EXPECT_TRUE(both.verify(makeEnvelope(payload, {{"old", newSignature}, {"new", newSignature}})).has_value());

    // A client that only trusts the old key rejects a new-key-only envelope...
    const ManifestVerifier oldOnly{{trusted("old", primary_)}};
    EXPECT_FALSE(oldOnly.verify(makeEnvelope(payload, {{"new", newSignature}})).has_value());
    // ...but accepts the dual-signed one (the bridge release of a rotation).
    EXPECT_TRUE(oldOnly.verify(makeEnvelope(payload, {{"new", newSignature}, {"old", oldSignature}})).has_value());
}

TEST_F(ManifestVerifierTest, FailsClosedWithoutTrustedKeys) {
    const ManifestVerifier verifier{std::vector<TrustedKey>{}};
    const auto manifest = verifier.verify(signedEnvelope(primary_, "k1", manifestJson()));
    ASSERT_FALSE(manifest.has_value());
    EXPECT_EQ(manifest.error().code, core::ErrorCode::Unauthenticated);
}

TEST_F(ManifestVerifierTest, RejectsMalformedEnvelopes) {
    const ManifestVerifier verifier{{trusted("k1", primary_)}};
    const std::string payload = manifestJson();
    const std::string goodSignature = base64(sign(primary_, payload));
    const std::vector<std::string> bad{
        "",
        "not json",
        "[]",
        "{}",
        R"({"payload":"!!!","signatures":[{"keyId":"k1","signature":"AAAA"}]})",
        R"({"payload":"e30=","signatures":[]})",
        R"({"payload":"e30=","signatures":"x"})",
        R"({"payload":5,"signatures":[]})",
        makeEnvelope(payload, {{"k1", "AAAA"}}),                      // wrong length
        makeEnvelope(payload, {{"k1", goodSignature.substr(0, 40)}}), // truncated
        makeEnvelope(payload, {{"k1", "not base64 !!"}}),
        makeEnvelope(payload, {}), // no signatures
    };
    for (const std::string& envelope : bad) {
        EXPECT_FALSE(verifier.verify(envelope).has_value()) << envelope;
    }
}

TEST_F(ManifestVerifierTest, ValidSignatureOverAnInvalidManifestIsRejected) {
    const ManifestVerifier verifier{{trusted("k1", primary_)}};
    const auto manifest = verifier.verify(signedEnvelope(primary_, "k1", R"({"version":"nope"})"));
    ASSERT_FALSE(manifest.has_value());
    EXPECT_EQ(manifest.error().code, core::ErrorCode::InvalidInput);
}

TEST_F(ManifestVerifierTest, VerifyEd25519RejectsBadInputSizes) {
    const std::string message = "hello";
    const auto signature = sign(primary_, message);
    const auto* bytes = reinterpret_cast<const std::uint8_t*>(message.data());
    const std::span<const std::uint8_t> msg{bytes, message.size()};
    EXPECT_TRUE(verifyEd25519(primary_.publicKey, msg, signature));
    EXPECT_FALSE(verifyEd25519(std::span<const std::uint8_t>{primary_.publicKey.data(), 31}, msg, signature));
    EXPECT_FALSE(verifyEd25519(primary_.publicKey, msg, std::span<const std::uint8_t>{signature.data(), 63}));
    EXPECT_FALSE(verifyEd25519(primary_.publicKey, std::span<const std::uint8_t>{}, signature));
    EXPECT_FALSE(verifyEd25519(other_.publicKey, msg, signature));
}

TEST(TrustedKeysTest, ParsesKeyLists) {
    const std::string hexA(64, 'a');
    const std::string hexB(64, 'B');

    const auto empty = parseTrustedKeys("");
    ASSERT_TRUE(empty.has_value());
    EXPECT_TRUE(empty->empty());

    const auto keys = parseTrustedKeys("release-2024:" + hexA + ",release-2025:" + hexB);
    ASSERT_TRUE(keys.has_value());
    ASSERT_EQ(keys->size(), 2U);
    EXPECT_EQ((*keys)[0].keyId, "release-2024");
    EXPECT_EQ((*keys)[0].publicKey[0], 0xAAU);
    EXPECT_EQ((*keys)[1].publicKey[31], 0xBBU);
}

TEST(TrustedKeysTest, RejectsMalformedLists) {
    const std::string hex(64, 'a');
    const std::vector<std::string> bad{
        "nocolon",
        ":" + hex,
        "k:" + std::string(62, 'a'),
        "k:" + std::string(66, 'a'),
        "k:" + std::string(64, 'z'),
        "k:" + hex + ",",
        "k:" + hex + ",k:" + hex,
        "bad id:" + hex,
        std::string(33, 'k') + ":" + hex,
    };
    for (const std::string& spec : bad) {
        EXPECT_FALSE(parseTrustedKeys(spec).has_value()) << spec;
    }
}

TEST(TrustedKeysTest, EmbeddedKeysAreEmptyByDefault) {
    // No AEDST_UPDATE_PUBLIC_KEYS in a default build: nothing is trusted.
    if (embeddedTrustedKeys().empty()) {
        SUCCEED();
    } else {
        GTEST_SKIP() << "built with AEDST_UPDATE_PUBLIC_KEYS";
    }
}

} // namespace
} // namespace aedst::update
