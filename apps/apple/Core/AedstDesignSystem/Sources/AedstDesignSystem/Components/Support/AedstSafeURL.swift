import Foundation

/// The one place that decides which URLs the kit opens. Model output, citations and stack frames carry
/// arbitrary strings, so a `javascript:`, `file:`, `data:` or custom-scheme URL must never reach `Link` or
/// `openURL`. Only `https`, `http` and `mailto` pass. No URL is logged.
public enum AedstSafeURL {
    /// Schemes the kit may open.
    public static let allowedSchemes: Set<String> = ["https", "http", "mailto"]

    /// `true` when `url` has an allowed scheme (case-insensitive) and, for http(s), a non-empty host.
    public static func isSafe(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), allowedSchemes.contains(scheme) else { return false }
        if scheme == "mailto" { return true }
        return !(url.host() ?? "").isEmpty
    }

    /// `url` when it is safe, otherwise `nil`.
    public static func validated(_ url: URL) -> URL? {
        isSafe(url) ? url : nil
    }

    /// Parses `string` and validates it; `nil` for anything malformed or with another scheme.
    public static func parse(_ string: String) -> URL? {
        guard let url = URL(string: string.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        return validated(url)
    }
}
