#include "aedst/contract/methods.hpp"
#include "aedst/contract/streaming_methods.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <google/protobuf/descriptor.h>
#include <google/protobuf/descriptor.pb.h>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

// Drift guards between the hand-written procedure table (methods.hpp) and the
// descriptors protoc generated from apps/server/api/proto.

namespace aedst::contract {
namespace {

using google::protobuf::DescriptorPool;
using google::protobuf::MethodDescriptor;
using google::protobuf::MethodOptions;

const MethodDescriptor* findMethod(std::string_view path) {
    const std::size_t slash = path.rfind('/');
    if (path.empty() || path.front() != '/' || slash == 0 || slash == std::string_view::npos) {
        return nullptr;
    }
    const std::string service(path.substr(1, slash - 1));
    const std::string method(path.substr(slash + 1));
    const auto* serviceDescriptor = DescriptorPool::generated_pool()->FindServiceByName(service);
    return serviceDescriptor == nullptr ? nullptr : serviceDescriptor->FindMethodByName(method);
}

template <typename Req, typename Res>
void expectMatchesDescriptor(const network::Method<Req, Res>& method) {
    const std::string path(method.info.path);
    const MethodDescriptor* descriptor = findMethod(method.info.path);
    ASSERT_NE(descriptor, nullptr) << path << " does not exist in the generated protos";

    EXPECT_EQ(std::string(descriptor->input_type()->full_name()), std::string(Req::descriptor()->full_name())) << path;
    EXPECT_EQ(std::string(descriptor->output_type()->full_name()), std::string(Res::descriptor()->full_name())) << path;
    EXPECT_FALSE(descriptor->client_streaming()) << path << ": streaming RPCs need a dedicated entry point";
    EXPECT_FALSE(descriptor->server_streaming()) << path;

    // Once the protos declare idempotency, the table must agree with them.
    const auto level = descriptor->options().idempotency_level();
    if (level == MethodOptions::NO_SIDE_EFFECTS || level == MethodOptions::IDEMPOTENT) {
        EXPECT_EQ(method.info.idempotency, network::Idempotency::Idempotent) << path;
    }
}

TEST(MethodTableTest, EveryEntryMatchesTheGeneratedDescriptors) {
    expectMatchesDescriptor(kAuthRegister);
    expectMatchesDescriptor(kAuthLogin);
    expectMatchesDescriptor(kAuthRefreshToken);
    expectMatchesDescriptor(kAuthLogout);
    expectMatchesDescriptor(kAuthGetCurrentUser);
    expectMatchesDescriptor(kTasksCreateTask);
    expectMatchesDescriptor(kTasksGetTask);
    expectMatchesDescriptor(kTasksListTasks);
    expectMatchesDescriptor(kTasksUpdateTask);
    expectMatchesDescriptor(kTasksDeleteTask);
    expectMatchesDescriptor(kTasksCompleteTask);
    expectMatchesDescriptor(kTasksReopenTask);
    expectMatchesDescriptor(kTasksGetTaskStats);
    expectMatchesDescriptor(kNotificationsListNotifications);
    expectMatchesDescriptor(kNotificationsGetUnreadCount);
    expectMatchesDescriptor(kNotificationsMarkRead);
    expectMatchesDescriptor(kNotificationsMarkAllRead);
    expectMatchesDescriptor(kNotificationsRegisterPushDevice);
    expectMatchesDescriptor(kNotificationsUnregisterPushDevice);
    expectMatchesDescriptor(kNotificationsGetWebPushConfig);
    expectMatchesDescriptor(kNotificationsGetPreferences);
    expectMatchesDescriptor(kNotificationsUpdatePreferences);
    expectMatchesDescriptor(kSearchSearch);
    expectMatchesDescriptor(kSearchSuggest);
    expectMatchesDescriptor(kMediaCreateUpload);
    expectMatchesDescriptor(kMediaCompleteUpload);
    expectMatchesDescriptor(kMediaGetMedia);
    expectMatchesDescriptor(kMediaListMedia);
    expectMatchesDescriptor(kMediaDeleteMedia);
    expectMatchesDescriptor(kAdminGetOverview);
    expectMatchesDescriptor(kAdminListUsers);
    expectMatchesDescriptor(kAdminListTasks);
    expectMatchesDescriptor(kAdminDeleteTask);
    expectMatchesDescriptor(kAdminBroadcastNotification);
    expectMatchesDescriptor(kAdminListAuditLog);
    expectMatchesDescriptor(kCapabilitiesGetCapabilities);
}

/// Protos whose services the desktop client never calls: device attestation exists for iOS (App Attest) and
/// Android (Play Integrity) only. Keep in step with ignored_services in scripts/check-proto-freshness.sh.
constexpr std::array<std::string_view, 2> kIgnoredProtoFiles{
    "aedst/appattest/v1/appattest.proto",
    "aedst/integrity/v1/integrity.proto",
};

TEST(MethodTableTest, EveryRpcInTheProtosHasAnEntry) {
    std::vector<std::string> protoNames;
    std::stringstream names(AEDST_CONTRACT_PROTO_NAMES);
    for (std::string name; std::getline(names, name, '|');) {
        protoNames.push_back(name);
    }
    ASSERT_FALSE(protoNames.empty());

    std::size_t rpcCount = 0;
    for (const std::string& protoName : protoNames) {
        if (std::find(kIgnoredProtoFiles.begin(), kIgnoredProtoFiles.end(), protoName) != kIgnoredProtoFiles.end()) {
            continue;
        }
        const auto* file = DescriptorPool::generated_pool()->FindFileByName(protoName);
        ASSERT_NE(file, nullptr) << protoName << " was not compiled into AedstContractProto";
        for (int s = 0; s < file->service_count(); ++s) {
            const auto* service = file->service(s);
            for (int m = 0; m < service->method_count(); ++m) {
                const std::string path =
                    "/" + std::string(service->full_name()) + "/" + std::string(service->method(m)->name());
                ++rpcCount;
                const bool streaming = service->method(m)->server_streaming();
                const auto& table = streaming ? kAllStreamingMethodPaths : kAllMethodPaths;
                EXPECT_NE(std::find(table.begin(), table.end(), path), table.end())
                    << path << " exists in " << protoName << " but has no entry in aedst/contract/"
                    << (streaming ? "streaming_methods.hpp" : "methods.hpp");
            }
        }
    }
    EXPECT_EQ(rpcCount, kAllMethodPaths.size() + kAllStreamingMethodPaths.size())
        << "the method tables list an RPC the protos no longer define";
}

#if defined(AEDST_CONTRACT_HAS_WATCH_NOTIFICATIONS)
TEST(StreamingMethodTableTest, WatchNotificationsMatchesTheDescriptor) {
    const std::string path(kNotificationsWatch.info.path);
    const MethodDescriptor* descriptor = findMethod(kNotificationsWatch.info.path);
    ASSERT_NE(descriptor, nullptr) << path;
    EXPECT_TRUE(descriptor->server_streaming()) << path << " must be a server-streaming RPC";
    EXPECT_FALSE(descriptor->client_streaming()) << path;
    EXPECT_EQ(std::string(descriptor->input_type()->full_name()),
              std::string(notificationsv1::WatchNotificationsRequest::descriptor()->full_name()));
    EXPECT_EQ(std::string(descriptor->output_type()->full_name()),
              std::string(notificationsv1::NotificationEvent::descriptor()->full_name()));
    EXPECT_EQ(kNotificationsWatch.info.auth, network::AuthRequirement::Required);
    EXPECT_EQ(kNotificationsWatch.info.idempotency, network::Idempotency::Unknown) << "streams are never retried";
}
#endif

TEST(MethodTableTest, PublicProceduresMatchTheServersPublicEdge) {
    // apps/server/cmd/server/main.go: publicProcedures = Register, Login, RefreshToken, Logout.
    using network::AuthRequirement;
    EXPECT_EQ(kAuthRegister.info.auth, AuthRequirement::Public);
    EXPECT_EQ(kAuthLogin.info.auth, AuthRequirement::Public);
    EXPECT_EQ(kAuthRefreshToken.info.auth, AuthRequirement::Public);
    EXPECT_EQ(kAuthLogout.info.auth, AuthRequirement::Public);
    EXPECT_EQ(kAuthGetCurrentUser.info.auth, AuthRequirement::Required);
    EXPECT_EQ(kTasksCreateTask.info.auth, AuthRequirement::Required);
    // Capability negotiation runs before sign-in: no token, and a read-only call that is safe to retry.
    EXPECT_EQ(kCapabilitiesGetCapabilities.info.auth, AuthRequirement::Public);
    EXPECT_EQ(kCapabilitiesGetCapabilities.info.idempotency, network::Idempotency::Idempotent);
    // Only the four auth RPCs and capability negotiation are public; everything else needs a bearer token.
    EXPECT_EQ(kSearchSearch.info.auth, AuthRequirement::Required);
    EXPECT_EQ(kMediaCreateUpload.info.auth, AuthRequirement::Required);
    EXPECT_EQ(kNotificationsGetUnreadCount.info.auth, AuthRequirement::Required);
    EXPECT_EQ(kAdminGetOverview.info.auth, AuthRequirement::Required);
}

TEST(MethodTableTest, UploadsAndAdminMutationsAreNeverRetried) {
    using network::Idempotency;
    // A replayed CreateUpload issues a second presigned URL and an orphan media row;
    // a replayed admin mutation writes a second audit entry.
    EXPECT_EQ(kMediaCreateUpload.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kMediaCompleteUpload.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kMediaDeleteMedia.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kAdminDeleteTask.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kAdminBroadcastNotification.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kNotificationsMarkAllRead.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kSearchSearch.info.idempotency, Idempotency::Idempotent);
    EXPECT_EQ(kNotificationsGetUnreadCount.info.idempotency, Idempotency::Idempotent);
}

TEST(MethodTableTest, OnlySideEffectFreeReadsAreRetriedAutomatically) {
    using network::Idempotency;
    EXPECT_EQ(kAuthLogin.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kAuthRefreshToken.info.idempotency, Idempotency::Unknown); // rotates the refresh token
    EXPECT_EQ(kTasksCreateTask.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kTasksDeleteTask.info.idempotency, Idempotency::Unknown);
    EXPECT_EQ(kAuthGetCurrentUser.info.idempotency, Idempotency::Idempotent);
    EXPECT_EQ(kTasksGetTask.info.idempotency, Idempotency::Idempotent);
    EXPECT_EQ(kTasksListTasks.info.idempotency, Idempotency::Idempotent);
    EXPECT_EQ(kTasksGetTaskStats.info.idempotency, Idempotency::Idempotent);
}

} // namespace
} // namespace aedst::contract
