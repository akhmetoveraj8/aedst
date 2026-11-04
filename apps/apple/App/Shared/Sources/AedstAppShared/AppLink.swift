import Foundation

/// Relative in-app routes the server hands out — `Notification.link`,
/// `SearchHit.link`, a push payload's `link`, a broadcast's `link`
/// (e.g. `/tasks/<id>`). Same paths as the web app, so one link works on
/// every client.
///
/// Parsing is strict (like `DeepLink`): absolute URLs, protocol-relative
/// `//host` links, unknown sections, extra segments and ids outside
/// `[A-Za-z0-9_-]{1,64}` are rejected, so a crafted link cannot steer the app
/// anywhere this enum does not list. Query strings/fragments are ignored.
public enum AppLink: Equatable, Sendable {
    case tasks
    case task(id: String)
    case media
    case mediaItem(id: String)
    case notifications
    case search
    case admin

    /// Parses a relative path; `nil` for anything not listed above.
    public init?(path rawPath: String) {
        guard rawPath.hasPrefix("/"), !rawPath.hasPrefix("//") else { return nil }
        let path = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        let trimmed = path.split(separator: "#", maxSplits: 1).first.map(String.init) ?? path
        let segments = trimmed.split(separator: "/").map(String.init)

        switch (segments.first ?? "", segments.count) {
        case ("tasks", 1): self = .tasks
        case ("tasks", 2) where Self.isValidID(segments[1]): self = .task(id: segments[1])
        case ("media", 1): self = .media
        case ("media", 2) where Self.isValidID(segments[1]): self = .mediaItem(id: segments[1])
        case ("notifications", 1): self = .notifications
        case ("search", 1): self = .search
        case ("admin", 1): self = .admin
        default: return nil
        }
    }

    /// The `AppFeature` id that must be enabled for this link to open.
    public var feature: String {
        switch self {
        case .tasks, .task: AppFeature.tasks
        case .media, .mediaItem: AppFeature.media
        case .notifications: AppFeature.notifications
        case .search: AppFeature.search
        case .admin: AppFeature.admin
        }
    }

    static func isValidID(_ id: String) -> Bool {
        (1...64).contains(id.count)
            && id.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII || $0 == "-" || $0 == "_" }
    }
}

/// Links that arrive outside the view tree (a notification tap handled by the
/// app delegate, possibly before `RootView` exists). Buffered until `RootView`
/// consumes them.
public final class AppLinkInbox: Sendable {
    /// Consumed by `RootView` (single consumer).
    public let links: AsyncStream<String>
    private let continuation: AsyncStream<String>.Continuation

    /// Creates an empty inbox.
    public init() {
        let stream = AsyncStream.makeStream(of: String.self)
        links = stream.stream
        continuation = stream.continuation
    }

    /// Queues `link` for routing.
    public func open(_ link: String) {
        continuation.yield(link)
    }
}
