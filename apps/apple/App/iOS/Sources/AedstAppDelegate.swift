import AedstAnalytics
import AedstCore
import AedstMedia
import Foundation
import Notifications
import UserNotifications

#if os(iOS)
import UIKit

/// iOS application delegate (`@UIApplicationDelegateAdaptor` in `App/iOS`).
/// Owns the composition root so system callbacks that arrive before or
/// without any UI — APNs token, notification taps on a cold launch,
/// background `URLSession` events — reach the same `AppDependencies`.
@MainActor
public final class AedstAppDelegate: NSObject, UIApplicationDelegate {
    /// Built on first access (first launch callback or first `RootView`).
    public private(set) lazy var dependencies = AppDependencies(
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

    public func application(
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

    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await dependencies.push.didRegister(deviceToken: deviceToken) }
    }

    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        dependencies.push.didFailToRegister(error: error)
    }

    public func application(
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
#elseif os(macOS)
import AppKit

/// macOS application delegate (`@NSApplicationDelegateAdaptor` in `App/macOS`).
@MainActor
public final class AedstAppDelegate: NSObject, NSApplicationDelegate {
    /// Built on first access.
    public private(set) lazy var dependencies = AppDependencies(
        deviceName: Host.current().localizedName ?? "Mac",
        registerForRemoteNotifications: { NSApplication.shared.registerForRemoteNotifications() },
        setAppBadge: { NSApplication.shared.dockTile.badgeLabel = $0 > 0 ? String($0) : nil }
    )

    public func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    /// One window owns the event streams of `AppDependencies`; once it closes they have ended, so quit instead of
    /// leaving a windowless process that a reopened window could not reattach to.
    public func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    public func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await dependencies.push.didRegister(deviceToken: deviceToken) }
    }

    public func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        dependencies.push.didFailToRegister(error: error)
    }
}
#endif

#if os(iOS) || os(macOS)
extension AedstAppDelegate: UNUserNotificationCenterDelegate {
    /// Foreground delivery: show the banner and refresh the unread badge.
    public nonisolated func userNotificationCenter(
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
    public nonisolated func userNotificationCenter(
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
#endif
