import AedstCore
import Foundation

/// One in-app inbox entry (`aedst.notifications.v1.Notification`).
public struct InboxNotification: Sendable, Equatable, Identifiable {
    /// Mirrors `NotificationKind`.
    public enum Kind: Sendable, Equatable {
        case taskCompleted
        case taskDueSoon
        case mediaReady
        case system
        case other
    }

    public let id: String
    public let kind: Kind
    public let title: String
    public let body: String
    /// Relative in-app route opened on tap (may be empty).
    public let link: String
    public let createdAt: Date?
    public var isRead: Bool

    /// Memberwise initializer.
    public init(id: String, kind: Kind, title: String, body: String, link: String, createdAt: Date?, isRead: Bool) {
        self.id = id
        self.kind = kind
        self.title = title
        self.body = body
        self.link = link
        self.createdAt = createdAt
        self.isRead = isRead
    }
}

/// Per-user delivery preferences (`aedst.notifications.v1.Preferences`).
public struct NotificationPreferences: Sendable, Equatable {
    public var pushEnabled: Bool
    public var taskCompleted: Bool
    public var taskDueSoon: Bool
    public var mediaReady: Bool

    /// Memberwise initializer.
    public init(pushEnabled: Bool, taskCompleted: Bool, taskDueSoon: Bool, mediaReady: Bool) {
        self.pushEnabled = pushEnabled
        self.taskCompleted = taskCompleted
        self.taskDueSoon = taskDueSoon
        self.mediaReady = mediaReady
    }
}

/// An APNs registration for `RegisterPushDevice(platform: APNS)`.
public struct APNsRegistration: Sendable, Equatable {
    /// Device token, lowercase hex (what the server expects for APNs).
    public let token: String
    /// The bundle id the token belongs to (`apns_topic`).
    public let topic: String
    /// `true` when the token was issued by the APNs sandbox (development builds).
    public let isSandbox: Bool
    /// Shown in "your devices".
    public let deviceName: String
    /// BCP-47 locale for localized pushes.
    public let locale: String

    /// Memberwise initializer.
    public init(token: String, topic: String, isSandbox: Bool, deviceName: String, locale: String) {
        self.token = token
        self.topic = topic
        self.isSandbox = isSandbox
        self.deviceName = deviceName
        self.locale = locale
    }

    /// APNs device tokens are opaque bytes; the provider API wants them as hex.
    public static func hexString(from deviceToken: Data) -> String {
        deviceToken.map { String(format: "%02x", $0) }.joined()
    }
}

/// The seam to `NotificationsService`.
public protocol NotificationsRepository: Sendable {
    func list(unreadOnly: Bool, pageToken: String?) async -> Outcome<Page<InboxNotification>>
    func unreadCount() async -> Outcome<Int>
    func markRead(ids: [String]) async -> Outcome<Void>
    func markAllRead() async -> Outcome<Int>
    func preferences() async -> Outcome<NotificationPreferences>
    func updatePreferences(_ preferences: NotificationPreferences) async -> Outcome<NotificationPreferences>
    /// Returns the server's device id (needed to unregister).
    func registerPushDevice(_ registration: APNsRegistration) async -> Outcome<String>
    func unregisterPushDevice(deviceID: String) async -> Outcome<Void>
}
