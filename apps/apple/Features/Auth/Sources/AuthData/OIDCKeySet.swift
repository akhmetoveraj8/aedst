import AedstCore
import Foundation

/// The provider's signing keys (the document behind discovery's `jwks_uri`), cached.
///
/// - Keys are cached for `timeToLive`; after that the next lookup refetches.
/// - A `kid` that is not in the cache triggers ONE refetch (the provider rotated its keys),
///   but never more often than `minimumRefetchInterval`, so a token with a random `kid`
///   cannot turn this client into a request amplifier against the identity provider.
/// - Concurrent lookups share one in-flight fetch (single-flight).
/// - The key URL always comes from the discovery document of the configured issuer, never
///   from the token (`jku`, `jwk` and `x5u` header members are ignored by construction).
actor OIDCKeySet {
    static let defaultTimeToLive: TimeInterval = 3_600
    static let defaultMinimumRefetchInterval: TimeInterval = 30
    /// A JWKS is a few hundred bytes to a few KB; refuse anything absurd.
    static let maximumResponseBytes = 256 * 1_024

    private let discovery: OIDCDiscovery
    private let transport: OIDCTransport
    private let clock: any AedstClock
    private let timeToLive: TimeInterval
    private let minimumRefetchInterval: TimeInterval
    private let logger = AedstLogger(category: "oidc")

    private var keys: [JSONWebKey] = []
    private var fetchedAt: Date?
    private var inFlight: Task<Outcome<[JSONWebKey]>, Never>?

    init(
        discovery: OIDCDiscovery,
        transport: @escaping OIDCTransport = OIDCTransports.default,
        clock: any AedstClock = SystemClock(),
        timeToLive: TimeInterval = OIDCKeySet.defaultTimeToLive,
        minimumRefetchInterval: TimeInterval = OIDCKeySet.defaultMinimumRefetchInterval
    ) {
        self.discovery = discovery
        self.transport = transport
        self.clock = clock
        self.timeToLive = timeToLive
        self.minimumRefetchInterval = minimumRefetchInterval
    }

    /// The key that may verify a token with this `kid` and `alg`.
    /// `.unauthenticated`: no such key, even after a refetch. Fetch problems keep their own
    /// (transient) error so an outage is not mistaken for a forged token.
    func key(keyID: String?, algorithm: JWSAlgorithm) async -> Outcome<JSONWebKey> {
        let now = clock.now
        let age = fetchedAt.map { now.timeIntervalSince($0) }
        let isFresh = age.map { $0 < timeToLive } ?? false

        if isFresh, let match = Self.match(keys, keyID: keyID, algorithm: algorithm) {
            return .success(match)
        }
        // Fresh cache without the key: refetch only if the cache is not too recent.
        if isFresh, let age, age < minimumRefetchInterval {
            return .failure(.unauthenticated)
        }

        switch await refetch() {
        case .failure(let error):
            return .failure(error)
        case .success(let fetched):
            guard let match = Self.match(fetched, keyID: keyID, algorithm: algorithm) else {
                return .failure(.unauthenticated)
            }
            return .success(match)
        }
    }

    private static func match(_ keys: [JSONWebKey], keyID: String?, algorithm: JWSAlgorithm) -> JSONWebKey? {
        let usable = keys.filter { $0.supports(algorithm) }
        if let keyID { return usable.first { $0.keyID == keyID } }
        // No `kid` in the token header: only unambiguous when the provider has a single such key.
        return usable.count == 1 ? usable.first : nil
    }

    private func refetch() async -> Outcome<[JSONWebKey]> {
        if let inFlight { return await inFlight.value }
        let task = Task { await self.fetch() }
        inFlight = task
        let result = await task.value
        inFlight = nil
        if case .success(let fetched) = result {
            keys = fetched
            fetchedAt = clock.now
        }
        return result
    }

    private func fetch() async -> Outcome<[JSONWebKey]> {
        let metadata: OIDCProviderMetadata
        switch await discovery.metadata() {
        case .success(let value): metadata = value
        case .failure(let error): return .failure(error)
        }
        // Fail closed: without published keys an ID token cannot be trusted.
        guard let jwksURI = metadata.jwksURI else {
            logger.error("Discovery document has no usable jwks_uri")
            return .failure(.decoding(reason: "discovery document has no jwks_uri"))
        }

        var request = URLRequest(url: jwksURI)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let response: (Data, HTTPURLResponse)
        switch await OIDCHTTP.perform(request, using: transport) {
        case .success(let value): response = value
        case .failure(let error): return .failure(error)
        }
        guard (200..<300).contains(response.1.statusCode) else {
            return .failure(OIDCHTTP.error(for: response.1, body: response.0))
        }
        guard response.0.count <= Self.maximumResponseBytes,
              let object = try? JSONSerialization.jsonObject(with: response.0),
              let document = object as? [String: Any],
              let entries = document["keys"] as? [[String: Any]]
        else {
            return .failure(.decoding(reason: "jwks is not a JSON Web Key Set"))
        }
        let parsed = entries.compactMap { JSONWebKey(json: $0) }
        guard !parsed.isEmpty else {
            return .failure(.decoding(reason: "jwks contains no usable signing key"))
        }
        return .success(parsed)
    }
}
