import AedstCore
import AedstTelemetry
import Foundation

#if DEBUG
import AedstTesting
#endif

/// How the process was launched. `.uiTesting` (the `-aedst-ui-testing` launch
/// argument, XCUITest only) makes the composition root hermetic: an in-memory
/// secure store (no Keychain state leaks between runs, no persisted session, so
/// the app always starts signed out on the login flow) and telemetry switched
/// off. The network layer is untouched: the signed-out screens make no network
/// call, which is what the UI tests rely on.
///
/// The seam only exists in DEBUG builds; in Release `current` is always
/// `.normal`, so a shipped binary cannot be put in this mode by an argument.
public enum AppLaunchMode: Sendable, Equatable {
    case normal
    case uiTesting

    /// The launch argument XCUITest passes (`app.launchArguments`).
    public static let uiTestingArgument = "-aedst-ui-testing"

    public static var current: AppLaunchMode { resolve(arguments: ProcessInfo.processInfo.arguments) }

    static func resolve(arguments: [String]) -> AppLaunchMode {
        #if DEBUG
        return arguments.contains(uiTestingArgument) ? .uiTesting : .normal
        #else
        return .normal
        #endif
    }

    /// `real` in normal mode; a fresh in-memory store when UI testing.
    func secureStore(replacing real: any SecureStore) -> any SecureStore {
        #if DEBUG
        return self == .uiTesting ? InMemorySecureStore() : real
        #else
        return real
        #endif
    }

    /// A configuration with every SDK off when UI testing; `nil` (= read the
    /// Info.plist) otherwise.
    var telemetryOverride: TelemetryConfiguration? {
        #if DEBUG
        return self == .uiTesting
            ? TelemetryConfiguration(
                sentryDSN: nil,
                postHogKey: nil,
                postHogHost: "https://localhost.invalid",
                environment: "uitest",
                release: "uitest",
                dist: "0",
                apiHost: nil,
                tracesSampleRate: 0
            )
            : nil
        #else
        return nil
        #endif
    }
}
