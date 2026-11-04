import Foundation
import Observation

/// Public, unauthenticated `GetCapabilities` (implemented in `AedstNetwork`).
public protocol CapabilitiesRemote: Sendable {
    func fetch() async -> Outcome<ServerCapabilities>
}

/// Last known capabilities, persisted across launches (implemented in `AedstPersistence`).
public protocol CapabilitiesStore: Sendable {
    func load() async -> ServerCapabilities?
    func save(_ capabilities: ServerCapabilities) async
}

/// Capability negotiation state for the UI. Views read `isEnabled(_:)` (Observation tracks the underlying
/// `capabilities`), so a feature disappears from the tabs/home list the moment a fetch turns it off.
///
/// Order of truth: fresh fetch, else last known (persisted), else the build defaults.
@MainActor
@Observable
public final class CapabilitiesService {
    public private(set) var capabilities: ServerCapabilities?
    /// This release is below the platform minimum in the latest capabilities; feeds the blocking upgrade screen.
    public private(set) var isBelowMinimum = false

    @ObservationIgnored private let build: ClientBuild
    @ObservationIgnored private let platform: String
    @ObservationIgnored private let remote: any CapabilitiesRemote
    @ObservationIgnored private let store: any CapabilitiesStore
    @ObservationIgnored private let onBelowMinimum: @MainActor () -> Void
    @ObservationIgnored private var loadedStore = false
    @ObservationIgnored private let logger = AedstLogger(category: "capabilities")

    /// - Parameter onBelowMinimum: called once the capabilities say this release is unsupported (the composition
    ///   root passes `ClientUpgradeMonitor.report`, so the existing upgrade screen is reused).
    public init(
        build: ClientBuild,
        platform: String = "apple",
        remote: any CapabilitiesRemote,
        store: any CapabilitiesStore,
        onBelowMinimum: @escaping @MainActor () -> Void = {}
    ) {
        self.build = build
        self.platform = platform
        self.remote = remote
        self.store = store
        self.onBelowMinimum = onBelowMinimum
    }

    /// Whether the UI may show/open `feature`.
    public func isEnabled(_ feature: String) -> Bool {
        CapabilityResolver.isEnabled(feature, build: build, capabilities: capabilities)
    }

    /// Non-blocking "a newer release exists" (`UPDATE_STATUS_RECOMMENDED`).
    public var isUpdateRecommended: Bool { capabilities?.updateStatus == .recommended }

    /// Loads the persisted copy (once), then fetches. A failed fetch keeps whatever is already known.
    public func refresh() async {
        if !loadedStore {
            loadedStore = true
            if capabilities == nil, let known = await store.load() { apply(known) }
        }
        switch await remote.fetch() {
        case .success(let fresh):
            apply(fresh)
            await store.save(fresh)
        case .failure(let error):
            logger.info("Capabilities fetch failed; using \(capabilities == nil ? "defaults" : "last known"): \(error)")
        }
    }

    private func apply(_ value: ServerCapabilities) {
        capabilities = value
        let below = CapabilityResolver.isBelowMinimum(build: build, platform: platform, capabilities: value)
        if below, !isBelowMinimum { onBelowMinimum() }
        isBelowMinimum = below
    }
}
