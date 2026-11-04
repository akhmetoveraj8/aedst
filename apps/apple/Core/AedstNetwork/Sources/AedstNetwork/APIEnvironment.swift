import Foundation

/// Mirrors the `NEXT_PUBLIC_API_URL` / Android `BuildConfig.API_BASE_URL`
/// split: one enum, one place that knows where `apps/server`'s ConnectRPC
/// endpoint lives per build configuration.
public enum APIEnvironment: Sendable, Equatable {
    case local
    case staging
    case production

    public var baseURL: URL {
        switch self {
        case .local: URL(string: "http://localhost:8080")!
        case .staging: URL(string: "https://staging.api.aedst.app")!
        case .production: URL(string: "https://api.aedst.app")!
        }
    }

    /// Selected from the app target's build configuration via an
    /// `AEDST_API_ENVIRONMENT` Info.plist key (see `Config/*.xcconfig`).
    public static func fromInfoPlist(bundle: Bundle = .main) -> APIEnvironment {
        #if DEBUG
        let allowsLocal = true
        #else
        let allowsLocal = false
        #endif
        return resolve(
            bundle.object(forInfoDictionaryKey: "AEDST_API_ENVIRONMENT") as? String,
            allowsLocal: allowsLocal
        )
    }

    /// Pure resolution logic (unit-tested). Fails closed: an unknown or missing
    /// value is `.local` where local is allowed (Debug), and `.production`
    /// everywhere else — a Release build can never point at, or silently fall
    /// back to, a plaintext `localhost` endpoint.
    static func resolve(_ rawValue: String?, allowsLocal: Bool) -> APIEnvironment {
        switch rawValue {
        case "staging": .staging
        case "production": .production
        default: allowsLocal ? .local : .production
        }
    }
}
