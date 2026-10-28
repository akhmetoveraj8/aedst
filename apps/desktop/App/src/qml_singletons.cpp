#include "qml_singletons.hpp"

#include "Presentation/admin_view_model.hpp"
#include "Presentation/login_view_model.hpp"
#include "Presentation/media_library_view_model.hpp"
#include "Presentation/media_viewer_view_model.hpp"
#include "Presentation/notifications_view_model.hpp"
#include "Presentation/search_view_model.hpp"
#include "Presentation/task_detail_view_model.hpp"
#include "Presentation/task_list_view_model.hpp"
#include "aedst/connectivity/connectivity_monitor.hpp"
#include "aedst/designsystem/theme_controller.hpp"
#include "aedst/navigation/router.hpp"
#include "aedst/platform/notification_service.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"
#include "aedst/telemetry/error_center.hpp"
#include "aedst/telemetry/posthog_analytics_tracker.hpp"
#include "aedst/telemetry/telemetry_settings.hpp"
#include "app_dependencies.hpp"
#include "session_info.hpp"

namespace aedst::app {

namespace {

template <typename T>
void provide(T& instance) {
    qmlsupport::SingletonSlot<T>::provide(&instance);
}

} // namespace

void provideQmlSingletons(AppDependencies& deps, connectivity::ConnectivityMonitor& connectivity,
                          platform::InAppNotificationService& notifications) {
    provide(deps.theme());
    provide(deps.router());
    provide(connectivity);
    provide(notifications);
    provide(deps.session());
    provide(deps.errorCenter());
    provide(deps.telemetrySettings());
    provide(deps.analytics());
    provide(deps.loginViewModel());
    provide(deps.taskListViewModel());
    provide(deps.taskDetailViewModel());
    provide(deps.searchViewModel());
    provide(deps.notificationsViewModel());
    provide(deps.mediaLibraryViewModel());
    provide(deps.mediaViewerViewModel());
    provide(deps.adminViewModel());
}

} // namespace aedst::app
