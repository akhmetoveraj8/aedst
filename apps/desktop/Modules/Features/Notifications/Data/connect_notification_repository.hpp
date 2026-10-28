#pragma once

#include "Domain/notification_repository.hpp"

#include <aedst/notifications/v1/notifications.pb.h>
#include <memory>

namespace aedst::network {
class ConnectClient;
} // namespace aedst::network

namespace aedst::feature::notifications {

namespace notificationsv1 = ::aedst::notifications::v1;

/// NotificationRepository over ConnectClient. Push-device RPCs
/// (RegisterPushDevice & co.) are deliberately absent: desktop polls.
class ConnectNotificationRepository final : public NotificationRepository {
public:
    explicit ConnectNotificationRepository(std::shared_ptr<network::ConnectClient> client);

    void list(bool unreadOnly, const std::string& pageToken, int pageSize,
              core::Completion<NotificationPage> done) override;
    void unreadCount(core::Completion<int> done) override;
    void markRead(const std::vector<std::string>& ids, core::Completion<void> done) override;
    void markAllRead(core::Completion<int> done) override;
    void preferences(core::Completion<NotificationPreferences> done) override;
    void updatePreferences(const NotificationPreferences& preferences,
                           core::Completion<NotificationPreferences> done) override;

    [[nodiscard]] static Notification toDomain(const notificationsv1::Notification& notification);

private:
    std::shared_ptr<network::ConnectClient> client_;
};

} // namespace aedst::feature::notifications
