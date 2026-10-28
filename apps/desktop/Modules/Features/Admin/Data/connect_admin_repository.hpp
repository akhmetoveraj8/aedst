#pragma once

#include "Domain/admin_repository.hpp"
#include "aedst/network/api_error.hpp"

#include <aedst/admin/v1/admin.pb.h>
#include <memory>

namespace aedst::network {
class ConnectClient;
} // namespace aedst::network

namespace aedst::feature::admin {

class ConnectAdminRepository final : public AdminRepository {
public:
    explicit ConnectAdminRepository(std::shared_ptr<network::ConnectClient> client);

    void overview(network::ApiCompletion<adminv1::GetOverviewResponse> done) override;
    void listUsers(const adminv1::ListUsersRequest& request,
                   network::ApiCompletion<adminv1::ListUsersResponse> done) override;
    void listAuditLog(const adminv1::ListAuditLogRequest& request,
                      network::ApiCompletion<adminv1::ListAuditLogResponse> done) override;
    void broadcast(const adminv1::BroadcastNotificationRequest& request,
                   network::ApiCompletion<adminv1::BroadcastNotificationResponse> done) override;

private:
    std::shared_ptr<network::ConnectClient> client_;
};

} // namespace aedst::feature::admin
