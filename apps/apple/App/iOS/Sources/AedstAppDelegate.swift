import AedstAnalytics
import AedstAppCore
import AedstCore
import AedstMedia
import Foundation
import NotificationsDomain
import UIKit
import UserNotifications

/// iOS application delegate (`@UIApplicationDelegateAdaptor` in `App/iOS`).
/// Owns the composition root so system callbacks that arrive before or
/// without any UI — APNs token, notification taps on a cold launch,
/// background `URLSession` events — reach the same `AppDependencies`.
@MainActor
final class AedstAppDelegate: NSObject, UIApplicationDelegate {
    /// Built on first access (first launch callback or first `RootView`).
    private(set) lazy var dependencies = AppDependencies(
        deviceName: UIDevice.current.name,
        registerForRemoteNotifications: { UIApplication.shared.registerForRemoteNotifications() },
        // `applicationIconBadgeNumber` is deprecated since iOS 17 in favour of
        // `UNUserNotificationCenter.setBadgeCount` (async throws).
        setAppBadge: { count in
            Task {
                do {
                    try await UNUserNotificationCenter.current().setBadgeCount(count)
                } catch {
                    AedstLogger(category: "badge").error("Could not set the app badge", error: error)
                }
            }
        },
        // The system wakes the app later to drain queued writes (BGAppRefreshTask).
        scheduleOutboxSync: { OutboxBackgroundTask.schedule(after: $0) }
    )

    private var backgroundSessionCompletion: (() -> Void)?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        OutboxBackgroundTask.register(coordinator: dependencies.outbox.coordinator)
        dependencies.uploader.setEventsFinishedHandler { [weak self] in
            Task { @MainActor in self?.finishBackgroundEvents() }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await dependencies.push.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        dependencies.push.didFailToRegister(error: error)
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == BackgroundUploader.sessionIdentifier else {
            completionHandler()
            return
        }
        backgroundSessionCompletion = completionHandler
        dependencies.uploader.activate()
    }

    private func finishBackgroundEvents() {
        backgroundSessionCompletion?()
        backgroundSessionCompletion = nil
    }
}

extension AedstAppDelegate: UNUserNotificationCenterDelegate {
    /// Foreground delivery: show the banner and refresh the unread badge.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound, .badge])
        Task { @MainActor [weak self] in
            await self?.dependencies.badge.refresh()
        }
    }

    /// Tap: route the payload's `link` (works on a cold launch — the link is
    /// buffered in `AppLinkInbox` until `RootView` consumes it).
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let link = PushCoordinator.link(fromPayload: response.notification.request.content.userInfo)
        completionHandler()
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.dependencies.analytics.track(.init(name: "notification_opened", parameters: ["via": "push"]))
            if let link { self.dependencies.linkInbox.open(link) }
        }
    }
}
