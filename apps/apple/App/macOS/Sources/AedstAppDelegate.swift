import AedstAnalytics
import AedstAppCore
import AedstCore
import AppKit
import Foundation
import NotificationsDomain
import UserNotifications

/// macOS application delegate (`@NSApplicationDelegateAdaptor` in `App/macOS`).
@MainActor
final class AedstAppDelegate: NSObject, NSApplicationDelegate {
    /// Built on first access.
    private(set) lazy var dependencies = AppDependencies(
        deviceName: Host.current().localizedName ?? "Mac",
        registerForRemoteNotifications: { NSApplication.shared.registerForRemoteNotifications() },
        setAppBadge: { NSApplication.shared.dockTile.badgeLabel = $0 > 0 ? String($0) : nil }
    )

    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    /// One window owns the event streams of `AppDependencies`; once it closes they have ended, so quit instead of
    /// leaving a windowless process that a reopened window could not reattach to.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await dependencies.push.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        dependencies.push.didFailToRegister(error: error)
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
