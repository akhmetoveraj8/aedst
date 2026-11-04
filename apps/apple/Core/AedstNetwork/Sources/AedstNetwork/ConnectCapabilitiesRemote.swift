import AedstCore
import Connect

/// `CapabilitiesRemote` over the generated `CapabilitiesService` client (`make generate`). The RPC is public, so
/// it is called through the plain client (no bearer token): capabilities are known before sign-in.
public struct ConnectCapabilitiesRemote: CapabilitiesRemote {
    private let client: Aedst_Capabilities_V1_CapabilitiesServiceClient

    /// `client` should be `ConnectClientFactory.makePlainClient(...)`.
    public init(client: ProtocolClient) {
        self.client = Aedst_Capabilities_V1_CapabilitiesServiceClient(client: client)
    }

    public func fetch() async -> Outcome<ServerCapabilities> {
        let response = await client.getCapabilities(request: Aedst_Capabilities_V1_GetCapabilitiesRequest(), headers: [:])
        return response.result
            .map(Self.map)
            .mapError { NetworkErrorMapping.map($0) }
    }

    static func map(_ message: Aedst_Capabilities_V1_GetCapabilitiesResponse) -> ServerCapabilities {
        let features = message.features.mapValues { feature in
            ServerCapabilities.Feature(
                enabled: feature.enabled,
                requiredClientVersion: feature.requiredClientVersion.isEmpty ? nil : feature.requiredClientVersion
            )
        }
        let clients = message.clients.mapValues {
            ServerCapabilities.ClientWindow(minimum: $0.minimum, recommended: $0.recommended)
        }
        return ServerCapabilities(features: features, clients: clients, updateStatus: updateStatus(message.updateStatus))
    }

    static func updateStatus(_ proto: Aedst_Capabilities_V1_UpdateStatus) -> ServerCapabilities.UpdateStatus {
        switch proto {
        case .current: .current
        case .recommended: .recommended
        case .unspecified, .UNRECOGNIZED: .unspecified
        }
    }
}
