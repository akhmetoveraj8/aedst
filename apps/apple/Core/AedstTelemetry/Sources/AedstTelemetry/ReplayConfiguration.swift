import Foundation

/// The session-replay settings applied to PostHog, as a plain value so the
/// privacy policy is unit-testable without UIKit or the SDK.
///
/// Policy (deny by default): replay runs only when the build flag is on, a
/// PostHog key exists and the platform is iOS. When it runs, every text
/// (`maskAllTextInputs` also covers SwiftUI `Text`/`Button`/`TextEditor` and
/// `UILabel`; posthog-ios 3.90.2 has no separate "all text" switch), every
/// image and every sandboxed system view is masked, and network telemetry is
/// never captured. Consent gating is applied separately through `optOut`.
struct ReplayConfiguration: Equatable, Sendable {
    let screenshotMode: Bool
    let maskAllTextInputs: Bool
    let maskAllImages: Bool
    let maskAllSandboxedViews: Bool
    let captureNetworkTelemetry: Bool

    /// The only enabled shape: masked everywhere, no network capture.
    static let masked = ReplayConfiguration(
        screenshotMode: true,
        maskAllTextInputs: true,
        maskAllImages: true,
        maskAllSandboxedViews: true,
        captureNetworkTelemetry: false
    )

    /// `nil` means replay stays off.
    static func make(configuration: TelemetryConfiguration, isIOS: Bool) -> ReplayConfiguration? {
        guard isIOS, configuration.postHogKey != nil, configuration.postHogSessionReplay else { return nil }
        return .masked
    }

    /// `true` when compiled for iOS (replay exists only there).
    static var isIOS: Bool {
        #if os(iOS)
        true
        #else
        false
        #endif
    }
}
