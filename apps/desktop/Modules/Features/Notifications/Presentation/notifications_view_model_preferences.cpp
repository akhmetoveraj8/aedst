#include "Navigation/notifications_destinations.hpp"
#include "Presentation/notifications_view_model.hpp"
#include "aedst/core/error_sink.hpp"
#include "aedst/navigation/router.hpp"

#include <QPointer>

#include <utility>

// NotificationsViewModel: notification preferences (split out of notifications_view_model.cpp to keep it under the
// file-size limit; no behaviour change).

namespace aedst::feature::notifications {

void NotificationsViewModel::openPreferences() {
    if (router_ != nullptr) {
        router_->push(notificationPreferencesRoute());
    }
}

void NotificationsViewModel::loadPreferences() {
    const quint64 session = session_;
    QPointer<NotificationsViewModel> guard(this);
    repository_->preferences([guard, session](core::Outcome<NotificationPreferences> result) {
        if (!guard || session != guard->session_) {
            return;
        }
        if (!result) {
            if (guard->errors_) {
                guard->errors_->report(result.error(), "notifications.preferences", core::ErrorVisibility::Silent);
            }
            return;
        }
        guard->preferences_ = *result;
        guard->preferencesLoaded_ = true;
        emit guard->preferencesChanged();
    });
}

void NotificationsViewModel::savePreferences(bool desktopNotifications, bool taskCompleted, bool taskDueSoon,
                                             bool mediaReady) {
    if (isSavingPreferences_) {
        return;
    }
    const NotificationPreferences next{.pushEnabled = desktopNotifications,
                                       .taskCompleted = taskCompleted,
                                       .taskDueSoon = taskDueSoon,
                                       .mediaReady = mediaReady};
    isSavingPreferences_ = true;
    emit isSavingPreferencesChanged();
    QPointer<NotificationsViewModel> guard(this);
    repository_->updatePreferences(next, [guard](core::Outcome<NotificationPreferences> result) {
        if (!guard) {
            return;
        }
        guard->isSavingPreferences_ = false;
        emit guard->isSavingPreferencesChanged();
        if (!result) {
            if (guard->errors_) {
                guard->errors_->report(result.error(), "notifications.preferences.save");
            }
            emit guard->preferencesChanged(); // snap the switches back to the stored values
            return;
        }
        guard->preferences_ = *result;
        guard->preferencesLoaded_ = true;
        emit guard->preferencesChanged();
    });
}

} // namespace aedst::feature::notifications
