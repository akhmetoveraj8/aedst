import AedstCore
import AedstNetwork
import AedstPersistence
import Connect
import Foundation

/// The feature ids this build contains (behaviour `capability-negotiation`). A server capability is looked up
/// by the same id; anything the server lists that is not here is ignored.
public enum AppFeature {
    public static let tasks = "tasks"
    public static let media = "media"
    public static let search = "search"
    public static let admin = "admin"
    public static let notifications = "notifications"
    public static let auth = "auth"

    /// Features compiled into the app.
    public static let built: Set<String> = [tasks, media, search, admin, notifications, auth]
    /// Built features that stay hidden until the server enables them.
    public static let flagged: Set<String> = [admin]
}

extension AppDependencies {
    /// `version` is the bundle's marketing version; empty when it is unusable, which disables every
    /// version-based rule rather than guessing a version that could wrongly hide features or force an upgrade.
    static func makeCapabilities(
        plainClient: ProtocolClient,
        identity: ClientIdentity,
        outbox: AedstOutbox,
        upgradeMonitor: ClientUpgradeMonitor
    ) -> CapabilitiesService {
        let prefix = "\(ClientIdentity.platform)/"
        let version = identity.headerValue.map { String($0.dropFirst(prefix.count)) } ?? ""
        return CapabilitiesService(
            build: ClientBuild(version: version, features: AppFeature.built, flagged: AppFeature.flagged),
            platform: ClientIdentity.platform,
            remote: ConnectCapabilitiesRemote(client: plainClient),
            store: CapabilitiesCacheStore(outbox: outbox),
            onBelowMinimum: { upgradeMonitor.report() }
        )
    }
}
