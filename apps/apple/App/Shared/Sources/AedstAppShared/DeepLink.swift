import Foundation

/// The custom-scheme deep links the app accepts (`aedst://login`). The scheme
/// is declared in each app target's Info.plist (`CFBundleURLTypes`).
///
/// Parsing is strict on purpose: an unknown scheme/host, or any extra path or
/// query, is rejected rather than guessed at, so a hostile link cannot steer
/// the app anywhere the enum does not list. HTTPS *universal links* are a
/// separate, server-side-gated feature (apple-app-site-association +
/// Associated Domains entitlement); see `docs/content/apple/release.md`.
public enum DeepLink: Equatable, Sendable {
    case login

    public static let scheme = "aedst"

    public init?(url: URL) {
        guard url.scheme?.lowercased() == Self.scheme,
              url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/"
        else { return nil }

        switch url.host?.lowercased() {
        case "login": self = .login
        default: return nil
        }
    }
}
