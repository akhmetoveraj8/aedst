#include "aedst/plugin/plugin_trust.hpp"

#include <gtest/gtest.h>

#include <string>

namespace aedst::plugin {
namespace {

const std::string kHash(64, 'a');

TrustPolicy signedPolicy() {
    TrustPolicy policy;
    policy.releaseBuild = true;
    policy.allowlistPresent = true;
    policy.allowlistSignatureValid = true;
    policy.entries.push_back(
        AllowlistEntry{.fileName = "reports.dll", .sha256 = kHash, .size = 1234, .pluginId = "vendor.reports"});
    return policy;
}

CandidateFile reports() {
    return CandidateFile{.fileName = "reports.dll", .sha256 = kHash, .size = 1234};
}

TEST(PluginTrust, ListedFileWithMatchingHashAndSizeIsTrusted) {
    const TrustPolicy policy = signedPolicy();
    const TrustDecision decision = evaluateCandidate(policy, reports());

    EXPECT_EQ(decision.verdict, TrustVerdict::Trusted);
    EXPECT_TRUE(decision.loadable());
    ASSERT_NE(decision.entry, nullptr);
    EXPECT_EQ(decision.entry->pluginId, "vendor.reports");
}

TEST(PluginTrust, HashComparisonIgnoresCase) {
    TrustPolicy policy = signedPolicy();
    CandidateFile file = reports();
    file.sha256 = std::string(64, 'A');
    EXPECT_EQ(evaluateCandidate(policy, file).verdict, TrustVerdict::Trusted);
}

TEST(PluginTrust, TamperedFileIsRejected) {
    const TrustPolicy policy = signedPolicy();
    CandidateFile file = reports();
    file.sha256 = std::string(64, 'b');
    EXPECT_EQ(evaluateCandidate(policy, file).verdict, TrustVerdict::HashMismatch);

    file = reports();
    file.size = 1235;
    EXPECT_EQ(evaluateCandidate(policy, file).verdict, TrustVerdict::SizeMismatch);
}

TEST(PluginTrust, MalformedListedHashNeverMatches) {
    TrustPolicy policy = signedPolicy();
    policy.entries.front().sha256 = "abc";
    EXPECT_EQ(evaluateCandidate(policy, reports()).verdict, TrustVerdict::HashMismatch);
}

TEST(PluginTrust, UnlistedFileIsRejected) {
    const TrustPolicy policy = signedPolicy();
    CandidateFile file = reports();
    file.fileName = "other.dll";
    const TrustDecision decision = evaluateCandidate(policy, file);
    EXPECT_EQ(decision.verdict, TrustVerdict::NotListed);
    EXPECT_FALSE(decision.loadable());
}

TEST(PluginTrust, NamesWithPathPartsAreNeverListed) {
    TrustPolicy policy = signedPolicy();
    policy.entries.front().fileName = "../reports.dll";
    for (const char* name : {"../reports.dll", "sub/reports.dll", "sub\\reports.dll", "C:reports.dll", "..", ""}) {
        CandidateFile file = reports();
        file.fileName = name;
        EXPECT_EQ(evaluateCandidate(policy, file).verdict, TrustVerdict::NotListed) << name;
    }
}

TEST(PluginTrust, UnsignedAllowlistRejectsEverythingEvenInDebug) {
    TrustPolicy policy = signedPolicy();
    policy.allowlistSignatureValid = false;
    policy.releaseBuild = false;
    policy.allowUnsignedDevPlugins = true;
    EXPECT_EQ(evaluateCandidate(policy, reports()).verdict, TrustVerdict::BadSignature);
}

TEST(PluginTrust, ReleaseWithoutAllowlistLoadsNothing) {
    TrustPolicy policy;
    policy.releaseBuild = true;
    policy.allowUnsignedDevPlugins = true; // must be ignored in a release build
    EXPECT_EQ(evaluateCandidate(policy, reports()).verdict, TrustVerdict::NoAllowlist);
}

TEST(PluginTrust, DebugWithoutAllowlistNeedsTheExplicitDevSwitch) {
    TrustPolicy policy;
    policy.releaseBuild = false;
    EXPECT_EQ(evaluateCandidate(policy, reports()).verdict, TrustVerdict::NoAllowlist);

    policy.allowUnsignedDevPlugins = true;
    const TrustDecision decision = evaluateCandidate(policy, reports());
    EXPECT_EQ(decision.verdict, TrustVerdict::TrustedUnsignedDev);
    EXPECT_TRUE(decision.loadable());
}

TEST(PluginTrust, ValidAllowlistIsEnforcedEvenWithTheDevSwitch) {
    TrustPolicy policy = signedPolicy();
    policy.releaseBuild = false;
    policy.allowUnsignedDevPlugins = true;
    CandidateFile file = reports();
    file.fileName = "unlisted.dll";
    EXPECT_EQ(evaluateCandidate(policy, file).verdict, TrustVerdict::NotListed);
}

} // namespace
} // namespace aedst::plugin
