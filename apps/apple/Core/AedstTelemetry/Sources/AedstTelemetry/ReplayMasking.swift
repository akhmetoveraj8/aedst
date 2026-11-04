import SwiftUI
#if os(iOS)
import PostHog
#endif

/// SDK-specific half of `aedstSensitive()` (the SDK-free seam lives in
/// `AedstDesignSystem`; `AppDependencies` joins the two). Keeping the PostHog
/// import here preserves the rule that only `Core/AedstTelemetry` imports a
/// telemetry SDK.
public enum ReplayMasking {
    /// Wraps `view` in PostHog's explicit mask region (iOS); returns it
    /// unchanged elsewhere, where replay does not exist.
    @MainActor
    public static func mask(_ view: AnyView) -> AnyView {
        #if os(iOS)
        AnyView(view.postHogMask())
        #else
        view
        #endif
    }

    /// Whether the app should install the masker for `configuration`
    /// (same predicate as the replay setup itself).
    public static func isActive(for configuration: TelemetryConfiguration) -> Bool {
        ReplayConfiguration.make(configuration: configuration, isIOS: ReplayConfiguration.isIOS) != nil
    }
}
